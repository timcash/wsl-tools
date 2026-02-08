/// <reference types="bun-types" />
const PS_SCRIPT = "..\\wsl_tools.ps1";
import { join } from "path";
import { existsSync, mkdirSync, watch, statSync, readFileSync } from "fs";

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
const ps = (cmd: string, ...args: string[]) => Bun.spawn([...PS_PREFIX, cmd, ...args], { stdout: "pipe", stderr: "pipe" });

// Tail the powershell.log for unified logging
async function tailLog() {
    const logPath = join(ROOT, "powershell.log");
    console.log(`[TAIL] Starting log tail on: ${logPath}`);
    
    if (!existsSync(logPath)) {
        await Bun.write(logPath, "");
    }

    let lastSize = statSync(logPath).size;

    setInterval(async () => {
        try {
            const stats = statSync(logPath);
            if (stats.size > lastSize) {
                const file = Bun.file(logPath);
                const newContent = await file.slice(lastSize, stats.size).text();
                lastSize = stats.size;

                if (newContent) {
                    for (const line of newContent.split("\n")) {
                        const sanitized = line.replace(/\0/g, "").trim();
                        if (sanitized) {
                            // Filter out noisy logs (defense in depth)
                            const noisePatterns = [
                                "list-json", "monitor-json", "[DEBUG]", 
                                "Listing instances", "Checking existence", "exists."
                            ];
                            if (noisePatterns.some(p => sanitized.includes(p))) {
                                continue;
                            }
                            console.log(`[PS-LOG] ${sanitized}`);
                            server.publish("fleet", JSON.stringify({ type: 'ps-log', data: sanitized }));
                        }
                    }
                }
            } else if (stats.size < lastSize) {
                lastSize = stats.size;
            }
        } catch (e) {
            // Silently ignore log read errors
        }
    }, 1000);
}

tailLog();

// Helper to aggressively sanitize strings for the dashboard
function sanitize(text: string) {
    return text.replace(/\0/g, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
}

async function streamPsOutput(proc: any) {
    // Stream stdout
    (async () => {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = sanitize(decoder.decode(value));
            if (text) {
                // Still publish list/stats if they come through stdout
                if (text.startsWith('[') || text.startsWith('{')) {
                    server.publish("fleet", JSON.stringify({ type: 'ps-data', data: text }));
                } else {
                    console.log(`[PS-OUT] ${text}`);
                    server.publish("fleet", JSON.stringify({ type: 'ps-log', data: text }));
                }
            }
        }
    })();

    // Stream stderr
    (async () => {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = sanitize(decoder.decode(value));
            if (text) {
                console.error(`[PS-ERR] ${text}`);
                server.publish("fleet", JSON.stringify({ type: 'ps-log', data: `[ERROR] ${text}` }));
            }
        }
    })();
}

const activeActions = new Set(); // Track instances undergoing manual actions

let port = parseInt(process.env.PORT || "3000");
const portIdx = Bun.argv.indexOf("--port");
if (portIdx !== -1 && Bun.argv[portIdx + 1]) {
    port = parseInt(Bun.argv[portIdx + 1]);
}

