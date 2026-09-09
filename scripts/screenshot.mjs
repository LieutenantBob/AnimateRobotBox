import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--use-gl=angle', '--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[${msg.type()}] ${msg.text()}`);
  }
});

await page.goto('http://localhost:8766/src/viewer/index.html', { waitUntil: 'networkidle', timeout: 60000 });

// Wait for controls to become visible (model loaded)
await page.waitForSelector('#controls:not(.hidden)', { timeout: 60000 });
console.log('Model loaded');
await page.waitForTimeout(2000);

// Screenshot 1: Initial state (t=0, folded)
await page.screenshot({ path: 'screenshots/01_initial.png' });
console.log('Screenshot 1: Initial (t=0)');

// Scrub to key points
const scrubber = page.locator('#scrubber');

for (const [val, label] of [['0','0%'], ['50','5%'], ['100','10%'], ['150','15%'], ['200','20%'], ['250','25%'], ['350','35%'], ['500','50%'], ['650','65%'], ['800','80%'], ['900','90%'], ['1000','100%']]) {
  await scrubber.fill(val);
  await scrubber.dispatchEvent('input');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/at_${val}.png` });
  const step = await page.evaluate(() => document.getElementById('step-label')?.textContent || '');
  console.log(`Screenshot ${label}: ${step}`);
}

// Reset to folded
await page.locator('#btn-reset').click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/folded_reset.png' });
console.log('Screenshot: Folded reset');

await browser.close();
console.log('Done!');
