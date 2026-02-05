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

    // Capture console errors/logs
    page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error') {
            console.error(`[BROWSER ERROR] ${text}`);
        } else {
            console.log(`[BROWSER LOG] ${text}`);
        }
    });

    page.on('pageerror', err => {
        console.error(`[BROWSER PAGE ERROR] ${err.message}`);
    });

    page.on('requestfailed', request => {
        console.error(`[BROWSER REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText}`);
    });

    try {
        await page.goto(url, { waitUntil: 'networkidle0' });
        console.log("[TEST] Page loaded. Waiting 2 seconds for JS execution...");
        await new Promise(r => setTimeout(r, 2000));
    } catch (e: any) {
        console.error(`[TEST ERROR] Navigation failed: ${e.message}`);
    } finally {
        await browser.close();
    }
}

runTest().catch(err => {
    console.error(`[TEST RUNNER ERROR] ${err.message}`);
    process.exit(1);
});
