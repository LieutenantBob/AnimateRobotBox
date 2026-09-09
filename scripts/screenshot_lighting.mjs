import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:8767/src/viewer/index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('#controls:not(.hidden)', { timeout: 60000 });
await page.waitForTimeout(2000);

// Click the lighting button
await page.click('#btn-lighting');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/lighting_panel.png' });
console.log('Screenshot: Lighting panel open');

// Adjust exposure to high
const exposure = page.locator('#sl-exposure');
await exposure.fill('150');
await exposure.dispatchEvent('input');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/lighting_high_exposure.png' });
console.log('Screenshot: High exposure');

// Adjust exposure to low
await exposure.fill('20');
await exposure.dispatchEvent('input');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/lighting_low_exposure.png' });
console.log('Screenshot: Low exposure');

// Reset exposure, adjust contrast high
await exposure.fill('60');
await exposure.dispatchEvent('input');
const contrast = page.locator('#sl-contrast');
await contrast.fill('180');
await contrast.dispatchEvent('input');
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/lighting_high_contrast.png' });
console.log('Screenshot: High contrast');

await browser.close();
console.log('Done!');
