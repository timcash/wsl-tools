const PS_SCRIPT = "..\\wsl_tools.ps1";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// --- Frontend Build ---
const CLIENT_DIR = join(import.meta.dir, "client");
const DIST_DIR = join(CLIENT_DIR, "dist");
if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });

console.log(`[BUILD] Bundling Shadcn React frontend...`);
const buildResult = await Bun.build({
    entrypoints: [join(CLIENT_DIR, "index.html")],
    outdir: DIST_DIR,
    minify: true,
});

if (!buildResult.success) {
    console.error("[BUILD] Failed to bundle frontend:", buildResult.logs);
}

const indexFile = Bun.file(join(DIST_DIR, "index.html"));
const ALPINE_BASE = join(process.env.USERPROFILE || "", "WSL", "_bases", "alpine.tar.gz");

// ... helper functions getWSLList, getWSLMonitor ...
async function getWSLList() {
    const proc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "list-json"], {
        stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    try {
        return JSON.parse(text);
    } catch (e) {
        return [];
    }
}

async function getWSLMonitor(name: string) {
    const proc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "monitor-json", name], {
        stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

import { write } from "bun";

const port = 0; // Let Bun/OS pick a free port
const server = Bun.serve({
    port: port,
    async fetch(req, server) {
        if (server.upgrade(req)) {
            return;
        }

        const url = new URL(req.url);
        if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(indexFile);
        }

        // Serve static assets from the build directory
        const filePath = join(DIST_DIR, url.pathname);
        if (existsSync(filePath)) {
            return new Response(Bun.file(filePath));
        }

        return new Response("Not Found", { status: 404 });
    },
    websocket: {
        async open(ws) {
            ws.subscribe("updates");
            // Send initial state immediately
            const list = await getWSLList();
            ws.send(JSON.stringify({ type: "list", data: list }));
        },
        async message(ws, message) {
            try {
                const msg = JSON.parse(message.toString());
                if (msg.type === "create") {
                    console.log(`[WS] Creating instance: ${msg.name} from Alpine`);
                    Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "new", msg.name, ALPINE_BASE], {
                        stdout: "inherit",
                        stderr: "inherit",
                    });
                } else if (msg.type === "start") {
                    console.log(`[WS] Starting instance: ${msg.name}`);
                    // Start directly to avoid Start-Job persistency issues
                    Bun.spawn(["wsl", "-d", msg.name, "--", "exec", "sleep", "infinity"], {
                        stdout: "ignore",
                        stderr: "inherit",
                    });
                } else if (msg.type === "terminate") {
                    console.log(`[WS] Terminating instance: ${msg.name}`);
                    Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "stop", msg.name], {
                        stdout: "inherit",
                        stderr: "inherit",
                    });
                } else if (msg.type === "shell") {
                    console.log(`[WS] Running shell command in ${msg.name}: ${msg.cmd}`);
                    Bun.spawn(["wsl", "-d", msg.name, "sh", "-c", msg.cmd], {
                        stdout: "inherit",
                        stderr: "inherit",
                    });
                }
            } catch (e) {
                console.error("[WS] Failed to parse message", e);
            }
        },
    },
});

// Write port to file for tests to find
await write(".port", (server.port || 0).toString());
console.log(`Listening on http://localhost:${server.port}`);

setInterval(async () => {
    const list = await getWSLList();
    server.publish("updates", JSON.stringify({ type: "list", data: list }));

    for (const item of list) {
        if (item.State === "Running") {
            const stats = await getWSLMonitor(item.Name);
            if (stats) {
                server.publish("updates", JSON.stringify({ type: "stats", data: stats }));
            }
        }
    }
}, 3000);
