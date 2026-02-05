// import index from "./index.html"; // Bundler modifies asset paths, breaking manual routing
const index = Bun.file("./index.html");

const PS_SCRIPT = "..\\wsl_tools.ps1";
import { join } from "path";
import { existsSync } from "fs";

const IMAGE_PATH = join(import.meta.dir, "wsl_invader.svg");
console.log(`[DEBUG] Image path: ${IMAGE_PATH}, Exists: ${existsSync(IMAGE_PATH)}`);

// ... helper functions getWSLList, getWSLMonitor ...
async function getWSLList() {
    const proc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "_", "list-json"], {
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
    const proc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, name, "monitor-json"], {
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
    routes: {
        "/": index,
        "/wsl_invader.svg": Bun.file(IMAGE_PATH),
    },
    fetch(req, server) {
        if (server.upgrade(req)) {
            return;
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
        message(ws, message) { },
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
