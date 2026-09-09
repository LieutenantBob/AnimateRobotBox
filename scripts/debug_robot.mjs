import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:8767/src/viewer/index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('#controls:not(.hidden)', { timeout: 60000 });

const info = await page.evaluate(() => {
  const d = window.__animationDebug;
  if (!d || !d.meshMap) return 'no meshMap';

  const robotParts = ['C-2003903', 'C-2003904', 'C-2003907', 'C-2003908',
    'C-2007307', 'C-2007308', 'C-2007309', 'C-2007310', 'C-2007311', 'C-2007312',
    'C-2007588', '704-250-01_filled', '704-251-01_filled', '1005866'];

  const results = {};
  for (const name of robotParts) {
    const mesh = d.meshMap.get(name);
    if (mesh) {
      // Get geometry center
      if (mesh.geometry && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry?.boundingBox;
      const center = bb ? [(bb.min.x+bb.max.x)/2, (bb.min.y+bb.max.y)/2, (bb.min.z+bb.max.z)/2] : null;
      results[name] = {
        pos: [mesh.position.x.toFixed(0), mesh.position.y.toFixed(0), mesh.position.z.toFixed(0)],
        center: center?.map(v => v.toFixed(0)),
        vertexCount: mesh.geometry?.attributes?.position?.count || 0,
        parent: mesh.parent?.name || 'root',
      };
    }
  }
  return results;
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
