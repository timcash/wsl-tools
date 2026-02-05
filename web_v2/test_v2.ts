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

    let listMessages = 0;
    let statsReceived = false;

    // Enhanced request logging
    page.on('requestfailed', request => {
        console.error(`[BROWSER REQUEST FAILED] ❌ ${request.url()} - ${request.failure()?.errorText || 'Unknown Error'}`);
    });

    page.on('response', response => {
        if (!response.ok()) {
            console.error(`[BROWSER ERROR] ${response.status()} ${response.url()}`);
        }
    });

    page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') {
            console.error(`[BROWSER ERROR LOG] ${text}`);
        } else {
            console.log(`[BROWSER LOG] ${text}`);
            if (text.includes('Received: list')) listMessages++;
            if (text.includes('Received: stats')) statsReceived = true;
        }
    });

    try {
        await page.goto(url, { waitUntil: 'networkidle0' });

        console.log("[TEST] Adding instance 'Grace-Persistence-Test'...");
        await page.type('#new-name', 'Grace-Persistence-Test');
        await page.click('button.btn-primary');

        // Check immediate appearance
        const initialExists = await page.evaluate(() => !!document.getElementById('card-Grace-Persistence-Test'));
        console.log(`[TEST] Immediate appearance: ${initialExists}`);

        console.log("[TEST] Waiting 12 seconds to verify persistence through sync cycles...");
        // Wait and check if it still exists
        for (let i = 0; i < 12; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const exists = await page.evaluate(() => !!document.getElementById('card-Grace-Persistence-Test'));
            if (!exists) {
                console.error(`[TEST] ❌ FAILED: Card disappeared at second ${i + 1}`);
                break;
            }
        }

        const finalExists = await page.evaluate(() => !!document.getElementById('card-Grace-Persistence-Test'));
        if (finalExists) {
            console.log("[TEST] ✅ SUCCESS: Card persisted through multiple sync cycles.");
        }

    } catch (e: any) {
        console.error(`[TEST ERROR]: ${e.message}`);
    } finally {
        await browser.close();
    }
}

runTest().catch(process.exit);
