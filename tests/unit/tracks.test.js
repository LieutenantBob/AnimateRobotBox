import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildPoseTrack, buildScalarTrack, easeInOutSine, makePose, samplePoseTrack, sampleScalarTrack,
} from '../../src/viewer/fold/tracks.js';
import { quatFromRotations } from '../../src/viewer/fold/rig.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const sample = (track, t) => {
  const c = new THREE.Vector3();
  const q = new THREE.Quaternion();
  samplePoseTrack(track, t, c, q);
  return { c, q };
};

test('easing starts at rest at 0 and ends at 1', () => {
  assert.ok(Math.abs(easeInOutSine(0)) < 1e-12);
  assert.ok(Math.abs(easeInOutSine(1) - 1) < 1e-12);
  assert.ok(Math.abs(easeInOutSine(0.5) - 0.5) < 1e-12);
});

test('scalar track holds before, interpolates during, holds after each move', () => {
  const track = buildScalarTrack(90, [{ start: 1, end: 2, to: -90 }, { start: 3, end: 4, to: 0 }]);
  assert.equal(sampleScalarTrack(track, 0), 90);
  assert.equal(sampleScalarTrack(track, 1), 90);
  assert.ok(Math.abs(sampleScalarTrack(track, 1.5)) < 1e-9);
  assert.equal(sampleScalarTrack(track, 2.5), -90);   // holds between moves
  assert.equal(sampleScalarTrack(track, 5), 0);
});

test('tracks reject overlapping or inverted moves', () => {
  assert.throws(() => buildScalarTrack(0, [{ start: 0, end: 2, to: 1 }, { start: 1, end: 3, to: 2 }]), /overlaps/);
  assert.throws(() => buildScalarTrack(0, [{ start: 2, end: 1, to: 1 }]), /invalid move timing/);
  assert.throws(() => buildPoseTrack(makePose(v(0, 0, 0)), [{ start: NaN, end: 1, to: makePose(v(0, 0, 0)) }]), /invalid/);
});

test('pose track is continuous: next move starts exactly where the last ended', () => {
  const packed = makePose(v(0, 0, 0), quatFromRotations([['z', 90]]));
  const staging = makePose(v(1000, 0, 0));
  const final = makePose(v(1000, 1000, 0));
  const track = buildPoseTrack(packed, [
    { start: 1, end: 2, to: staging, via: [v(0, 0, 500), v(1000, 0, 500)] },
    { start: 3, end: 4, to: final, via: [v(1000, 0, 500), v(1000, 1000, 500)] },
  ]);
  assert.ok(sample(track, 0).c.distanceTo(packed.center) < 1e-9);
  assert.ok(sample(track, 0).q.angleTo(packed.quaternion) < 1e-9);
  assert.ok(sample(track, 2).c.distanceTo(staging.center) < 1e-6);
  assert.ok(sample(track, 2.5).c.distanceTo(staging.center) < 1e-9);
  assert.ok(sample(track, 3.0001).c.distanceTo(staging.center) < 1);
  assert.ok(sample(track, 9).c.distanceTo(final.center) < 1e-9);
  assert.ok(sample(track, 9).q.angleTo(final.quaternion) < 1e-9);
});

test('pose track passes over its via points (lifts instead of cutting through)', () => {
  const track = buildPoseTrack(makePose(v(0, 0, 0)), [
    { start: 0, end: 1, to: makePose(v(1000, 0, 0)), via: [v(0, 0, 800), v(1000, 0, 800)] },
  ]);
  let maxZ = 0;
  let maxStep = 0;
  let prev = sample(track, 0).c;
  for (let i = 1; i <= 200; i++) {
    const { c } = sample(track, i / 200);
    maxZ = Math.max(maxZ, c.z);
    maxStep = Math.max(maxStep, c.distanceTo(prev));
    prev = c;
  }
  assert.ok(maxZ >= 790, `path should rise to the via height, got ${maxZ}`);
  assert.ok(maxStep < 30, `no jumps along the path, largest step ${maxStep}`);
});

test('a via point on top of the target never cuts the path short', () => {
  const to = makePose(v(1000, 0, 0));
  const track = buildPoseTrack(makePose(v(0, 0, 0)), [
    { start: 0, end: 1, to, via: [v(500, 0, 300), v(1000.5, 0, 0)] },
  ]);
  assert.ok(sample(track, 0.99999).c.distanceTo(to.center) < 0.1);
});

test('rotation only happens inside its window', () => {
  const track = buildPoseTrack(makePose(v(0, 0, 0), quatFromRotations([['x', 90]])), [
    { start: 0, end: 1, to: makePose(v(100, 0, 0)), rotWindow: [0.4, 0.6] },
  ]);
  const early = sample(track, 0.2).q;            // eased progress < 0.4
  assert.ok(early.angleTo(quatFromRotations([['x', 90]])) < 1e-9);
  assert.ok(sample(track, 0.9).q.angleTo(new THREE.Quaternion()) < 1e-9);
});

test('quatFromRotations applies rotations in the listed order', () => {
  const q = quatFromRotations([['y', 90], ['x', 90]]);
  const up = v(0, 0, 1).applyQuaternion(q);      // z -> x (by y90), x stays x (by x90)
  assert.ok(up.distanceTo(v(1, 0, 0)) < 1e-9);
  const side = v(1, 0, 0).applyQuaternion(q);    // x -> -z (by y90) -> y (by x90)
  assert.ok(side.distanceTo(v(0, 1, 0)) < 1e-9);
  assert.throws(() => quatFromRotations([['w', 10]]), /Unknown rotation axis/);
});
