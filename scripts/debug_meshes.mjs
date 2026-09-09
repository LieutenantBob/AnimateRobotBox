import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:8767/src/viewer/index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('#controls:not(.hidden)', { timeout: 60000 });

// Check which meshes are visible vs hidden at t=0
const info = await page.evaluate(() => {
  const d = window.__animationDebug;
  if (!d) return null;

  const visible = [];
  const hidden = [];
  const panels = ['Forside2', 'Bag2', 'Left2', 'Right2', 'Top2'];
  const base = ['Palle', 'Jernplade', 'Sandwich_plade'];

  d.meshNames.forEach(name => {
    const mesh = d.meshMap?.get(name);
    // Can't access meshMap directly, just list names
  });

  // Check panel parent/child relationships
  return {
    totalMeshes: d.meshNames.length,
    panelRelated: d.meshNames.filter(n => panels.some(p => n.includes(p))),
    baseRelated: d.meshNames.filter(n => base.some(b => n.includes(b))),
    numericNames: d.meshNames.filter(n => /^\d+$/.test(n)),
    emptyNames: d.meshNames.filter(n => !n),
    allNames: d.meshNames,
  };
});

console.log('Panel-related meshes:', info.panelRelated);
console.log('Base-related meshes:', info.baseRelated);
console.log('Numeric names:', info.numericNames);
console.log('Empty names:', info.emptyNames.length);
console.log('Total:', info.totalMeshes);

await browser.close();
