/**
 * Programmatic fold/unfold animation engine.
 * Drives mesh transforms based on fold_sequence.json config.
 * No Blender needed — all animation computed in Three.js.
 */
import * as THREE from 'three';

// Easing function: smooth ease-in-out
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Build the animation system from a loaded glTF scene and fold sequence config.
 *
 * @param {THREE.Group} model - The loaded glTF scene root
 * @param {Object} sequence - The fold_sequence.json data
 * @returns {Object} Animation controller with update(t) method
 */
export function createFoldAnimation(model, sequence) {
  // Index all meshes by name for fast lookup
  const meshMap = new Map();
  model.traverse((node) => {
    if (node.isMesh || node.isGroup) {
      meshMap.set(node.name, node);
    }
  });

  console.log(`Animation: ${meshMap.size} named nodes found`);

  // Store original transforms for each mesh
  const originalTransforms = new Map();
  meshMap.forEach((node, name) => {
    originalTransforms.set(name, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  });

  // Find meshes matching a part name (handles partial matches)
  function findMeshes(partName) {
    const found = [];
    // Exact match first
    if (meshMap.has(partName)) {
      found.push({ name: partName, mesh: meshMap.get(partName) });
      return found;
    }
    // Partial/prefix match
    meshMap.forEach((mesh, name) => {
      if (name.startsWith(partName) || name.includes(partName)) {
        found.push({ name, mesh });
      }
    });
    return found;
  }

  // Compute the bounding box center and edges for a set of meshes
  function computeBounds(meshes) {
    const box = new THREE.Box3();
    for (const { mesh } of meshes) {
      box.expandByObject(mesh);
    }
    return {
      center: box.getCenter(new THREE.Vector3()),
      min: box.min.clone(),
      max: box.max.clone(),
      size: box.getSize(new THREE.Vector3()),
    };
  }

  // Pre-compute pivot points and rotation axes for each animation step
  const steps = sequence.sequence.map((step) => {
    const allMeshes = [];
    for (const partName of step.parts) {
      allMeshes.push(...findMeshes(partName));
    }

    if (allMeshes.length === 0) {
      console.warn(`Animation step "${step.name}": no meshes found for`, step.parts);
    } else {
      console.log(`Animation step "${step.name}": ${allMeshes.length} meshes`);
    }

    // Determine pivot point and rotation axis based on hinge_edge
    let pivot = new THREE.Vector3();
    let axis = new THREE.Vector3(1, 0, 0); // default X-axis
    let angle = 0;
    let translation = null;

    if (allMeshes.length > 0) {
      const bounds = computeBounds(allMeshes);

      if (step.action === 'rotate') {
        angle = THREE.MathUtils.degToRad(step.angle_degrees || 90);

        // OBJ coordinate system: X=width, Y=depth, Z=height
        // Determine pivot based on hinge_edge
        switch (step.hinge_edge) {
          case 'front':
            // Hinge at the front edge (min Y), rotate around X axis
            pivot.set(bounds.center.x, bounds.min.y, bounds.center.z);
            axis.set(1, 0, 0);
            break;
          case 'back':
            // Hinge at the back edge (max Y)
            pivot.set(bounds.center.x, bounds.max.y, bounds.center.z);
            axis.set(-1, 0, 0);
            break;
          case 'bottom':
            // Hinge at the bottom edge (min Z), rotate around appropriate axis
            // For side panels, each has a different hinge direction
            pivot.set(bounds.center.x, bounds.center.y, bounds.min.z);
            axis.set(1, 0, 0);
            break;
          case 'left':
            pivot.set(bounds.min.x, bounds.center.y, bounds.center.z);
            axis.set(0, 1, 0);
            break;
          case 'right':
            pivot.set(bounds.max.x, bounds.center.y, bounds.center.z);
            axis.set(0, -1, 0);
            break;
          case 'top':
            pivot.set(bounds.center.x, bounds.center.y, bounds.max.z);
            axis.set(1, 0, 0);
            angle = -angle;
            break;
          default:
            pivot.copy(bounds.center);
        }
      } else if (step.action === 'translate' || step.action === 'move_to_position' || step.action === 'slide_into_position') {
        // Translation: move parts outward from center
        const bounds = computeBounds(allMeshes);
        const dir = step.direction || 'up';
        const distance = bounds.size.length() * 0.5;

        switch (dir) {
          case 'right': translation = new THREE.Vector3(distance, 0, 0); break;
          case 'left': translation = new THREE.Vector3(-distance, 0, 0); break;
          case 'up': translation = new THREE.Vector3(0, 0, distance); break;
          case 'down': translation = new THREE.Vector3(0, 0, -distance); break;
          case 'forward': translation = new THREE.Vector3(0, -distance, 0); break;
          case 'backward': translation = new THREE.Vector3(0, distance, 0); break;
          case 'flip_upward':
            // For the shelf+TV flip: rotate upward
            pivot.set(bounds.center.x, bounds.min.y, bounds.min.z);
            axis.set(1, 0, 0);
            angle = THREE.MathUtils.degToRad(-90);
            break;
          default: translation = new THREE.Vector3(0, 0, distance);
        }
      } else if (step.action === 'extend_joints') {
        // Robot arm: slight upward translation to simulate extending
        translation = new THREE.Vector3(0, 0, 100);
      } else if (step.action === 'deploy') {
        // Struts: translate outward
        const bounds = computeBounds(allMeshes);
        translation = new THREE.Vector3(0, 0, -bounds.size.z * 0.3);
      }
    }

    return {
      ...step,
      meshes: allMeshes,
      pivot,
      axis: axis.normalize(),
      angle,
      translation,
      startTime: step.start_time,
      duration: step.duration_seconds,
    };
  });

  const totalDuration = sequence.total_duration_seconds || 18;

  /**
   * Update animation to time t (0 = fully folded, totalDuration = fully unfolded).
   */
  function update(t) {
    // Reset all meshes to original transforms first
    originalTransforms.forEach((orig, name) => {
      const mesh = meshMap.get(name);
      if (mesh) {
        mesh.position.copy(orig.position);
        mesh.quaternion.copy(orig.quaternion);
      }
    });

    // Apply each animation step
    for (const step of steps) {
      if (step.meshes.length === 0) continue;

      // Compute progress for this step (0 to 1)
      let progress = 0;
      if (t >= step.startTime + step.duration) {
        progress = 1;
      } else if (t > step.startTime) {
        progress = (t - step.startTime) / step.duration;
        progress = easeInOutCubic(progress);
      }

      if (progress <= 0) continue;

      // Apply rotation around pivot
      if (step.angle !== 0) {
        const currentAngle = step.angle * progress;
        for (const { mesh } of step.meshes) {
          // Rotate around pivot point
          const offset = mesh.position.clone().sub(step.pivot);
          const quat = new THREE.Quaternion().setFromAxisAngle(step.axis, currentAngle);
          offset.applyQuaternion(quat);
          mesh.position.copy(step.pivot).add(offset);

          // Apply rotation to the mesh itself
          const meshQuat = new THREE.Quaternion().setFromAxisAngle(step.axis, currentAngle);
          mesh.quaternion.premultiply(meshQuat);
        }
      }

      // Apply translation
      if (step.translation) {
        const currentTranslation = step.translation.clone().multiplyScalar(progress);
        for (const { mesh } of step.meshes) {
          mesh.position.add(currentTranslation);
        }
      }
    }
  }

  return {
    update,
    totalDuration,
    steps,
    meshMap,
  };
}
