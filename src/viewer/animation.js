/**
 * Fold/unfold animation engine.
 *
 * GLB coordinates (preserved from OBJ): X=width, Y=depth, Z=height(up).
 * The Y-up correction is applied on the model root in viewer.js; everything
 * here works in the CAD Z-up frame.
 *
 * t=0: fully folded (closed box). t=totalDuration: fully unfolded.
 *
 * Every part is always visible. Parts packed in the box start at a real
 * position inside it and travel along continuous keyframe tracks, so nothing
 * can pop in, vanish or teleport (see fold/tracks.js).
 */
import * as THREE from 'three';
import {
  buildPoseTrack, buildScalarTrack, makePose, samplePoseTrack, sampleScalarTrack,
} from './fold/tracks.js';
import {
  buildRig, applyHingeAngle, applyPose, hingeMatrix, quatFromRotations,
} from './fold/rig.js';
import {
  EQUIPMENT, FEET, FEET_STACK, HINGES, STIFFENERS, STIFFENER_TRAVEL_Z, hingeForPoint,
} from './fold/layout.js';

const v3 = (a) => new THREE.Vector3(...a);

/** Resolves a step action (+ optional fraction window) to absolute times. */
function makeTimer(sequence) {
  const byAction = new Map();
  for (const step of sequence.sequence ?? []) {
    if (byAction.has(step.action)) throw new Error(`Duplicate step action "${step.action}"`);
    const start = Number(step.start_time);
    const duration = Number(step.duration_seconds);
    if (!Number.isFinite(start) || !(duration > 0)) {
      throw new Error(`Step "${step.name}" has invalid timing`);
    }
    byAction.set(step.action, { name: step.name, start, duration });
  }
  return (action, [from, to] = [0, 1]) => {
    const step = byAction.get(action);
    if (!step) throw new Error(`No step with action "${action}" in fold_sequence.json`);
    return { start: step.start + from * step.duration, end: step.start + to * step.duration };
  };
}

/** Waypoints: rise straight up to liftZ, then head for `to + arrive`, then settle. */
function travelVia(from, to, liftZ, arrive) {
  return [
    new THREE.Vector3(from.x, from.y, liftZ),
    to.clone().add(arrive),
  ];
}

function buildHingeTracks(rig, timer) {
  return [...rig.hinges.values()].map((hinge) => ({
    hinge,
    track: buildScalarTrack(
      hinge.spec.initial,
      hinge.spec.moves.map((m) => ({ ...timer(m.step, m.window), to: m.to })),
      `hinge ${hinge.name}`,
    ),
  }));
}

/** Feet: stacked on the closed lid, then carried round onto their wall. */
function buildFootTrack(asm, timer) {
  const spec = asm.spec;
  const level = spec.level;
  const flip = quatFromRotations(FEET_STACK.flip);
  const stackCenter = new THREE.Vector3(
    FEET_STACK.centerXY[0], FEET_STACK.centerXY[1], FEET_STACK.baseZ + level * FEET_STACK.pitch,
  );

  // Track values live in the hinge's frame; the hinge is closed while the
  // feet move, so convert world-space waypoints through its closed matrix.
  // hingeMatrix() is relative to the hinge's parent, so it must be top-level.
  if (asm.parentHinge.spec.parent) {
    throw new Error(`${spec.name}: feet must hang on a top-level hinge, "${asm.parentHinge.name}" is nested`);
  }
  const closed = hingeMatrix(asm.parentHinge, asm.parentHinge.spec.initial);
  const toLocal = closed.clone().invert();
  const closedQuat = new THREE.Quaternion().setFromRotationMatrix(closed);
  const localQuat = (q) => closedQuat.clone().invert().multiply(q);

  const wallCenter = asm.center.clone().applyMatrix4(closed);
  const out = v3(spec.outward);
  const via = [
    stackCenter.clone().add(new THREE.Vector3(0, 0, 220)),
    wallCenter.clone().addScaledVector(out, 650).setZ(1300),
    wallCenter.clone().addScaledVector(out, 300),
  ].map((p) => p.applyMatrix4(toLocal));

  return buildPoseTrack(
    makePose(stackCenter.applyMatrix4(toLocal), localQuat(flip)),
    [{ ...timer('detach_feet', spec.window), to: makePose(asm.center), via, rotWindow: [0.15, 0.6] }],
    spec.name,
  );
}

