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
    const TEST_PREFIX = "TDD-";
    const TEST_INST = `${TEST_PREFIX}Unified-Final`;
    const TEST_PORT = 3002; // Use a different port than default dev server
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

    const freePort = async (port: number) => {
        log(`[SETUP] Ensuring port ${port} is free...`);
        const script = `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`;
        const proc = spawn(["powershell", "-Command", script]);
        await proc.exited;
    };

    const cleanupTddInstances = async () => {
        log("[CLEANUP] Removing any lingering TDD- instances...");
        const list = await runWslTool("list-json");
        try {
            const instances = JSON.parse(list.stdout);
            for (const inst of instances) {
                if (inst.Name.startsWith(TEST_PREFIX)) {
                    log(`[CLEANUP] Deleting ${inst.Name}`);
                    await runWslTool("delete", [inst.Name]);
                }
            }
        } catch (e) {}
    };

    writeFileSync(testLog, `--- STRUCTURED TDD SESSION: ${new Date().toISOString()} ---\n`, "utf8");
    let highSeverityError = false;
    let browser: puppeteer.Browser | null = null;
    let serverProc: any = null;

    try {
        log("=== PHASE 1: BACKEND PREP ===");
        await freePort(TEST_PORT);
        await cleanupTddInstances();
        
        const createResult = await runWslTool("new", [TEST_INST, "alpine"]);
        if (createResult.code !== 0) throw new Error("Backend 'new' failed");
        await addStep("1. Backend Infrastructure Ready");

        log("=== PHASE 2: SERVER START ===");
        if (existsSync(portFile)) unlinkSync(portFile);
        
        // Start server on TEST_PORT
        serverProc = spawn(["bun", "server.ts"], { 
            stdout: "pipe", 
            stderr: "pipe",
            env: { ...process.env, PORT: TEST_PORT.toString() }
        });

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

        await page.goto(`http://localhost:${TEST_PORT}`, { waitUntil: 'networkidle0' });
        await addStep("2. Dashboard Initial Load", page);

        log("=== PHASE 3: START & TELEMETRY ===");
        await page.click(`button[aria-label="Daemon ${TEST_INST}"]`);
        const startTimeout = Date.now() + 60000;
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

        log("=== PHASE 6: DAEMON SELF-HEALING ===");
        // 1. Re-create and start daemon
        log("[6.1] Re-creating instance for healing test...");
        await runWslTool("new", [TEST_INST, "alpine"]);
        
        log("[6.2] Waiting for UI to detect new instance...");
        await page.waitForSelector(`button[aria-label="Daemon ${TEST_INST}"]`, { timeout: 10000 });
        
        log("[6.3] Starting daemon...");
        uiState.online = false; // Reset state
        await page.click(`button[aria-label="Daemon ${TEST_INST}"]`);
        
        const healStartTimeout = Date.now() + 30000;
        while (Date.now() < healStartTimeout && !uiState.online) await new Promise(r => setTimeout(r, 1000));
        if (!uiState.online) throw new Error("Failed to start instance for healing test");
        log("[6.4] Instance is running. Now terminating it externally to test self-healing...");

        // 2. Terminate the instance directly (this should cause the daemon's wsl process to exit and then restart)
        log(`[6.5] Executing: wsl --terminate ${TEST_INST}`);
        const killProc = spawn(["wsl", "--terminate", TEST_INST]);
        await killProc.exited;

        uiState.online = false; // Reset to wait for restart
        log("[6.6] Instance terminated. Waiting for self-healing restart (approx 10-15s)...");
        await new Promise(r => setTimeout(r, 7000)); // Give daemon time to see exit and wait 5s

        const healingTimeout = Date.now() + 60000;
        let healed = false;
        while (Date.now() < healingTimeout) {
            if (uiState.online) {
                healed = true;
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!healed) throw new Error("Daemon failed to restart instance after external termination");
        log("[6.7] SELF-HEALING VERIFIED: Instance turned back on automatically.");
        await addStep("6. Daemon Self-Healing Verified", page);

        log("=== PHASE 7: OS PERSISTENCE (TASK SCHEDULER) ===");
        log("[7.1] Registering persistence for reboot...");
        await runWslTool("persist", [TEST_INST]);

        log("[7.2] Verifying task existence via Get-ScheduledTask...");
        const taskCheck = spawn(["powershell", "-Command", `Get-ScheduledTask -TaskName "WSL_Persist_${TEST_INST}"`]);
        const taskExit = await taskCheck.exited;
        
        if (taskExit !== 0) throw new Error("Scheduled Task was not created by 'persist' command");
        log("[7.3] Windows Scheduled Task verified. It will survive reboots.");

        log("[7.4] Testing unpersist cleanup...");
        await runWslTool("unpersist", [TEST_INST]);
        const taskCheckCleanup = spawn(["powershell", "-Command", `Get-ScheduledTask -TaskName "WSL_Persist_${TEST_INST}"`]);
        const taskExitCleanup = await taskCheckCleanup.exited;
        if (taskExitCleanup === 0) throw new Error("Scheduled Task was NOT removed by 'unpersist' command");
        log("[7.5] OS Persistence cleanup verified.");
        await addStep("7. OS Persistence Verified (Windows Task Scheduler)", page);

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
        await cleanupTddInstances();

        try {
            const readmePath = join(process.cwd(), "..", "README.md");
            let content = readFileSync(readmePath, 'utf8');
            const marker = '# Test Result';
            
            let statusBadge = highSeverityError ? "🔴 FAILED" : "🟢 PASSED";
            let report = `${marker}\n\n**Run:** ${new Date().toLocaleString()} | **Status:** ${statusBadge}\n\n`;
            
            if (highSeverityError) {
                report += `> ⚠️ **ERROR SUMMARY**: ${steps[steps.length-1].title}\n\n`;
            }

            for (const step of steps) {
                const sBadge = step.status === "[PASS]" ? "✅" : "❌";
                report += `### ${sBadge} ${step.title}\n\n`;
                if (step.screenshot) {
                    report += `![${step.title}](${step.screenshot})\n\n`;
                }
                if (step.logs.length > 0) {
                    // Only show first 10 and last 10 lines if log is huge
                    let displayLogs = step.logs;
                    if (displayLogs.length > 40) {
                        displayLogs = [...displayLogs.slice(0, 20), "... (omitted for brevity) ...", ...displayLogs.slice(-20)];
                    }
                    report += "```text\n" + displayLogs.join('\n') + "\n```\n\n";
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
