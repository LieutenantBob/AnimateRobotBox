import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCinematicCamera, SHOTS } from '../../src/viewer/cinematic.js';

const shot = (t, az, dist = 1000) => ({ t, target: [0, 0, 0], az, el: 0, dist, fov: 30 });

test('camera passes exactly through every shot', () => {
  const cam = createCinematicCamera(SHOTS);
  const pos = new THREE.Vector3();
  const target = new THREE.Vector3();
  for (const s of SHOTS) {
    const fov = cam.sample(s.t, pos, target);
    assert.ok(Math.abs(fov - s.fov) < 1e-9);
    assert.ok(target.distanceTo(new THREE.Vector3(...s.target)) < 1e-6);
    assert.ok(Math.abs(pos.distanceTo(target) - s.dist) < 1e-6);
  }
});

test('camera motion is continuous (no jumps between frames)', () => {
  const cam = createCinematicCamera(SHOTS);
  const pos = new THREE.Vector3();
  const prev = new THREE.Vector3();
  const target = new THREE.Vector3();
  cam.sample(0, prev, target);
  let maxStep = 0;
  for (let i = 1; i <= 2800; i++) {
    cam.sample((i / 2800) * cam.duration, pos, target);
    maxStep = Math.max(maxStep, pos.distanceTo(prev));
    prev.copy(pos);
  }
  assert.ok(maxStep < 60, `largest per-frame camera move ${maxStep.toFixed(1)} mm`);
});

test('camera holds the first and last shot outside the timeline', () => {
  const cam = createCinematicCamera([shot(0, 0), shot(10, 90)]);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const t = new THREE.Vector3();
  cam.sample(-5, a, t);
  cam.sample(0, b, t);
  assert.ok(a.distanceTo(b) < 1e-9);
  cam.sample(99, a, t);
  cam.sample(10, b, t);
  assert.ok(a.distanceTo(b) < 1e-9);
});

test('azimuth swings toward +X and the camera eases in at the start', () => {
  const cam = createCinematicCamera([shot(0, 0), shot(10, 90)]);
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  cam.sample(0, p, t);
  assert.ok(p.distanceTo(new THREE.Vector3(0, 0, 1000)) < 1e-6); // az 0 = front (+Z)
  cam.sample(10, p, t);
  assert.ok(p.distanceTo(new THREE.Vector3(1000, 0, 0)) < 1e-6); // az 90 = +X
  const early = new THREE.Vector3();
  cam.sample(0.1, early, t);
  assert.ok(early.distanceTo(new THREE.Vector3(0, 0, 1000)) < 5); // zero start velocity
});

test('shots must be in time order', () => {
  assert.throws(() => createCinematicCamera([shot(5, 0), shot(5, 10)]), /not after/);
  assert.throws(() => createCinematicCamera([shot(0, 0)]), /at least two/);
});
