import puppeteer from 'puppeteer';
import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { performance } from 'perf_hooks';

async function runTest() {
    const startTime = performance.now();
    const portFile = join(process.cwd(), '.port');
    const logsFile = join(process.cwd(), 'test_results.log');
    const errorLogFile = join(process.cwd(), 'test_error.log');
    const screenshotsDir = join(process.cwd(), 'screenshots');

    const metrics = {
        totalTime: 0,
        wslStartTime: 0,
        sshLatency: 0,
        fileWriteLatency: 0
    };

    const errorCounts: Record<string, { count: number, firstStack: string, lastLine: string }> = {};
    const stepLogs: string[] = [];

    // Reset logs
    writeFileSync(logsFile, `--- Test Session: ${new Date().toISOString()} ---\n`);
    writeFileSync(errorLogFile, `--- Error Session: ${new Date().toISOString()} ---\n`);

    // Ensure screenshots directory exists
    if (!existsSync(screenshotsDir)) {
        mkdirSync(screenshotsDir);
    }

    const logStep = (msg: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const formatted = `[${timestamp}] ${msg}`;
        stepLogs.push(formatted);
        console.log(formatted);
        appendFileSync(logsFile, formatted + '\n');
    };

    const trackError = (type: string, stack: string = '') => {
        if (!errorCounts[type]) {
            const lines = stack.split('\n');
            errorCounts[type] = {
                count: 0,
                firstStack: stack,
                lastLine: lines[lines.length - 1] || 'N/A'
            };
        }
        errorCounts[type].count++;

        if (stack) {
            appendFileSync(errorLogFile, `[${new Date().toISOString()}] ${type}\n${stack}\n---\n`);
        }
    };

    let highSeverityError = false;
    let uiStatsUpdated = false;
    let uiOnlineDetected = false;
    let finalExists = false;
    const testInstanceName = 'Pre-flight-Backend-Test';

    let dashboardProc: any;
    let browser: any;

    try {
        // --- Setup: Start Dashboard Server ---
        logStep("[TEST] Starting Dashboard Server internally...");
        if (existsSync(portFile)) unlinkSync(portFile);

        dashboardProc = Bun.spawn(["bun", "server.ts"], {
            stdout: "pipe", // Capture it to avoid cluttering test output OR "inherit" if you want to see it
            stderr: "inherit"
        });

        // Wait for .port file to appear (max 10s)
        let port = "";
        const portTimeout = Date.now() + 10000;
        while (!existsSync(portFile) && Date.now() < portTimeout) {
            await new Promise(r => setTimeout(r, 500));
        }

        if (!existsSync(portFile)) {
            throw new Error("Dashboard server failed to start or didn't write .port file.");
        }

        port = readFileSync(portFile, 'utf8').trim();
        const url = `http://localhost:${port}`;
        logStep(`[TEST] Dashboard active at ${url}`);

        // --- Phase 1: Backend Verification ---
        logStep(`PHASE 1: Backend Verification (${testInstanceName})`);
        const PS_SCRIPT = "..\\wsl_tools.ps1";

        const runPs = async (cmd: string, args: string[] = []) => {
            const fullCmd = [cmd, ...args];
            logStep(`[BACKEND] Running: powershell ${fullCmd.join(' ')}`);
            const proc = Bun.spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, ...fullCmd]);
            const output = await new Response(proc.stdout).text();
            const success = (await proc.exited) === 0;
            return { success, output };
        };

        // 1. Cleanup & Detect State
        logStep(`[BACKEND] Cleaning up potential stale instance: ${testInstanceName}`);
        await runPs("delete", [testInstanceName]);

        const initialList = await runPs("list-json");
        const initialCount = initialList.success ? JSON.parse(initialList.output).length : 0;
        logStep(`[BACKEND] Initial instance count: ${initialCount}`);

        // 2. Creation
        const createResult = await runPs("new", [testInstanceName, "alpine"]);
        if (!createResult.success) {
            logStep(`❌ FAILED: Backend creation failed. Output: ${createResult.output}`);
            highSeverityError = true;
        } else {
            logStep(`[BACKEND] Creation successful.`);

            // 3. Log Verification
            const psLogPath = join(import.meta.dir, 'powershell.log');
            if (existsSync(psLogPath)) {
                // Read last 100 lines to ensure we see the latest entry
                const logContent = readFileSync(psLogPath, 'utf8');
                if (logContent.includes(`Command Entry: new ${testInstanceName}`)) {
                    logStep("✅ SUCCESS: Backend creation verified in powershell.log");
                } else {
                    logStep("❌ FAILED: Creation command not found in powershell.log");
                    highSeverityError = true;
                }
            }

            // 4. Count Verification
            const listCheck = await runPs("list-json");
            if (listCheck.success) {
                const instances = JSON.parse(listCheck.output);
                const finalCount = instances.length;
                const found = instances.some((i: any) => i.Name === testInstanceName);

                if (found && finalCount === initialCount + 1) {
                    logStep(`✅ SUCCESS: Instance verified via list-json. Count: ${finalCount}`);
                } else {
                    logStep(`❌ FAILED: Instance count delta failed. Found: ${found}, Count: ${finalCount} (Expected: ${initialCount + 1})`);
                    highSeverityError = true;
                }
            }
        }

        if (highSeverityError) {
            logStep("[CRITICAL] Phase 1 (Backend) failed. Aborting Phase 2.");
        } else {
            // Start daemon
            logStep(`[BACKEND] Starting daemon for ${testInstanceName}`);
            await runPs("daemon", [testInstanceName]);

            // --- Phase 2: Browser Verification ---
            logStep("PHASE 2: Browser Verification");
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            const page = await browser.newPage();

            page.on('console', msg => {
                const text = msg.text();
                const type = msg.type();
                logStep(`[BROWSER][${type.toUpperCase()}] ${text}`);

                if (text === 'error-ping' && type === 'error') {
                    // Handshake detected
                } else if (text.startsWith('[UI_UPDATE] Stats updated:')) {
                    if (!text.includes('Mem: --')) {
                        uiStatsUpdated = true;
                    }
                } else if (text.startsWith('[UI_ONLINE] Instance online:')) {
                    if (text.includes(testInstanceName)) {
                        uiOnlineDetected = true;
                    }
                } else if (type === 'error') {
                    if (!text.includes('favicon.ico') && !text.includes('Failed to load resource')) {
                        trackError(`Console Error: ${text.substring(0, 50)}`, text);
                        highSeverityError = true;
                    }
                }
            });

            await page.goto(url, { waitUntil: 'networkidle0' });

            // Handshake
            await page.evaluate(() => console.error('error-ping'));
            await new Promise(r => setTimeout(r, 1000));

            logStep(`Checking for ${testInstanceName} in UI...`);
            await page.screenshot({ path: join(screenshotsDir, 'screenshot_initial.png'), fullPage: true });

            // Wait for Online State
            const timeout = performance.now() + 60000;
            while (!uiOnlineDetected && performance.now() < timeout) {
                await new Promise(r => setTimeout(r, 1000));
            }

            if (uiOnlineDetected) {
                logStep(`✅ UI Online verified for ${testInstanceName}`);
                await page.screenshot({ path: join(screenshotsDir, 'screenshot_after_add.png'), fullPage: true });
            } else {
                logStep(`❌ FAILED: UI Online event timeout (${testInstanceName})`);
                highSeverityError = true;
            }

            // Final state check
            finalExists = await page.evaluate((name) => {
                const card = document.getElementById(`card-${name}`);
                if (!card) return false;
                const badge = card.querySelector('.badge');
                return badge && badge.textContent === 'Running';
            }, testInstanceName);

            if (finalExists) {
                logStep(`✅ SUCCESS: ${testInstanceName} is active and running in UI.`);
                await page.screenshot({ path: join(screenshotsDir, 'screenshot_final.png'), fullPage: true });
            } else {
                logStep(`❌ FAILED: ${testInstanceName} not running or missing from UI.`);
                highSeverityError = true;
            }
        }

    } catch (err: any) {
        logStep(`[CRITICAL TEST ERR] ${err.message}`);
        highSeverityError = true;
    } finally {
        if (browser) await browser.close();
        if (dashboardProc) {
            logStep("[TEST] Stopping Dashboard Server...");
            dashboardProc.kill();
        }

        metrics.totalTime = performance.now() - startTime;

        // --- README Report ---
        try {
            const readmePath = join(import.meta.dir, '..', 'README.md');
            let readmeContent = readFileSync(readmePath, 'utf8');
            const marker = '## Test Result';
            const timestamp = new Date().toLocaleString();

            const errorSummary = Object.keys(errorCounts).length > 0
                ? `| Error | Count | Last |\n| :--- | :--- | :--- | \n` +
                Object.entries(errorCounts).map(([t, d]) => `| ${t} | ${d.count} | ${d.lastLine} |`).join('\n')
                : `*No errors.*`;

            const metricsTable = `| Metric | Status |\n| :--- | :--- |\n` +
                `| Total Time | ${(metrics.totalTime / 1000).toFixed(2)}s |\n` +
                `| Backend-First | ${!highSeverityError ? '✅ Verified' : '❌ Failed'} |\n` +
                `| Live discovery | ${uiOnlineDetected ? '✅ YES' : '❌ NO'} |`;

            const testResultContent = `${marker}\n\n` +
                `**Last Run:** ${timestamp}  \n` +
                `**Status:** ${highSeverityError ? '❌ FAILED' : '✅ SUCCESS'}  \n\n` +
                `### Metrics\n\n${metricsTable}\n\n` +
                `### Trace\n` + "```text\n" + stepLogs.join('\n') + "\n```\n\n" +
                `### UI Errors\n\n${errorSummary}\n\n` +
                `### Visual Audit\n\n` +
                `#### Ready State\n![Ready](src/screenshots/screenshot_initial.png)\n\n` +
                `#### Online State\n${uiOnlineDetected ? '![Online](src/screenshots/screenshot_after_add.png)' : '❌ Missing'}\n\n` +
                `#### Final State\n${finalExists ? '![Final](src/screenshots/screenshot_final.png)' : '❌ Missing'}\n`;

            const idx = readmeContent.indexOf(marker);
            if (idx !== -1) readmeContent = readmeContent.substring(0, idx);
            writeFileSync(readmePath, readmeContent.trimEnd() + '\n\n' + testResultContent);
            console.log("[TEST] README.md updated.");
        } catch (e: any) {
            console.error(`[TEST] Report fail: ${e.message}`);
        }

        if (highSeverityError) process.exit(1);
        process.exit(0);
    }
}

runTest().catch(console.error);
