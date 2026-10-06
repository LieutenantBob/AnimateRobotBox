/**
 * Cinematic camera: keyframed "shots" on the animation timeline.
 *
 * Each shot gives an orbit (azimuth / elevation / distance around a target)
 * and a field of view. Every channel is interpolated with a time-aware cubic
 * Hermite spline (Catmull-Rom tangents from neighbouring shots, zero velocity
 * at the first and last shot), so the camera glides through the shots with
 * continuous velocity instead of stopping at each one.
 *
 * World is Y-up, millimetres. Azimuth 0 looks at the product's front
 * (world +Z side), positive azimuth swings toward +X.
 */
import * as THREE from 'three';

/** @typedef {{ t: number, target: [number, number, number], az: number, el: number, dist: number, fov: number }} Shot */

/** @type {Shot[]} */
export const SHOTS = [
  { t: 0.0, target: [600, 560, -450], az: 30, el: 5, dist: 4300, fov: 28 },   // low hero on the closed box
  { t: 4.5, target: [600, 620, -450], az: 14, el: 11, dist: 4100, fov: 30 },  // feet hung on the walls
  { t: 8.0, target: [600, 650, -450], az: -10, el: 30, dist: 4400, fov: 32 }, // look into the open box
  { t: 11.5, target: [600, 450, -400], az: -28, el: 27, dist: 5800, fov: 34 },
  { t: 15.0, target: [600, 250, -350], az: -40, el: 30, dist: 7600, fov: 36 }, // walls down, wide
  { t: 19.5, target: [600, 500, -800], az: -52, el: 21, dist: 7600, fov: 36 }, // shelf and screen
  { t: 23.5, target: [700, 330, -420], az: -18, el: 19, dist: 6900, fov: 34 }, // workstation
  { t: 28.0, target: [760, 420, -640], az: 30, el: 15, dist: 7300, fov: 34 },  // closing hero 3/4
];

function validate(shots) {
  if (shots.length < 2) throw new Error('Cinematic camera needs at least two shots');
  for (let i = 1; i < shots.length; i++) {
    if (!(shots[i].t > shots[i - 1].t)) throw new Error(`Shot ${i} is not after shot ${i - 1}`);
  }
}

/** Time-aware Catmull-Rom tangents for one channel. */
function tangents(times, values) {
  const n = values.length;
  return values.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    return (values[i + 1] - values[i - 1]) / (times[i + 1] - times[i - 1]);
  });
}

function hermite(p0, p1, m0, m1, h, s) {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * h * m0
    + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * h * m1;
}

export function createCinematicCamera(shots = SHOTS) {
  validate(shots);
  const times = shots.map((s) => s.t);
  const channels = {
    tx: shots.map((s) => s.target[0]),
    ty: shots.map((s) => s.target[1]),
    tz: shots.map((s) => s.target[2]),
    az: shots.map((s) => s.az),
    el: shots.map((s) => s.el),
    dist: shots.map((s) => s.dist),
    fov: shots.map((s) => s.fov),
  };
  // Precomputed once so evaluate() allocates nothing per frame.
  const tracks = Object.entries(channels).map(([key, values]) => ({ key, values, slopes: tangents(times, values) }));
  const value = {};

  function evaluate(t) {
    const tc = Math.min(times[times.length - 1], Math.max(times[0], t));
    let i = 0;
    while (i < times.length - 2 && tc > times[i + 1]) i++;
    const h = times[i + 1] - times[i];
    const s = (tc - times[i]) / h;
    for (const { key, values, slopes } of tracks) {
      value[key] = hermite(values[i], values[i + 1], slopes[i], slopes[i + 1], h, s);
    }
    return value;
  }

  /**
   * Writes camera position and look-at target for time t; returns the fov.
   */
  function sample(t, outPosition, outTarget) {
    const v = evaluate(t);
    const az = THREE.MathUtils.degToRad(v.az);
    const el = THREE.MathUtils.degToRad(v.el);
    outTarget.set(v.tx, v.ty, v.tz);
    outPosition.set(
      v.tx + v.dist * Math.cos(el) * Math.sin(az),
      v.ty + v.dist * Math.sin(el),
      v.tz + v.dist * Math.cos(el) * Math.cos(az),
    );
    return v.fov;
  }

  return { sample, duration: times[times.length - 1] };
}
