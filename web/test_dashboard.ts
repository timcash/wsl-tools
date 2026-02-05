/// <reference lib="dom" />
import puppeteer from 'puppeteer';
import { file, write } from 'bun';
import * as fs from 'fs';

const LOG_FILE = 'dashboard_test.log';

// Clear previous log
if (fs.existsSync(LOG_FILE)) {
    fs.unlinkSync(LOG_FILE);
}

function logToFile(message: string) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line);
    process.stdout.write(line); // Also keep consistent stdout
}

(async () => {
    logToFile('🚀 Starting Dashboard Verification...');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // often needed in containers/wsl
    });

    const page = await browser.newPage();

    // 1. Console Log Interception
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        logToFile(`[Browser Console] ${type.toUpperCase()}: ${text}`);

        if (type === 'error') {
            logToFile(`[Browser Error Log] ${text}`);
        }
    });

    // 2. Page Error Interception (Uncaught Exceptions)
    page.on('pageerror', (err: any) => {
        logToFile(`[Browser Uncaught Exception] ${err.toString()}`);
    });

    try {
        // Read dynamic port
        let port = 3000;
        try {
            port = parseInt(fs.readFileSync(".port", "utf8"));
        } catch (e: any) {
            logToFile("⚠️ Could not read .port file, defaulting to 3000");
        }
        const url = `http://localhost:${port}`;

        // Track WebSockets
        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        client.on('Network.webSocketFrameReceived', (params: any) => {
            logToFile(`[WS Received] ${params.response.payloadData}`);
        });
        client.on('Network.webSocketFrameSent', (params: any) => {
            logToFile(`[WS Sent] ${params.response.payloadData}`);
        });

        logToFile(`🌐 Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'networkidle0' });

        logToFile('✅ Navigation successful.');

        // 3. Verify Title
        const title = await page.title();
        logToFile(`📄 Page Title: "${title}"`);
        if (title !== "WSL Operations") {
            throw new Error(`Expected title "WSL Operations", got "${title}"`);
        }

        // 4. Verify Image Loads
        logToFile('🖼️ Verifying Image Load...');
        const imageLoaded = await page.evaluate(() => {
            const img = document.querySelector('img[src="/wsl_cpu_network.png"]') as HTMLImageElement;
            if (!img) return { found: false, src: null, loaded: false };
            return { found: true, src: img.src, loaded: img.complete && img.naturalWidth > 0 };
        });

        if (!imageLoaded.found) {
            throw new Error("Image element not found in DOM");
        }
        logToFile(`🖼️ Found image with src: ${imageLoaded.src}`);

        if (!imageLoaded.loaded) {
            throw new Error(`Image found but failed to load (complete=${imageLoaded.loaded})`);
        }
        logToFile('✅ Image loaded successfully.');

        // 5. Screenshot
        logToFile('📸 Taking initial screenshot...');
        await page.screenshot({ path: 'dashboard_pre_test.png', fullPage: true });

        // 6. Test Add Instance
        const testInstanceName = `test-run-${Math.floor(Math.random() * 1000)}`;
        logToFile(`🧪 Testing Add Instance: "${testInstanceName}"...`);

        await page.type('#newInstanceName', testInstanceName);
        await page.click('#addBtn');
        logToFile('🖱️ Clicked "Add Instance" button.');

        // 7. Wait for the instance to appear (Alpine creation is fast)
        logToFile('⏳ Waiting for Alpine instance to appear...');
        await page.waitForFunction(
            (name) => {
                const cards = Array.from(document.querySelectorAll('.card-name'));
                return cards.some(c => c.textContent?.trim() === name);
            },
            { timeout: 30000 },
            testInstanceName
        );
        logToFile(`✅ Instance "${testInstanceName}" appeared.`);

        // 8. Start the instance
        logToFile(`🚀 Starting instance "${testInstanceName}"...`);
        await page.evaluate((name) => {
            const cards = Array.from(document.querySelectorAll('.card'));
            const card = cards.find(c => c.querySelector('.card-name')?.textContent?.trim() === name);
            const startBtn = card?.querySelector('.btn-success') as HTMLButtonElement;
            if (startBtn) startBtn.click();
        }, testInstanceName);

        // 9. Wait for "Running" status
        logToFile('⏳ Waiting for "Running" state...');
        await page.waitForFunction(
            (name) => {
                const card = Array.from(document.querySelectorAll('.card')).find(c => c.querySelector('.card-name')?.textContent?.trim() === name);
                return card?.querySelector('.status-dot')?.classList.contains('running');
            },
            { timeout: 20000 },
            testInstanceName
        );
        logToFile('✅ Instance is Running.');

        // 10. Provision: Install git and clone dialtone (Following test_complex_setup.ps1 logic)
        logToFile('🛠️ Provisioning: Installing git/bash and cloning "dialtone"...');
        await page.evaluate((name) => {
            // @ts-ignore
            window.ws.send(JSON.stringify({
                type: 'shell',
                name,
                cmd: 'apk update && apk add git bash'
            }));
        }, testInstanceName);

        logToFile('⏳ Waiting 15s for packages to install...');
        await new Promise(r => setTimeout(r, 15000));

        await page.evaluate((name) => {
            // @ts-ignore
            window.ws.send(JSON.stringify({
                type: 'shell',
                name,
                cmd: 'git clone https://github.com/timcash/dialtone /root/dialtone'
            }));
        }, testInstanceName);

        logToFile('⏳ Waiting 10s for git clone...');
        await new Promise(r => setTimeout(r, 10000));

        // 11. Final Verification & Screenshot
        logToFile('📸 Taking final screenshot after provisioning...');
        await page.screenshot({ path: 'dashboard_final.png', fullPage: true });

        logToFile('🏁 Test lifecycle complete.');

        // Give it a moment to throw and be caught
        await new Promise(r => setTimeout(r, 500));

    } catch (err: any) {
        logToFile(`❌ Test Failed: ${err.message || err}`);
        process.exit(1);
    } finally {
        await browser.close();
        logToFile('🏁 Browser closed.');
    }
})();
