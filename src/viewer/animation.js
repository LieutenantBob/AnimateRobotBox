/**
 * Programmatic fold/unfold animation engine.
 *
 * GLB coordinates (preserved from OBJ): X=width, Y=depth, Z=height(up)
 * Three.js Y-up correction is applied at the model root level in viewer.js.
 * All animation math here works in the original OBJ Z-up coordinate system.
 *
 * t=0: fully folded (closed box). t=totalDuration: fully unfolded.
 */
import * as THREE from 'three';

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const _offset = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _translation = new THREE.Vector3();

/**
 * Exact fold transforms computed from folded vs unfolded OBJ coordinates.
 *
 * Each rotates a panel from its flat unfolded position to its vertical
 * folded position (forming box walls). Verified against actual geometry:
 *
 *   Forside2: flat at Y[-1000,0] Z[10,32] → wall at Y~5 Z[32,1032]
 *   Bag2:     flat at Y[1000,2000] Z[10,32] → wall at Y~995 Z[32,1032]
 *   Left2:    flat at X[-1000,0] Z[10,32] → wall at X~5 Z[32,1032]
 *   Right2:   flat at X[1200,2200] Z[10,32] → wall at X~1195 Z[32,1032]
 *   Top2:     flat at Y[-2003,-1003] → lid at Z[1032,1054]
 */
const PANEL_FOLDS = {
  'Forside2': {
    pivot: [600, 0, 32],
    axis: [-1, 0, 0],   // negative X rotation
    angle: Math.PI / 2,
  },
  'Bag2': {
    pivot: [600, 1000, 32],
    axis: [1, 0, 0],    // positive X rotation
    angle: Math.PI / 2,
  },
  'Left2': {
    pivot: [0, 500, 32],
    axis: [0, 1, 0],    // positive Y rotation
    angle: Math.PI / 2,
  },
  'Right2': {
    pivot: [1200, 500, 32],
    axis: [0, -1, 0],   // negative Y rotation
    angle: Math.PI / 2,
  },
  // Top2 handled separately as a translation (not in PANEL_FOLDS)
  // because it needs to move from Y=-1503,Z=21 to Y=500,Z=1043
};

// Box interior: X[5,1195] Y[5,995] Z[32,1032]
const BOX_CENTER = [600, 500, 400];

/**
 * Exact fold translations for equipment that needs to pack inside the box.
 * Computed from unfolded positions → box interior center.
 * Key: step name → per-part translations.
 */
const EQUIPMENT_FOLDS = {
  // Step 3: Side struts deploy outward. Fold = pull them inside.
  'Deploy Side Struts': {
    'Stang_Venstre': [999, 145, -194],    // from X=-399 to inside
    'Stang_Hojre': [-821, 600, -194],     // from X=1421 to inside
    '_default': [0, 0, 0],
  },
  // Step 4: Stiffeners slide into position. Fold = pull inside.
  'Insert Stiffeners': {
    '_default_outside': true, // auto-compute for parts outside box
  },
  // Step 5: Shelf+TV flip (handled by rotation, not translation)
  // Step 6: PC moves right. Fold = move left into box.
  'Move PC to Final Position': {
    'PC2': [-1396, -180, 142],
  },
  // Step 7: Feet deploy. Fold = pack inside box.
  'Deploy Feet': {
    'Fodder_Forside': [0, 1000, 470],
    'Fodder_Top': [0, 2000, 470],
    'Fodder_Bagside': [0, -1000, 470],
    'Fodder_venstre': [500, 0, 470],
    'Fodder_Højre': [-500, 0, 470],
    '_default': [0, 0, 470],
  },
  // Step 8: Keyboard and mouse placed. Fold = pack inside.
  'Place Keyboard and Mouse': {
    'keyboard': [619, -906, -500],
    'Mouse 2': [400, -800, -400],
    '_default': [400, -800, -400],
  },
  // Step 9: Robot arm extends. Fold = retract toward box.
  'Extend Robot Arm': {
    '_default_outside': true,
  },
};

