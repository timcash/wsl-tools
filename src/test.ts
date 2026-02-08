import { spawn } from "bun";
import { join } from "path";
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import puppeteer from "puppeteer";

interface TestStep {
    title: string;
    logs: string[];
    screenshot?: string;
    status: "[PASS]" | "[FAIL]" | "[WAIT]";
}

async function runTest() {
    const testLog = join(process.cwd(), "test.log");
    const portFile = join(process.cwd(), ".port");
    const PS_SCRIPT = join(process.cwd(), "..", "wsl_tools.ps1");
    const TEST_INST = "TDD-Unified-Final";
    const screenshotsDir = join(process.cwd(), "screenshots");
    
    if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir);

    const steps: TestStep[] = [];
    let currentLogs: string[] = [];

    const sanitize = (str: string) => {
        return str.replace(/\0/g, "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
    };

    const log = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString([], { hour12: false });
        const sanitizedMsg = sanitize(msg);
        const formatted = `[${timestamp}] ${sanitizedMsg}`;
        console.log(formatted);
        currentLogs.push(formatted);
        appendFileSync(testLog, formatted + '\n', "utf8");
    };

    const addStep = async (title: string, page?: puppeteer.Page) => {
        const step: TestStep = {
            title: sanitize(title),
            logs: [...currentLogs],
            status: "[PASS]"
        };
        if (page) {
            const filename = `step_${steps.length}.png`;
            const path = join(screenshotsDir, filename);
            await page.screenshot({ path, fullPage: true });
            step.screenshot = `src/screenshots/${filename}`;
        }
        steps.push(step);
        currentLogs = [];
    };

    const runWslTool = async (cmd: string, args: string[] = []) => {
        log(`[EXEC] wsl_tools.ps1 ${cmd} ${args.join(' ')}`);
        const proc = spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, cmd, ...args]);
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const code = await proc.exited;
        if (stdout.trim()) log(`[PS-STDOUT] ${stdout.trim()}`);
        if (stderr.trim()) log(`[PS-STDERR] ${stderr.trim()}`);
        return { code, stdout: stdout.trim(), stderr: stderr.trim() };
    };

    writeFileSync(testLog, `--- STRUCTURED TDD SESSION: ${new Date().toISOString()} ---\n`, "utf8");
    let highSeverityError = false;
    let browser: puppeteer.Browser | null = null;
    let serverProc: any = null;

    try {
        log("=== PHASE 1: BACKEND PREP ===");
        await runWslTool("delete", [TEST_INST]);
        const createResult = await runWslTool("new", [TEST_INST, "alpine"]);
        if (createResult.code !== 0) throw new Error("Backend 'new' failed");
        await addStep("1. Backend Infrastructure Ready");

        log("=== PHASE 2: SERVER START ===");
        if (existsSync(portFile)) unlinkSync(portFile);
        serverProc = spawn(["bun", "server.ts"], { stdout: "pipe", stderr: "pipe" });

        const pipeToLog = async (stream: ReadableStream, prefix: string) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const line of decoder.decode(value).split('\n')) {
                    if (line.trim()) log(`${prefix} ${line.trim()}`);
                }
            }
        };
        pipeToLog(serverProc.stdout, "[SRV-OUT]");
        pipeToLog(serverProc.stderr, "[SRV-ERR]");

        const portTimeout = Date.now() + 10000;
        while (!existsSync(portFile) && Date.now() < portTimeout) await new Promise(r => setTimeout(r, 500));
        if (!existsSync(portFile)) throw new Error("Server port file timeout");
        const port = readFileSync(portFile, 'utf8').trim();

        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        const uiState = { online: false, stats: false, stopped: false, deleted: false };
        page.on('console', msg => {
            const text = msg.text();
            log(`[BRW-CONSOLE] ${text}`);
            if (text.includes(`[UI_ONLINE] Instance online: ${TEST_INST}`)) uiState.online = true;
            if (text.includes(`[UI_UPDATE] Stats updated: ${TEST_INST}`)) uiState.stats = true;
            if (text.includes(`[UI_STOPPED] Instance stopped: ${TEST_INST}`)) uiState.stopped = true;
            if (text.includes(`[UI_DELETED] Instance removed: ${TEST_INST}`)) uiState.deleted = true;
        });
        page.on('dialog', async d => { log(`[BRW-DIALOG] ${d.message()}`); await d.accept(); });

        await page.goto(`http://localhost:${port}`, { waitUntil: 'networkidle0' });
        await addStep("2. Dashboard Initial Load", page);

        log("=== PHASE 3: START & TELEMETRY ===");
        await page.click(`button[aria-label="Start ${TEST_INST}"]`);
        const startTimeout = Date.now() + 45000;
        while (Date.now() < startTimeout) {
            if (uiState.online && uiState.stats) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!uiState.online || !uiState.stats) throw new Error("Start/Stats timeout");
        await addStep("3. Instance Online & Telemetry Flow", page);

        log("=== PHASE 4: STOP FLOW ===");
        await new Promise(r => setTimeout(r, 2000));
        await page.click(`button[aria-label="Stop ${TEST_INST}"]`);
        log("[4.1] Clicked Stop button");
        
        const stopTimeout = Date.now() + 45000;
        while (Date.now() < stopTimeout) {
            if (uiState.stopped) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!uiState.stopped) {
            const timeoutPath = join(screenshotsDir, 'stop_timeout.png');
            await page.screenshot({ path: timeoutPath, fullPage: true });
            throw new Error(`Stop timeout. State at timeout saved to src/screenshots/stop_timeout.png`);
        }
        await addStep("4. Graceful Stop via UI", page);

        log("=== PHASE 5: DELETE FLOW ===");
        await new Promise(r => setTimeout(r, 2000));
        log("[5.1] Triggering delete via window.app.delete evaluate...");
        await page.evaluate((name) => (window as any).app.delete(name), TEST_INST);
        
        const deleteTimeout = Date.now() + 45000;
        while (Date.now() < deleteTimeout) {
            if (uiState.deleted) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!uiState.deleted) throw new Error("Delete timeout");
        await addStep("5. Instance Unregistered & UI Cleanup", page);

        log("\nALL TESTS PASSED");

    } catch (err: any) {
        log(`\n[FAIL] FAILURE: ${err.message}`);
        steps.push({
            title: `FAILED: ${err.message}`,
            logs: [...currentLogs],
            status: "[FAIL]"
        });
        highSeverityError = true;
    } finally {
        if (browser) await browser.close();
        if (serverProc) serverProc.kill();

        log("\n=== FINAL CLEANUP ===");
        try {
            const proc = spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "delete", TEST_INST]);
            await proc.exited;
            log(`[PASS] Cleaned up ${TEST_INST}`);
        } catch (e) {
            log(`[WARN] Cleanup failed for ${TEST_INST}: ${e}`);
        }

        try {
            const readmePath = join(process.cwd(), "..", "README.md");
            let content = readFileSync(readmePath, 'utf8');
            const marker = '# Test Result';
            
            let report = `${marker}\n\n**Run:** ${new Date().toLocaleString()} | **Status:** ${highSeverityError ? '[FAIL] FAILED' : '[PASS] PASSED'}\n\n`;
            
            for (const step of steps) {
                report += `### ${step.status} ${step.title}\n\n`;
                if (step.screenshot) {
                    report += `![${step.title}](${step.screenshot})\n\n`;
                }
                if (step.logs.length > 0) {
                    report += "```text\n" + step.logs.join('\n') + "\n```\n\n";
                }
            }

            const idx = content.indexOf(marker);
            if (idx !== -1) content = content.substring(0, idx);
            writeFileSync(readmePath, content.trimEnd() + '\n\n' + report);
            console.log("README updated.");
        } catch (e) {
            console.error(e);
        }
        process.exit(highSeverityError ? 1 : 0);
    }
}

runTest();