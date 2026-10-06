/**
 * Keyframe tracks for the fold animation.
 *
 * A track is a starting value plus an ordered list of non-overlapping moves.
 * Each move starts where the previous one ended, so a part can never jump:
 * between moves it simply holds its last pose.
 *
 * Two flavours:
 *   - scalar tracks (hinge angles)
 *   - pose tracks   (rigid assemblies: centre position along a smooth curve
 *                    + orientation slerp)
 */
import * as THREE from 'three';

/**
 * Sine ease: starts and stops at rest like a cubic, but peaks at only ~1.6x
 * the average speed (cubic peaks at 3x), so long paths never look rushed.
 */
export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function smoothstep(a, b, x) {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

/**
 * @typedef {{ center: THREE.Vector3, quaternion: THREE.Quaternion }} Pose
 * @typedef {{ start: number, end: number }} Timing
 */

/** Immutable pose factory. */
export function makePose(center, quaternion = new THREE.Quaternion()) {
  return Object.freeze({ center: center.clone(), quaternion: quaternion.clone() });
}

function validateTiming(moves, label) {
  let prevEnd = -Infinity;
  for (const m of moves) {
    if (!Number.isFinite(m.start) || !Number.isFinite(m.end) || m.end <= m.start) {
      throw new Error(`${label}: invalid move timing [${m.start}, ${m.end}]`);
    }
    if (m.start < prevEnd - 1e-9) {
      throw new Error(`${label}: move starting at ${m.start} overlaps previous move ending at ${prevEnd}`);
    }
    prevEnd = m.end;
  }
}

/** Progress (0..1, eased) of a move at time t. */
function progress(move, t) {
  return easeInOutSine((t - move.start) / (move.end - move.start));
}

/**
 * @param {number} initial
 * @param {Array<Timing & { to: number }>} moves
 */
export function buildScalarTrack(initial, moves, label = 'scalar track') {
  validateTiming(moves, label);
  let from = initial;
  const segments = moves.map((m) => {
    const seg = Object.freeze({ start: m.start, end: m.end, from, to: m.to });
    from = m.to;
    return seg;
  });
  return Object.freeze({ initial, segments });
}

export function sampleScalarTrack(track, t) {
  let value = track.initial;
  for (const seg of track.segments) {
    if (t >= seg.end) { value = seg.to; continue; }
    if (t <= seg.start) return value;
    return seg.from + (seg.to - seg.from) * progress(seg, t);
  }
  return value;
}

/**
 * Drop points closer than 1 mm to their neighbour (centripetal Catmull-Rom
 * divides by segment length). The first and last points always survive so
 * the curve starts and ends exactly on the poses.
 */
function dedupe(points) {
  const last = points[points.length - 1];
  const inner = points.slice(0, -1).filter((p, i, arr) => i === 0 || p.distanceTo(arr[i - 1]) > 1);
  while (inner.length > 1 && inner[inner.length - 1].distanceTo(last) <= 1) inner.pop();
  return inner[0].distanceTo(last) <= 1 && inner.length === 1 ? [inner[0]] : [...inner, last];
}

/**
 * @param {Pose} initial
 * @param {Array<Timing & { to: Pose, via?: THREE.Vector3[], rotWindow?: [number, number] }>} moves
 */
export function buildPoseTrack(initial, moves, label = 'pose track') {
  validateTiming(moves, label);
  let from = initial;
  const segments = moves.map((m) => {
    const points = dedupe([from.center, ...(m.via ?? []), m.to.center]);
    const curve = points.length >= 2
      ? new THREE.CatmullRomCurve3(points, false, 'centripetal')
      : null;
    const seg = Object.freeze({
      start: m.start,
      end: m.end,
      from,
      to: m.to,
      curve,
      rotWindow: m.rotWindow ?? [0, 1],
    });
    from = m.to;
    return seg;
  });
  return Object.freeze({ initial, segments });
}

/**
 * Writes the pose at time t into outCenter/outQuat (no allocation per frame).
 */
export function samplePoseTrack(track, t, outCenter, outQuat) {
  let pose = track.initial;
  for (const seg of track.segments) {
    if (t >= seg.end) { pose = seg.to; continue; }
    if (t <= seg.start) break;
    const u = progress(seg, t);
    if (seg.curve) seg.curve.getPointAt(u, outCenter);
    else outCenter.copy(seg.from.center);
    const r = smoothstep(seg.rotWindow[0], seg.rotWindow[1], u);
    outQuat.slerpQuaternions(seg.from.quaternion, seg.to.quaternion, r);
    return;
  }
  outCenter.copy(pose.center);
  outQuat.copy(pose.quaternion);
}
