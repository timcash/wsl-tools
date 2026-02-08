import { spawn } from "bun";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";

const PS_SCRIPT = join(import.meta.dir, "..", "wsl_tools.ps1");
const TEST_INST = "Backend-Verify-Inst";

async function runPs(cmd: string, args: string[] = []) {
    console.log(`[EXEC] powershell -File ${PS_SCRIPT} ${cmd} ${args.join(' ')}`);
    const proc = spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, cmd, ...args]);
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    return { code, stdout, stderr };
}

async function test() {
    console.log("--- [STEP 1] BACKEND INDEPENDENT VERIFICATION ---");

    // 1. Cleanup
    console.log(`[1.1] Deleting ${TEST_INST} if exists...`);
    const cleanup = await runPs("delete", [TEST_INST]);
    console.log(`[1.1] Cleanup Code: ${cleanup.code}`);

    // 2. Creation
    console.log(`[1.2] Creating ${TEST_INST} (alpine)...`);
    const create = await runPs("new", [TEST_INST, "alpine"]);
    if (create.code !== 0) {
        console.error(`❌ Creation FAILED with code ${create.code}`);
        console.error(`STDOUT: ${create.stdout}`);
        console.error(`STDERR: ${create.stderr}`);
        throw new Error("Creation failed");
    }
    console.log("✅ Creation Exit Code 0");

    // 3. List Verification
    console.log(`[1.3] Verifying via list-json...`);
    const list = await runPs("list-json");
    console.log(`[DEBUG] list-json stdout: ${list.stdout}`);
    const instances = JSON.parse(list.stdout);
    const found = instances.find((i: any) => i.Name === TEST_INST);
    if (!found) throw new Error("Instance not found in list after creation");
    console.log(`✅ Found in list: ${found.Name} (${found.State})`);

    // 4. Daemon Start
    console.log(`[1.4] Starting Daemon...`);
    const daemon = await runPs("daemon", [TEST_INST]);
    if (daemon.code !== 0) throw new Error(`Daemon failed: ${daemon.stderr}`);
    
    // Wait for it to show as running
    let running = false;
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const check = await runPs("list-json");
        const inst = JSON.parse(check.stdout).find((i: any) => i.Name === TEST_INST);
        console.log(`[1.4.1] State: ${inst?.State}`);
        if (inst?.State === "Running") {
            running = true;
            break;
        }
    }
    if (!running) throw new Error("Instance never reached Running state");
    console.log("✅ Daemon Verified Running");

    // 5. Monitor Verification
    console.log(`[1.5] Verifying monitor-json...`);
    const monitor = await runPs("monitor-json", [TEST_INST]);
    const stats = JSON.parse(monitor.stdout);
    if (!stats.Memory || stats.Memory === "Unknown") {
         console.warn("⚠️ Memory is Unknown");
    } else {
        console.log(`✅ Stats: Mem ${stats.Memory}, Disk ${stats.Disk}`);
    }

    // 6. Stop
    console.log(`[1.6] Stopping...`);
    await runPs("stop", [TEST_INST]);
    const final = await runPs("list-json");
    const stopped = JSON.parse(final.stdout).find((i: any) => i.Name === TEST_INST);
    console.log(`✅ Final State: ${stopped.State}`);

    // 7. Dashboard Port Flag Verification
    console.log(`[1.7] Verifying dashboard --port flag...`);
    const DASH_PORT = 3009;
    const portFile = join(import.meta.dir, `.port.${DASH_PORT}`);
    if (existsSync(portFile)) unlinkSync(portFile);

    const dashProc = spawn(["powershell", "-ExecutionPolicy", "Bypass", "-File", PS_SCRIPT, "dashboard", "--port", DASH_PORT.toString()], {
        stdout: "pipe",
        stderr: "pipe"
    });
    
    let dashSuccess = false;
    const dashTimeout = Date.now() + 20000;
    
    while (Date.now() < dashTimeout) {
        if (existsSync(portFile)) {
            const p = readFileSync(portFile, "utf8").trim();
            if (p === DASH_PORT.toString()) {
                dashSuccess = true;
                break;
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    
    dashProc.kill();
    // Give PowerShell time to clean up its background job if needed
    await new Promise(r => setTimeout(r, 2000));
    if (existsSync(portFile)) unlinkSync(portFile);
    
    if (!dashSuccess) throw new Error("Dashboard failed to start on requested port via --port flag");
    console.log("✅ Dashboard --port flag verified");

    console.log("\n--- BACKEND VERIFIED SUCCESSFULLY ---");
}

test().catch(e => {
    console.error("❌ BACKEND VERIFICATION FAILED:", e.message);
    process.exit(1);
});