export function createFoldAnimation(model, sequence) {
  const meshMap = new Map();
  model.traverse((node) => {
    if (node.isMesh || node.isGroup) {
      meshMap.set(node.name, node);
    }
  });

  const originalTransforms = new Map();
  meshMap.forEach((node, name) => {
    originalTransforms.set(name, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  });

  function findMeshes(partName) {
    const found = [];
    if (meshMap.has(partName)) {
      found.push({ name: partName, mesh: meshMap.get(partName) });
      return found;
    }
    meshMap.forEach((mesh, name) => {
      if (name.startsWith(partName) || name.includes(partName)) {
        found.push({ name, mesh });
      }
    });
    return found;
  }

  function getGeometryCenter(meshes) {
    const box = new THREE.Box3();
    for (const { mesh } of meshes) {
      if (mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox);
      }
    }
    return box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  }

  // Build steps
  const steps = sequence.sequence.map((step) => {
    const allMeshes = [];
    for (const partName of step.parts) {
      allMeshes.push(...findMeshes(partName));
    }

    if (allMeshes.length === 0) {
      console.warn(`Step "${step.name}": no meshes found for`, step.parts);
    }

    // Per-mesh fold transforms
    const meshFolds = new Map();

    // Panel rotation steps
    if (step.action === 'rotate' && (step.hinge_edge === 'bottom' || step.hinge_edge === 'front')) {
      for (const partName of step.parts) {
        const fold = PANEL_FOLDS[partName];
        const meshes = findMeshes(partName);

        if (fold) {
          // Use exact rotation from PANEL_FOLDS
          for (const m of meshes) {
            meshFolds.set(m.name, {
              pivot: new THREE.Vector3(...fold.pivot),
              axis: new THREE.Vector3(...fold.axis).normalize(),
              angle: fold.angle,
              postTranslate: fold.postTranslate ? new THREE.Vector3(...fold.postTranslate) : null,
            });
          }
        } else if (partName === 'Top2') {
          // Top2 (lid): use pure translation from unfolded to folded position.
          // Unfolded center: [600, -1503, 21]. Folded: [600, 500, 1043].
          // Delta: [0, 2003, 1022]. Also rotate 90° so it lays flat on top.
          for (const m of meshes) {
            meshFolds.set(m.name, {
              pivot: new THREE.Vector3(600, -1503, 21),
              axis: new THREE.Vector3(0, 0, 0), // no rotation axis
              angle: 0,
              postTranslate: new THREE.Vector3(0, 2003, 1022),
            });
          }
        }
      }
    }

    // Shelf+TV flip
    if (step.action === 'rotate' && step.direction === 'flip_upward') {
      for (const m of allMeshes) {
        // TV center at [631, 2472, 1244], Body at [653, 2541, 580], Hylde at [137, 1372, 532]
        // These need to fold flat and pack inside the box.
        // Rotate down (fold flat), then translate into box interior.
        const center = getGeometryCenter([m]);
        meshFolds.set(m.name, {
          pivot: new THREE.Vector3(center.x, center.y, 32),
          axis: new THREE.Vector3(1, 0, 0),
          angle: Math.PI / 4, // partial fold
          // Also translate toward box center
          postTranslate: new THREE.Vector3(
            BOX_CENTER[0] - center.x,
            BOX_CENTER[1] - center.y,
            BOX_CENTER[2] - center.z
          ).multiplyScalar(0.85),
        });
      }
    }

    // Translation-based folds: move equipment toward box center
    // Use precise per-part translations from EQUIPMENT_FOLDS if available
    const perMeshTranslations = new Map();
    const equipFold = EQUIPMENT_FOLDS[step.name];

    if (!meshFolds.size && allMeshes.length > 0 &&
        (step.action !== 'rotate' || !step.hinge_edge)) {
      for (const { mesh, name: meshName } of allMeshes) {
        let trans = null;

        if (equipFold) {
          // Check for exact part name match
          if (equipFold[meshName]) {
            trans = new THREE.Vector3(...equipFold[meshName]);
          } else if (equipFold['_default_outside']) {
            // Auto-compute: move part center to box center
            const center = getGeometryCenter([{ mesh, name: meshName }]);
            const boxCenter = new THREE.Vector3(...BOX_CENTER);
            trans = boxCenter.clone().sub(center).multiplyScalar(0.9);
          } else if (equipFold['_default']) {
            trans = new THREE.Vector3(...equipFold['_default']);
          }
        }

        if (!trans) {
          // Fallback: compute from geometry
          const center = getGeometryCenter([{ mesh, name: meshName }]);
          const boxCenter = new THREE.Vector3(...BOX_CENTER);
          trans = boxCenter.clone().sub(center).multiplyScalar(0.9);
        }

        perMeshTranslations.set(meshName, trans);
      }
    }

    return {
      ...step,
      meshes: allMeshes,
      meshFolds,
      perMeshTranslations,
      startTime: step.start_time,
      duration: Math.max(0.001, step.duration_seconds || 1),
    };
  });

  const totalDuration = sequence.total_duration_seconds || 18;

  function update(t) {
    // Reset to original unfolded positions
    originalTransforms.forEach((orig, name) => {
      const mesh = meshMap.get(name);
      if (mesh) {
        mesh.position.copy(orig.position);
        mesh.quaternion.copy(orig.quaternion);
        mesh.scale.copy(orig.scale);
      }
    });

    // Apply fold transforms
    for (const step of steps) {
      if (step.meshes.length === 0) continue;

      // foldAmount: 1=fully folded (t=0), 0=fully unfolded (t=end)
      let foldAmount = 1;
      if (t >= step.startTime + step.duration) {
        foldAmount = 0;
      } else if (t > step.startTime) {
        foldAmount = 1 - easeInOutCubic((t - step.startTime) / step.duration);
      }
      if (foldAmount <= 0) continue;

      // Per-mesh rotations (panels, shelf/TV)
      if (step.meshFolds.size > 0) {
        for (const { mesh, name } of step.meshes) {
          const fold = step.meshFolds.get(name);
          if (!fold) continue;

          const angle = fold.angle * foldAmount;
          _quat.setFromAxisAngle(fold.axis, angle);

          _offset.copy(mesh.position).sub(fold.pivot);
          _offset.applyQuaternion(_quat);
          mesh.position.copy(fold.pivot).add(_offset);

          const orig = originalTransforms.get(name);
          if (orig) {
            mesh.quaternion.copy(orig.quaternion).premultiply(_quat);
          }

          if (fold.postTranslate) {
            _translation.copy(fold.postTranslate).multiplyScalar(foldAmount);
            mesh.position.add(_translation);
          }
        }
        continue;
      }

      // Per-mesh translations (equipment packing)
      if (step.perMeshTranslations.size > 0) {
        for (const { mesh, name } of step.meshes) {
          const trans = step.perMeshTranslations.get(name);
          if (trans) {
            _translation.copy(trans).multiplyScalar(foldAmount);
            mesh.position.add(_translation);
          }
        }
      }
    }
  }

  return { update, totalDuration, steps, meshMap };
}