const server = Bun.serve({
    port: port,
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
            // Send initial state immediately
            const proc = ps("list-json");
            const text = await new Response(proc.stdout).text();
            if (text.trim()) {
                try {
                    ws.send(JSON.stringify({ type: 'list', data: JSON.parse(text) }));
                } catch (e) {
                    console.error("[WS] Initial list parse error:", e, "Text:", text);
                }
            }
        },
        async close(ws) {
            console.log("[WS] Client disconnected");
        },
        async message(ws, message) {
            console.log(`[WS] Received: ${message}`);
            try {
                const msg = JSON.parse(message.toString());
                console.log(`[WS] Parsed Action: ${msg.type} on ${msg.name}`);

                activeActions.add(msg.name);
                const clearAction = () => setTimeout(() => activeActions.delete(msg.name), 5000);

                if (msg.type === 'create') {
                    console.log(`[SERVER] Executing: new ${msg.name} alpine`);
                    const p = ps("new", msg.name, "alpine");
                    streamPsOutput(p);
                    p.exited.then(async (code) => {
                        console.log(`[SERVER] 'new' exited with code ${code}. Starting daemon...`);
                        const d = ps("daemon", msg.name);
                        streamPsOutput(d);
                        await d.exited;
                        clearAction();
                    });
                } else if (msg.type === 'start') {
                    // Start in non-daemon mode
                    console.log(`[SERVER] Executing: start ${msg.name}`);
                    const d = ps("start", msg.name);
                    streamPsOutput(d);
                    d.exited.then(clearAction);
                } else if (msg.type === 'daemon') {
                    // Start in daemon (self-healing) mode AND persist
                    console.log(`[SERVER] Executing: daemon & persist ${msg.name}`);
                    const d = ps("daemon", msg.name);
                    streamPsOutput(d);
                    d.exited.then(() => {
                        const p = ps("persist", msg.name);
                        streamPsOutput(p);
                        p.exited.then(clearAction);
                    });
                } else if (msg.type === 'terminate') {
                    console.log(`[SERVER] Executing: stop & unpersist ${msg.name}`);
                    const s = ps("stop", msg.name);
                    streamPsOutput(s);
                    s.exited.then(() => {
                        const p = ps("unpersist", msg.name);
                        streamPsOutput(p);
                        p.exited.then(clearAction);
                    });
                } else if (msg.type === 'delete') {
                    console.log(`[SERVER] Executing: delete ${msg.name}`);
                    const d = ps("delete", msg.name);
                    streamPsOutput(d);
                    d.exited.then(clearAction);
                } else if (msg.type === 'persist') {
                    console.log(`[SERVER] Executing: persist ${msg.name}`);
                    const p = ps("persist", msg.name);
                    streamPsOutput(p);
                    p.exited.then(clearAction);
                } else if (msg.type === 'unpersist') {
                    console.log(`[SERVER] Executing: unpersist ${msg.name}`);
                    const p = ps("unpersist", msg.name);
                    streamPsOutput(p);
                    p.exited.then(clearAction);
                }
            } catch (e) {
                console.error(`[WS ERROR] Failed to process message: ${e}`);
            }

            // High-frequency refresh after action
            setTimeout(async () => {
                const proc = ps("list-json");
                const text = await new Response(proc.stdout).text();
                if (text.trim()) {
                    try {
                        server.publish("fleet", JSON.stringify({ type: 'list', data: JSON.parse(text) }));
                    } catch (e) {
                        console.error("[SERVER] Action refresh list-json parse error:", e);
                    }
                }
            }, 1000);
        }
    }
});

console.log(`[V2] Dashboard active at http://localhost:${server.port}`);

// --- Monitoring Loop ---
let lastStates = new Map();

setInterval(async () => {
    try {
        const listProc = ps("list-json");
        const listText = await new Response(listProc.stdout).text();
        if (!listText.trim()) return;

        let instances;
        try {
            instances = JSON.parse(listText);
        } catch (e) {
            return; // Silent fail for noisy logs
        }
        
        server.publish("fleet", JSON.stringify({ type: 'list', data: instances }));

        for (const inst of instances) {
            if (activeActions.has(inst.Name)) continue;

            const lastState = lastStates.get(inst.Name);
            if (lastState !== inst.State) {
                console.log(`[STATE] ${inst.Name}: ${lastState || 'Unknown'} -> ${inst.State}`);
                lastStates.set(inst.Name, inst.State);
            }

            if (inst.State === 'Running') {
                const statsProc = ps("monitor-json", inst.Name);
                const statsText = await new Response(statsProc.stdout).text();
                if (statsText.trim()) {
                    try {
                        const stats = JSON.parse(statsText);
                        server.publish("fleet", JSON.stringify({ type: 'stats', data: stats }));
                    } catch (e) {
                        // Silent fail
                    }
                }
            }
        }
    } catch (e) {
        console.error("[MONITOR] Error:", e);
    }
}, 3000);