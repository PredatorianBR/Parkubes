import { chromium } from 'playwright';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    page.on('console', msg => {
        console.log(`[BROWSER ${msg.type()}]:`, msg.text());
        if (msg.type() === 'error') {
            errors.push(msg.text());
        }
    });
    page.on('pageerror', err => {
        console.error('[BROWSER EXCEPTION]:', err.message);
        errors.push(err.message);
    });

    await page.goto('http://localhost:3000');
    console.log("Page loaded. Waiting for 1s...");
    await page.waitForTimeout(1000);
    
    console.log("Selecting ESCONDE-ESCONDE mode...");
    await page.click('button:has-text("ESCONDE-ESCONDE")');
    await page.waitForTimeout(500);

    console.log("Clicking INICIAR PARTIDA...");
    await page.click('button:has-text("INICIAR PARTIDA")');
    
    for (let i = 1; i <= 6; i++) {
        await page.waitForTimeout(1000);
        const state = await page.evaluate(() => {
            const aiPos = window.__PARKUBES_AI_POS?.current;
            const pPos = window.__PARKUBES_PLAYER_POS?.current;
            const path = window.__PARKUBES_AI_PATH?.current;
            const pIdx = window.__PARKUBES_AI_PATH_INDEX?.current;
            const spot = window.__PARKUBES_AI_HIDING_SPOT?.current;
            const graph = window.__PARKUBES_NAV_GRAPH;
            
            let pathToPlayer = null;
            let pathToSpot = null;
            if (graph && aiPos && pPos) {
                const p1 = graph.findPath(aiPos, pPos);
                pathToPlayer = p1 ? p1.map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z })) : 'NULL';
            }
            if (graph && aiPos && spot) {
                const p2 = graph.findPath(aiPos, spot);
                pathToSpot = p2 ? p2.map(n => ({ id: n.id, x: n.x, y: n.y, z: n.z })) : 'NULL';
            }

            return {
                aiPos: aiPos ? { x: aiPos.x.toFixed(2), y: aiPos.y.toFixed(2), z: aiPos.z.toFixed(2) } : null,
                pPos: pPos ? { x: pPos.x.toFixed(2), y: pPos.y.toFixed(2), z: pPos.z.toFixed(2) } : null,
                spot: spot ? { x: spot.x.toFixed(2), y: spot.y.toFixed(2), z: spot.z.toFixed(2) } : null,
                pathLen: path ? path.length : 0,
                pathToPlayerLen: Array.isArray(pathToPlayer) ? pathToPlayer.length : pathToPlayer,
                pathToSpotLen: Array.isArray(pathToSpot) ? pathToSpot.length : pathToSpot,
                firstNode: Array.isArray(pathToPlayer) && pathToPlayer[0] ? pathToPlayer[0] : null
            };
        });
        console.log(`[Second ${i}]:`, JSON.stringify(state));
    }

    console.log("Errors captured:");
    console.log(JSON.stringify(errors, null, 2));

    await browser.close();
})();
