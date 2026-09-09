import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:8767/src/viewer/index.html', { waitUntil: 'networkidle' });
await page.waitForSelector('#controls:not(.hidden)', { timeout: 60000 });

const info = await page.evaluate(() => {
  const d = window.__animationDebug;
  if (!d || !d.meshMap) return 'no meshMap';

  const check = ['Forside2', 'Bag2', 'Left2', 'Right2', 'Top2', 'Palle', 'Jernplade', 'Sandwich_plade'];
  const results = {};
  for (const name of check) {
    const mesh = d.meshMap.get(name);
    if (mesh) {
      results[name] = {
        visible: mesh.visible,
        scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        position: [mesh.position.x.toFixed(0), mesh.position.y.toFixed(0), mesh.position.z.toFixed(0)],
        hasGeometry: !!mesh.geometry,
        vertexCount: mesh.geometry?.attributes?.position?.count || 0,
        hasMaterial: !!mesh.material,
        materialColor: mesh.material?.color ? [mesh.material.color.r.toFixed(2), mesh.material.color.g.toFixed(2), mesh.material.color.b.toFixed(2)] : null,
      };
    } else {
      results[name] = 'NOT FOUND';
    }
  }

  // Count how many meshes have scale 0 vs 1
  let scaleZero = 0, scaleOne = 0, scaleOther = 0;
  d.meshMap.forEach((mesh, name) => {
    if (mesh.scale.x === 0) scaleZero++;
    else if (mesh.scale.x === 1) scaleOne++;
    else scaleOther++;
  });

  return { meshStates: results, scaleZero, scaleOne, scaleOther };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
