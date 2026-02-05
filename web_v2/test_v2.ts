import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { join } from 'path';

async function runTest() {
    const portFile = join(process.cwd(), '.port');
    const port = readFileSync(portFile, 'utf8').trim();
    const url = `http://localhost:${port}`;

    console.log(`[TEST] Connecting to ${url}...`);

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    let statsReceived = false;

    page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') console.error(`[BROWSER ERROR] ${text}`);
        else {
            console.log(`[BROWSER LOG] ${text}`);
            if (text.includes('Received: stats')) statsReceived = true;
        }
    });

    try {
        await page.goto(url, { waitUntil: 'networkidle0' });

        // --- Test Placeholder Logic ---
        console.log("[TEST] Testing 'Add Instance' placeholder...");
        await page.type('#new-name', 'Puppeteer-Test-Instance');
        await page.click('button.btn-primary');

        // Check if card exists immediately
        const cardExists = await page.evaluate(() => {
            return !!document.getElementById('card-Puppeteer-Test-Instance');
        });

        if (cardExists) {
            console.log("[TEST] ✅ Placeholder card appeared immediately!");
        } else {
            console.error("[TEST] ❌ Placeholder card did NOT appear.");
        }

        // Wait a bit for stats
        console.log("[TEST] Waiting for stats logic...");
        for (let i = 0; i < 20; i++) {
            if (statsReceived) break;
            await new Promise(r => setTimeout(r, 500));
        }

        if (statsReceived) {
            console.log("[TEST] ✅ Stats verification passed.");
        }

    } catch (e: any) {
        console.error(`[TEST ERROR]: ${e.message}`);
    } finally {
        await browser.close();
    }
}

runTest().catch(process.exit);
