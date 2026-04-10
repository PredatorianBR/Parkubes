import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });
    page.on('pageerror', err => {
        errors.push(err.message);
    });

    await page.goto('http://localhost:3000');
    console.log("Page loaded. Waiting for 1s...");
    await page.waitForTimeout(1000);
    
    console.log("Clicking start...");
    await page.click('button:has-text("INICIAR PARTIDA")');
    await page.waitForTimeout(2000);
    
    console.log("Errors captured:");
    console.log(JSON.stringify(errors, null, 2));

    await browser.close();
})();
