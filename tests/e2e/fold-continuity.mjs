/**
 * End-to-end continuity check for the fold animation.
 *
 * Boots the Vite dev server, loads the real model in headless Chromium,
 * scrubs the whole timeline and fails if any part:
 *   - is ever hidden (pop in / pop out)
 *   - jumps further than a plausible per-frame distance (teleport)
 *   - goes below the floor
 *   - sticks out of the closed box at t=0 (packed parts)
 *   - is not exactly at its CAD position at the end
 *
 * Usage: npm run test:e2e   (needs assets/decimated/unfolded/robot_decimated.glb)
 */
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import { BOX_INTERIOR, FLOOR_Z } from '../../src/viewer/fold/layout.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES = 1400;          // ~0.02 s apart
const MAX_STEP_MM = 120;       // 6 m/s at 0.02 s per sample
const TOLERANCE_MM = 3;

const server = await createServer({ configFile: path.join(projectRoot, 'vite.config.js'), server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle'] });

try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('#controls:not(.hidden)', { timeout: 120000 });

  const report = await page.evaluate(({ SAMPLES, MAX_STEP_MM, TOLERANCE_MM, BOX_INTERIOR, FLOOR_Z }) => {
    const dbg = window.__animationDebug;
    const meshes = [...dbg.meshMap.values()];
    let root = meshes[0]; while (root.parent && !root.parent.isScene) root = root.parent;
    const Box3 = meshes[0].geometry.boundingBox.constructor;
    const Vec3 = meshes[0].position.constructor;
    const toCad = (v) => [v.x, -v.z, v.y]; // world Y-up -> CAD Z-up

    const failures = [];
    const fail = (msg) => { if (failures.length < 60) failures.push(msg); };
    const isVisible = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
    const center = (m) => {
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      return toCad(m.geometry.boundingBox.getCenter(new Vec3()).applyMatrix4(m.matrixWorld));
    };
    const cadBox = (o) => {
      const b = new Box3().setFromObject(o, true);
      const [x0, y0, z0] = toCad(b.min); const [x1, y1, z1] = toCad(b.max);
      return { min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)] };
    };

    // 1. Continuity + visibility over the whole timeline.
    let prev = null;
    let worstStep = { d: 0 };
    const teleports = new Map();
    const hiddenParts = new Map();
    for (let i = 0; i <= SAMPLES; i++) {
      const t = (i / SAMPLES) * dbg.totalDuration;
      dbg.update(t);
      root.updateMatrixWorld(true);
      const now = meshes.map(center);
      meshes.forEach((m, k) => {
        if (!isVisible(m) && !hiddenParts.has(m.name)) hiddenParts.set(m.name, t);
        if (prev) {
          const d = Math.hypot(now[k][0] - prev[k][0], now[k][1] - prev[k][1], now[k][2] - prev[k][2]);
          if (d > worstStep.d) worstStep = { d: Math.round(d), name: m.name, t: +t.toFixed(2) };
          if (d > MAX_STEP_MM && d > (teleports.get(m.name)?.d ?? 0)) teleports.set(m.name, { d, t });
        }
      });
      prev = now;
    }
    for (const [name, t] of hiddenParts) fail(`hidden: ${name} from t=${t.toFixed(2)}`);
    for (const [name, { d, t }] of teleports) fail(`teleport: ${name} moved ${Math.round(d)} mm in one sample at t=${t.toFixed(2)}`);

    // 2. Moving groups never dip below the floor (exact vertex bounds, coarse sampling).
    const groups = [];
    root.traverse((n) => { if (n.name.startsWith('__asm_') || n.name.startsWith('__hinge_')) groups.push(n); });
    for (let i = 0; i <= 112; i++) {
      const t = (i / 112) * dbg.totalDuration;
      dbg.update(t);
      root.updateMatrixWorld(true);
      for (const g of groups) {
        const b = cadBox(g);
        if (b.min[2] < FLOOR_Z - TOLERANCE_MM) fail(`below floor: ${g.name} z=${Math.round(b.min[2])} at t=${t.toFixed(2)}`);
      }
    }

    // 3. Packed parts are inside the closed box at t=0.
    dbg.update(0);
    root.updateMatrixWorld(true);
    const packed = groups.filter((g) => g.name.startsWith('__asm_') && !g.name.startsWith('__asm_foot') || g.name === '__hinge_robot');
    const boxes = new Map(packed.map((g) => [g.name, cadBox(g)]));
    for (const [name, b] of boxes) {
      for (let a = 0; a < 3; a++) {
        if (b.min[a] < BOX_INTERIOR.min[a] - TOLERANCE_MM || b.max[a] > BOX_INTERIOR.max[a] + TOLERANCE_MM) {
          fail(`outside closed box: ${name} [${b.min.map(Math.round)}]..[${b.max.map(Math.round)}]`);
          break;
        }
      }
    }
    // Feet start stacked on top of the closed lid (above z=1054).
    for (const g of groups.filter((n) => n.name.startsWith('__asm_foot'))) {
      const b = cadBox(g);
      if (b.min[2] < 1054 - TOLERANCE_MM) fail(`foot not on the lid stack at t=0: ${g.name} z=${Math.round(b.min[2])}`);
    }
    // Informational: bounding-box overlaps between packed groups (boxes overestimate).
    const overlaps = [];
    const names = [...boxes.keys()];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const p = boxes.get(names[i]), q = boxes.get(names[j]);
      const ov = [0, 1, 2].map((a) => Math.max(0, Math.min(p.max[a], q.max[a]) - Math.max(p.min[a], q.min[a])));
      const vol = ov[0] * ov[1] * ov[2] / 1e6;
      if (vol > 1) overlaps.push(`${names[i]} x ${names[j]}: ${vol.toFixed(0)} L`);
    }

    // 4. End state is exactly the CAD layout (every mesh transform back to identity).
    dbg.update(dbg.totalDuration);
    root.updateMatrixWorld(true);
    const worldNode = root.getObjectByName('world') ?? root;
    for (const m of meshes) {
      const a = m.matrixWorld.elements, b = worldNode.matrixWorld.elements;
      const err = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
      if (err > 0.5) fail(`not at CAD position at end: ${m.name} (max element error ${err.toFixed(2)})`);
    }

    return { failures, worstStep, overlaps, meshCount: meshes.length, missing: dbg.missing, roles: [...dbg.roles.values()].reduce((acc, r) => { const k = r.split(':')[0]; acc[k] = (acc[k] || 0) + 1; return acc; }, {}) };
  }, { SAMPLES, MAX_STEP_MM, TOLERANCE_MM, BOX_INTERIOR, FLOOR_Z });

  console.log(`meshes: ${report.meshCount}, roles: ${JSON.stringify(report.roles)}`);
  console.log(`largest per-sample move: ${JSON.stringify(report.worstStep)}`);
  if (report.missing.length) console.log(`parts named in layout but missing from model: ${report.missing.join(', ')}`);
  if (report.overlaps.length) console.log(`packed bounding-box overlaps at t=0 (info):\n  ${report.overlaps.join('\n  ')}`);
  const failures = [...pageErrors.map((e) => `page error: ${e}`), ...report.failures];
  if (failures.length) {
    console.error(`\nFAILED (${failures.length}${failures.length >= 60 ? '+' : ''}):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log('\nPASSED: no pops, no teleports, nothing below the floor, packed parts inside the box, exact end pose.');
  }
} finally {
  await browser.close();
  await server.close();
}
