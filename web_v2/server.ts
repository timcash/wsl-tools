/// <reference types="bun-types" />
const PS_SCRIPT = "..\\wsl_tools.ps1";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";

// --- Frontend Build ---
const ROOT = import.meta.dir;
const DIST_DIR = join(ROOT, "dist");

async function build() {
    if (!existsSync(DIST_DIR)) {
        console.log(`[BUILD] Creating dist dir: ${DIST_DIR}`);
        mkdirSync(DIST_DIR, { recursive: true });
    }

    console.log(`[BUILD] Transpiling ${join(ROOT, "app.ts")} -> ${DIST_DIR}`);
    const result = await Bun.build({
        entrypoints: [join(ROOT, "app.ts")],
        outdir: DIST_DIR,
        naming: "[name].js",
        target: "browser",
    });

    if (!result.success) {
        console.error("[BUILD] Error:", result.logs);
    } else {
        console.log("[BUILD] Success!");
    }
}

await build();

const server = Bun.serve({
    port: 0,
    async fetch(req, server) {
        if (server.upgrade(req)) return;

        const url = new URL(req.url);
        const relPath = url.pathname.slice(1);
        console.log(`[HTTP] ${req.method} ${url.pathname} (rel: ${relPath})`);

        if (url.pathname === "/" || url.pathname === "/index.html") {
            const index = Bun.file(join(ROOT, "index.html"));
            return new Response(index);
        }

        if (url.pathname === "/favicon.ico") {
            return new Response(null, { status: 404 });
        }

        // Try build directory first (bundled app.js)
        if (relPath) {
            const buildPath = join(DIST_DIR, relPath);
            if (existsSync(buildPath)) {
                return new Response(Bun.file(buildPath));
            }

            // Try direct file (style.css, etc.)
            const directPath = join(ROOT, relPath);
            if (existsSync(directPath)) {
                return new Response(Bun.file(directPath));
            }
        }

        console.warn(`[HTTP] 404: ${url.pathname}`);
        return new Response("Not Found", { status: 404 });
    },
    websocket: {
        async open(ws) {
            console.log("[WS] Client connected");
            ws.subscribe("fleet");
            // Initial list fetch
            const proc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "list-json"]);
            const text = await new Response(proc.stdout).text();
            try {
                ws.send(JSON.stringify({ type: 'list', data: JSON.parse(text) }));
            } catch (e) { }
        },
        async message(ws, message) {
            const msg = JSON.parse(message.toString());
            if (msg.type === 'create') {
                Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "new", msg.name]);
            } else if (msg.type === 'start') {
                Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "daemon", msg.name]);
            } else if (msg.type === 'terminate') {
                Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "stop", msg.name]);
            }
        }
    }
});

console.log(`[V2] Premium Dashboard active at http://localhost:${server.port}`);
Bun.write(".port", server.port.toString());

// --- Monitoring Loop ---
setInterval(async () => {
    const listProc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "list-json"]);
    const listText = await new Response(listProc.stdout).text();
    let instances = [];
    try { instances = JSON.parse(listText); } catch (e) { return; }
    server.publish("fleet", JSON.stringify({ type: 'list', data: instances }));
    for (const inst of instances) {
        if (inst.State === 'Running') {
            const statsProc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "monitor-json", inst.Name]);
            const statsText = await new Response(statsProc.stdout).text();
            try {
                server.publish("fleet", JSON.stringify({ type: 'stats', data: JSON.parse(statsText) }));
            } catch (e) { }
        }
    }
}, 3000);
