/// <reference types="bun-types" />
const PS_SCRIPT = "..\\wsl_tools.ps1";
import { join } from "path";
import { existsSync, mkdirSync, watch } from "fs";

// --- Frontend Build ---
const ROOT = import.meta.dir;
const DIST_DIR = join(ROOT, "dist");

// Watch frontend files to trigger rebuild
watch(join(ROOT, "app.ts"), () => build());
watch(join(ROOT, "style.css"), () => build());

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

const PS_PREFIX = ["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT];
const ps = (cmd: string, ...args: string[]) => Bun.spawn([...PS_PREFIX, cmd, ...args]);

async function streamPsOutput(proc: any) {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value).trim();
        if (text) {
            server.publish("fleet", JSON.stringify({ type: 'ps-log', data: text }));
        }
    }
}

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
            ws.subscribe("fleet");
            // Send initial state immediately
            const proc = ps("list-json");
            const text = await new Response(proc.stdout).text();
            if (text.trim()) {
                ws.send(JSON.stringify({ type: 'list', data: JSON.parse(text) }));
            }
        },
        async message(ws, message) {
            const msg = JSON.parse(message.toString());
            console.log(`[WS] Action: ${msg.type} on ${msg.name}`);

            if (msg.type === 'create') {
                const p = ps("new", msg.name);
                streamPsOutput(p);
                p.exited.then(async () => {
                    const d = ps("daemon", msg.name);
                    streamPsOutput(d);
                    await d.exited;
                    // Refresh list specifically after both are done
                    const proc = ps("list-json");
                    const text = await new Response(proc.stdout).text();
                    server.publish("fleet", text.trim() ? JSON.stringify({ type: 'list', data: JSON.parse(text) }) : "");
                });
            } else if (msg.type === 'start') {
                const d = ps("daemon", msg.name);
                streamPsOutput(d);
            } else if (msg.type === 'terminate') {
                const s = ps("stop", msg.name);
                streamPsOutput(s);
            }

            // High-frequency refresh after action
            setTimeout(async () => {
                const proc = ps("list-json");
                const text = await new Response(proc.stdout).text();
                server.publish("fleet", text.trim() ? JSON.stringify({ type: 'list', data: JSON.parse(text) }) : "");
            }, 1000);
        }
    }
});

console.log(`[V2] Dashboard active at http://localhost:${server.port}`);
Bun.write(".port", server.port.toString());

// --- Monitoring Loop ---
setInterval(async () => {
    try {
        const listProc = ps("list-json");
        const listText = await new Response(listProc.stdout).text();
        if (!listText.trim()) return;

        const instances = JSON.parse(listText);
        server.publish("fleet", JSON.stringify({ type: 'list', data: instances }));

        for (const inst of instances) {
            if (inst.State === 'Running') {
                const statsProc = ps("monitor-json", inst.Name);
                // We don't streamPsOutput for periodic monitor-json to avoid noise, 
                // but we could if we wanted high-fidelity trace. For now, just errors.
                const statsText = await new Response(statsProc.stdout).text();
                if (statsText.trim()) {
                    try {
                        const stats = JSON.parse(statsText);
                        server.publish("fleet", JSON.stringify({ type: 'stats', data: stats }));
                    } catch (e) {
                        // If parsing fails, it's likely a PS error message, stream it
                        server.publish("fleet", JSON.stringify({ type: 'ps-log', data: `[MONITOR ERROR] ${statsText}` }));
                    }
                }
            }
        }
    } catch (e) {
        console.error("[MONITOR] Error:", e);
    }
}, 3000);
