/**
 * Builds the fold rig on top of the flat GLB scene graph:
 *   - one pivot group per hinge (panels, lid, robot base), nested where a
 *     hinge rides on another (lid on front wall)
 *   - one group per moving assembly (feet, stiffeners, equipment)
 *   - every remaining mounted part is attached to the hinge it sits on,
 *     everything over the base footprint stays static
 *
 * All meshes keep their baked geometry; only group transforms animate.
 */
import * as THREE from 'three';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Quaternion from a sequence of [axis, degrees] rotations applied in order. */
export function quatFromRotations(rotations) {
  const q = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  for (const [axis, deg] of rotations) {
    if (!axes[axis]) throw new Error(`Unknown rotation axis "${axis}"`);
    step.setFromAxisAngle(axes[axis], THREE.MathUtils.degToRad(deg));
    q.premultiply(step);
  }
  return q;
}

/** Matrix of a hinge group at the given angle (in its parent's frame). */
export function hingeMatrix(hinge, angleDeg, out = new THREE.Matrix4()) {
  _q.setFromAxisAngle(hinge.axis, THREE.MathUtils.degToRad(angleDeg));
  _v.copy(hinge.pivot).applyQuaternion(_q);
  return out.compose(hinge.pivot.clone().sub(_v), _q, new THREE.Vector3(1, 1, 1));
}

export function applyHingeAngle(hinge, angleDeg) {
  _q.setFromAxisAngle(hinge.axis, THREE.MathUtils.degToRad(angleDeg));
  hinge.group.quaternion.copy(_q);
  hinge.group.position.copy(hinge.pivot).sub(_v.copy(hinge.pivot).applyQuaternion(_q));
}

/** Places an assembly so its reference centre sits at `center` with rotation `quat`. */
export function applyPose(assembly, center, quat) {
  assembly.group.quaternion.copy(quat);
  assembly.group.position.copy(center).sub(_v.copy(assembly.center).applyQuaternion(quat));
}

/** Bounding-box centre of `object` expressed in `frame`'s local (CAD) coordinates. */
function centerIn(frame, object) {
  frame.updateWorldMatrix(true, true);
  const toFrame = frame.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  object.traverse((node) => {
    if (!node.isMesh) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    m.multiplyMatrices(toFrame, node.matrixWorld);
    box.union(node.geometry.boundingBox.clone().applyMatrix4(m));
  });
  return box.getCenter(new THREE.Vector3());
}

/**
 * @param {THREE.Object3D} world  node whose direct children are the GLB meshes
 * @param {{ hinges: object[], assemblies: object[], hingeForPoint: Function }} spec
 */
export function buildRig(world, spec) {
  world.updateMatrixWorld(true);
  const meshes = new Map();
  for (const child of world.children) {
    if (child.isMesh) meshes.set(child.name, child);
  }

  const roles = new Map();
  const missing = [];
  const claim = (name, role, group) => {
    const mesh = meshes.get(name);
    if (!mesh) { missing.push(name); return; }
    if (roles.has(name)) throw new Error(`Part "${name}" is claimed by both ${roles.get(name)} and ${role}`);
    group.attach(mesh);
    roles.set(name, role);
  };

  const hinges = new Map();
  for (const h of spec.hinges) {
    const parent = h.parent ? hinges.get(h.parent)?.group : world;
    if (!parent) throw new Error(`Hinge "${h.name}" references unknown parent "${h.parent}"`);
    const group = new THREE.Group();
    group.name = `__hinge_${h.name}`;
    parent.add(group);
    const hinge = {
      name: h.name,
      group,
      pivot: new THREE.Vector3(...h.pivot),
      axis: new THREE.Vector3(...h.axis).normalize(),
      spec: h,
    };
    hinges.set(h.name, hinge);
    for (const m of h.members) claim(m, `hinge:${h.name}`, group);
  }

  const assemblies = new Map();
  for (const a of spec.assemblies) {
    const parentHinge = a.hinge ? hinges.get(a.hinge) : null;
    if (a.hinge && !parentHinge) throw new Error(`Assembly "${a.name}" references unknown hinge "${a.hinge}"`);
    const group = new THREE.Group();
    group.name = `__asm_${a.name}`;
    (parentHinge?.group ?? world).add(group);
    for (const m of a.members) claim(m, `assembly:${a.name}`, group);
    if (group.children.length === 0) {
      group.removeFromParent();
      continue;
    }
    // Centre in the parent's frame: hinges are at angle 0 here, so that is the CAD frame.
    assemblies.set(a.name, { name: a.name, group, center: centerIn(group.parent, group), parentHinge, spec: a });
  }

  // Everything else: ride with the panel it is mounted on, or stay put.
  for (const [name, mesh] of meshes) {
    if (roles.has(name)) continue;
    const c = centerIn(world, mesh);
    const hingeName = spec.hingeForPoint(c.x, c.y);
    if (hingeName) {
      claim(name, `mounted:${hingeName}`, hinges.get(hingeName).group);
    } else {
      roles.set(name, 'static');
    }
  }

  return { hinges, assemblies, roles, missing, meshes };
}