function buildStiffenerTrack(asm, timer, index, count) {
  const spec = asm.spec;
  const packed = makePose(v3(spec.packed.center), quatFromRotations(spec.packed.rot));
  const staging = makePose(v3(spec.staging));
  const final = makePose(asm.center);
  // Stagger the bars a little so they peel off the rack one after another.
  const lag = (index / count) * 0.2;
  const win = [lag, lag + 0.8];
  return buildPoseTrack(packed, [
    {
      ...timer('lift_stiffeners', win), to: staging,
      via: travelVia(packed.center, staging.center, STIFFENER_TRAVEL_Z, new THREE.Vector3(0, 0, STIFFENER_TRAVEL_Z - staging.center.z)),
      rotWindow: [0.25, 0.75],
    },
    {
      ...timer('insert_stiffeners', win), to: final,
      via: travelVia(staging.center, final.center, STIFFENER_TRAVEL_Z, new THREE.Vector3(0, 0, STIFFENER_TRAVEL_Z - final.center.z)),
    },
  ], spec.name);
}

function buildEquipmentTrack(asm, timer) {
  const spec = asm.spec;
  const packed = makePose(v3(spec.packed.center), quatFromRotations(spec.packed.rot));
  const final = makePose(asm.center);
  return buildPoseTrack(packed, [{
    ...timer(spec.step, spec.window),
    to: final,
    via: travelVia(packed.center, final.center, spec.liftZ, v3(spec.arrive)),
    rotWindow: spec.rotWindow,
  }], spec.name);
}

export function createFoldAnimation(model, sequence) {
  const world = model.getObjectByName('world') ?? model;
  const timer = makeTimer(sequence);

  const stiffenerSpecs = STIFFENERS.map((s) => ({ ...s, members: [s.name], kind: 'stiffener' }));
  const rig = buildRig(world, {
    hinges: HINGES,
    assemblies: [
      ...FEET.map((f) => ({ ...f, kind: 'foot' })),
      ...stiffenerSpecs,
      ...EQUIPMENT.map((e) => ({ ...e, kind: 'equipment' })),
    ],
    hingeForPoint,
  });
  if (rig.missing.length > 0) {
    // A missing part would silently stay put — the pop-in this engine exists to prevent.
    throw new Error(`Fold rig: parts named in layout.js not found in model: ${rig.missing.join(', ')}`);
  }

  const hingeTracks = buildHingeTracks(rig, timer);
  const assemblyTracks = [...rig.assemblies.values()].map((asm) => {
    const { kind } = asm.spec;
    if (kind === 'foot') return { asm, track: buildFootTrack(asm, timer) };
    if (kind === 'stiffener') {
      const index = STIFFENERS.findIndex((s) => s.name === asm.name);
      return { asm, track: buildStiffenerTrack(asm, timer, index, STIFFENERS.length) };
    }
    return { asm, track: buildEquipmentTrack(asm, timer) };
  });

  const steps = (sequence.sequence ?? [])
    .map((s) => ({ name: s.name, action: s.action, startTime: s.start_time, duration: s.duration_seconds }))
    .sort((a, b) => a.startTime - b.startTime);
  const lastEnd = Math.max(...steps.map((s) => s.startTime + s.duration));
  const totalDuration = Math.max(sequence.total_duration_seconds ?? 0, lastEnd);

  const center = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  function update(t) {
    for (const { hinge, track } of hingeTracks) {
      applyHingeAngle(hinge, sampleScalarTrack(track, t));
    }
    for (const { asm, track } of assemblyTracks) {
      samplePoseTrack(track, t, center, quat);
      applyPose(asm, center, quat);
    }
  }

  // Inspection hooks for the browser console and the e2e continuity check.
  window.__animationDebug = {
    meshMap: rig.meshes,
    roles: rig.roles,
    missing: rig.missing,
    update,
    totalDuration,
  };

  return { update, totalDuration, steps, meshMap: rig.meshes };
}
