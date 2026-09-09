import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

page.on('console', msg => {
  if (msg.type() === 'error') console.log(`[CONSOLE ERROR] ${msg.text()}`);
  if (msg.type() === 'warning') console.log(`[CONSOLE WARN] ${msg.text()}`);
});
page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

await page.goto('http://localhost:8767/src/viewer/index.html', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('#controls:not(.hidden)', { timeout: 60000 });
await page.waitForTimeout(2000);

// Screenshot initial state
await page.screenshot({ path: 'screenshots/eval_00_initial.png' });
console.log('00 - Initial load');

// Scrub through every 2 seconds of the 28s animation
const totalDuration = 28;
const scrubber = page.locator('#scrubber');

for (let t = 0; t <= totalDuration; t += 2) {
  const val = Math.round((t / totalDuration) * 1000);
  await scrubber.fill(String(val));
  await scrubber.dispatchEvent('input');
  await page.waitForTimeout(300);
  const step = await page.evaluate(() => document.getElementById('step-label')?.textContent || '');
  const padded = String(t).padStart(2, '0');
  await page.screenshot({ path: `screenshots/eval_t${padded}.png` });
  console.log(`t=${t}s (${val}/1000) — ${step}`);
}

// Check for any JS errors that accumulated
const errors = await page.evaluate(() => {
  return window.__jsErrors || [];
});
if (errors.length > 0) console.log('JS Errors:', errors);

// Check WebGL context
const webglOk = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return 'no canvas';
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return gl ? 'ok' : 'no webgl';
});
console.log('WebGL:', webglOk);

// Check mesh stats
const stats = await page.evaluate(() => {
  const d = window.__animationDebug;
  if (!d) return null;
  let visible = 0, hidden = 0;
  d.meshMap.forEach((m) => {
    if (m.scale.x > 0.5) visible++; else hidden++;
  });
  return {
    total: d.meshNames.length,
    animated: d.animatedParts.size,
    alwaysVisible: d.alwaysVisible.size,
    currentlyVisible: visible,
    currentlyHidden: hidden,
  };
});
console.log('Mesh stats at t=end:', JSON.stringify(stats));

await browser.close();
console.log('Done!');
