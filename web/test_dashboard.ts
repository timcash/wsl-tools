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
    page.on('pageerror', err => {
        logToFile(`[Browser Uncaught Exception] ${err.toString()}`);
    });

    try {
        // Read dynamic port
        let port = 3000;
        try {
            port = parseInt(fs.readFileSync(".port", "utf8"));
        } catch (e) {
            logToFile("⚠️ Could not read .port file, defaulting to 3000");
        }
        const url = `http://localhost:${port}`;

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
            const img = document.querySelector('img[src="/wsl_octopus.png"]') as HTMLImageElement;
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
        logToFile('📸 Taking screenshot...');
        await page.screenshot({ path: 'dashboard_screenshot.png', fullPage: true });
        logToFile('✅ Screenshot saved to dashboard_screenshot.png');

        // 5. Simulate Error
        logToFile('🧪 Injecting test error...');
        await page.evaluate(() => {
            setTimeout(() => {
                throw new Error("Simulated Test Error for Verification");
            }, 100);
        });

        // Give it a moment to throw and be caught
        await new Promise(r => setTimeout(r, 500));

    } catch (err) {
        logToFile(`❌ Test Failed: ${err}`);
        process.exit(1);
    } finally {
        await browser.close();
        logToFile('🏁 Browser closed.');
    }
})();
