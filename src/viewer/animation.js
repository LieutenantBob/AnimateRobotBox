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
 * All stiffener mesh names including \xd8 (Latin-1 Ø) encoding variants.
 * These need special handling because JSON/UTF-8 Ø doesn't match GLB's \xd8.
 * Position data from GLB analysis:
 *   Langsstiver_NH:           [40, 970, 42]
 *   Langsstiver_NV_2:         [40, -970, 42]
 *   Langsstiver_NV_master002: [1180, -970, 42]
 *   Langsstiver_\xd8H:        [1180, 970, 42]
 *   Langsstiver_\xd8V:        [1180, 0, 42]
 *   Tvarstiver_Vandret_NH:    [1200, 20, 22]
 *   Tvarstiver_Vandret_\xd8H: [1200, 980, 22]
 *   Tvarstiver_Vandret_\xd8V: [0, 980, 22]
 */
const STIFFENER_NAMES = [
  'Langsstiver_NH',
  'Langsstiver_NV_2',
  'Langsstiver_NV_master002',
  'Langsstiver_\u00d8H',      // ØH - Unicode U+00D8
  'Langsstiver_\u00d8V',      // ØV
  'Tvarstiver_Vandret_NH',
  'Tvarstiver_Vandret_\u00d8H',
  'Tvarstiver_Vandret_\u00d8V',
  // Literal escaped byte variants (GLTFLoader preserves raw bytes as string)
  'Langsstiver_\\xd8H',
  'Langsstiver_\\xd8V',
  'Tvarstiver_Vandret_\\xd8H',
  'Tvarstiver_Vandret_\\xd8V',
];

// "Staging area" next to the box where stiffeners wait during panel folding
// Positioned to the side at Y=-300 (in front of box), spread out along X
const STIFFENER_STAGING = {
  'Langsstiver_NH':              [-200, 200, 32],
  'Langsstiver_NV_2':            [-200, 400, 32],
  'Langsstiver_NV_master002':    [-200, 600, 32],
  'Langsstiver_\u00d8H':         [-200, 800, 32],
  'Langsstiver_\u00d8V':         [1400, 200, 32],
  'Tvarstiver_Vandret_NH':       [1400, 400, 32],
  'Tvarstiver_Vandret_\u00d8H':  [1400, 600, 32],
  'Tvarstiver_Vandret_\u00d8V':  [1400, 800, 32],
  // Escaped byte variants
  'Langsstiver_\\xd8H':          [-200, 800, 32],
  'Langsstiver_\\xd8V':          [1400, 200, 32],
  'Tvarstiver_Vandret_\\xd8H':   [1400, 600, 32],
  'Tvarstiver_Vandret_\\xd8V':   [1400, 800, 32],
};

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
  // Step 5: Stiffeners slide into position. Fold = pull inside.
  // (Stiffeners themselves are handled by STIFFENER_NAMES logic,
  //  but pads use this equipment fold)
  'Insert Stiffeners': {
    'Pad063': [-696, 346, 366],     // from [1296,154,34] to box center
    'Pad064': [799, 300, 366],      // from [-199,200,34] to box center
    'Pad065': [1206, 300, 366],     // from [-606,200,34] to box center
    '_default_outside': true,
  },
  // Step 5: Shelf+TV flip (handled by rotation, not translation)
  // Step 6: PC moves right. Fold = move left into box.
  'Move PC to Final Position': {
    'PC2': [-1396, -180, 142],
  },
  // Step 2: Feet attach to panels. Fold = pack inside box from panel positions.
  // Feet in unfolded state at Z=-70 below their panels. Move to box center [600,500,400].
  'Attach Feet to Panels': {
    'Fodder_Forside': [0, 1000, 470],     // from [600,-500,-70] to [600,500,400]
    'Fodder_Top': [0, 2000, 470],         // from [600,-1500,-70] to [600,500,400]
    'Fodder_Bagside': [0, -1000, 470],    // from [600,1500,-70] to [600,500,400]
    'Fodder_venstre': [1100, -5, 470],    // from [-500,505,-70] to [600,500,400]
    '_default': [-1100, -5, 470],          // Fodder_Højre from [1700,505,-70]
    'Pad063': [-696, 346, 366],             // from [1296,154,34] to box center
    'Pad064': [799, 300, 366],              // from [-199,200,34] to box center
    'Pad065': [1206, 300, 366],             // from [-606,200,34] to box center
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
      // Feet-panel mapping from config
      const feetMapping = sequence.feet_panel_mapping || {};

      for (const partName of step.parts) {
        const fold = PANEL_FOLDS[partName];
        const meshes = findMeshes(partName);

        if (fold) {
          const foldData = {
            pivot: new THREE.Vector3(...fold.pivot),
            axis: new THREE.Vector3(...fold.axis).normalize(),
            angle: fold.angle,
            postTranslate: fold.postTranslate ? new THREE.Vector3(...fold.postTranslate) : null,
          };

          // Apply fold to panel meshes
          for (const m of meshes) {
            meshFolds.set(m.name, foldData);
          }

          // Also apply the SAME fold rotation to feet attached to this panel
          for (const [footName, panelName] of Object.entries(feetMapping)) {
            if (panelName === partName || partName.includes(panelName) || panelName.includes(partName)) {
              const footMeshes = findMeshes(footName);
              for (const m of footMeshes) {
                meshFolds.set(m.name, foldData);
                // Also add to allMeshes so the step processes them
                if (!allMeshes.some(am => am.name === m.name)) {
                  allMeshes.push(m);
                }
              }
            }
          }
        } else if (partName === 'Top2') {
          for (const m of meshes) {
            meshFolds.set(m.name, {
              pivot: new THREE.Vector3(600, -1503, 21),
              axis: new THREE.Vector3(0, 0, 0),
              angle: 0,
              postTranslate: new THREE.Vector3(0, 2003, 1022),
            });
          }
          // Fodder_Top rides with the lid
          const topFoot = findMeshes('Fodder_Top');
          for (const m of topFoot) {
            meshFolds.set(m.name, {
              pivot: new THREE.Vector3(600, -1503, 21),
              axis: new THREE.Vector3(0, 0, 0),
              angle: 0,
              postTranslate: new THREE.Vector3(0, 2003, 1022),
            });
            if (!allMeshes.some(am => am.name === m.name)) {
              allMeshes.push(m);
            }
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

    // Stiffener handling: find by hardcoded names (bypasses encoding issues)
    let isStiffenerStep = false;
    if (step.action === 'slide_into_position') {
      isStiffenerStep = true;
      // Find stiffener meshes by exact names from STIFFENER_NAMES
      for (const sName of STIFFENER_NAMES) {
        if (meshMap.has(sName)) {
          const mesh = meshMap.get(sName);
          if (!allMeshes.some(m => m.name === sName)) {
            allMeshes.push({ name: sName, mesh });
          }
          // Three-phase fold: final→staging→box
          // Compute translations:
          // 1. From final position to staging area (stiffener next to box)
          const center = getGeometryCenter([{ name: sName, mesh }]);
          const staging = STIFFENER_STAGING[sName];
          if (staging) {
            const toStaging = new THREE.Vector3(
              staging[0] - center.x,
              staging[1] - center.y,
              staging[2] - center.z,
            );
            // 2. From staging to box interior
            const toBox = new THREE.Vector3(
              BOX_CENTER[0] - staging[0],
              BOX_CENTER[1] - staging[1],
              BOX_CENTER[2] - staging[2],
            );
            meshFolds.set(sName, {
              pivot: new THREE.Vector3(),
              axis: new THREE.Vector3(),
              angle: 0,
              postTranslate: null,
              // Custom stiffener data
              toStaging,
              toBox,
            });
          }
        }
      }
    }

    // Translation-based folds: move equipment toward box center
    // Use precise per-part translations from EQUIPMENT_FOLDS if available
    const perMeshTranslations = new Map();
    const equipFold = EQUIPMENT_FOLDS[step.name];

    if (allMeshes.length > 0 &&
        (step.action !== 'rotate' || !step.hinge_edge)) {
      for (const { mesh, name: meshName } of allMeshes) {
        // Skip parts already handled by meshFolds (stiffeners, panels, etc.)
        if (meshFolds.has(meshName)) continue;

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

    // Hide orphan parts when folded (scale to 0 at t=0, restore at t>halfway)
    const overallProgress = t / totalDuration; // 0=folded, 1=unfolded
    for (const hideName of HIDE_WHEN_FOLDED) {
      const mesh = meshMap.get(hideName);
      if (mesh) {
        const showAmount = Math.min(1, overallProgress * 3); // ramp up in first third
        mesh.scale.setScalar(showAmount);
      }
    }

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

      // Per-mesh rotations/translations (panels, shelf/TV, stiffeners)
      if (step.meshFolds.size > 0) {
        for (const { mesh, name } of step.meshes) {
          const fold = step.meshFolds.get(name);
          if (!fold) continue;

          // Stiffener 3-phase animation
          if (fold.toStaging && fold.toBox) {
            // Mesh starts at ORIGINAL (final/unfolded) position after reset.
            // foldAmount=1: fully inside box = apply toStaging + toBox
            // foldAmount=0.5: at staging area = apply toStaging only
            // foldAmount=0: at final position = no translation
            if (foldAmount > 0.5) {
              // Phase 1: final→staging→box. Apply full toStaging + partial toBox.
              const boxPhase = (foldAmount - 0.5) * 2; // 0→1 as foldAmount 0.5→1
              _translation.copy(fold.toStaging);
              mesh.position.add(_translation);
              _translation.copy(fold.toBox).multiplyScalar(boxPhase);
              mesh.position.add(_translation);
            } else {
              // Phase 2: final→staging. Apply partial toStaging.
              const stagingPhase = foldAmount * 2; // 0→1 as foldAmount 0→0.5
              _translation.copy(fold.toStaging).multiplyScalar(stagingPhase);
              mesh.position.add(_translation);
            }
            continue;
          }

          // Standard rotation
          if (fold.angle !== 0) {
            const angle = fold.angle * foldAmount;
            _quat.setFromAxisAngle(fold.axis, angle);

            _offset.copy(mesh.position).sub(fold.pivot);
            _offset.applyQuaternion(_quat);
            mesh.position.copy(fold.pivot).add(_offset);

            const orig = originalTransforms.get(name);
            if (orig) {
              mesh.quaternion.copy(orig.quaternion).premultiply(_quat);
            }
          }

          if (fold.postTranslate) {
            _translation.copy(fold.postTranslate).multiplyScalar(foldAmount);
            mesh.position.add(_translation);
          }
        }
      }

      // Per-mesh translations (equipment packing — for parts not handled by meshFolds)
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

  // Hide small orphan parts that aren't covered by animation steps
  // These are tiny spacer pads that float visibly outside the box
  // Parts outside the box that aren't in any animation step — hide when folded
  const HIDE_WHEN_FOLDED = [
    'Pad063', 'Pad064', 'Pad065', '1005867',
    'Handle_Left', 'Handle_Right',
    '1', // unnamed mesh at [-152,1307,906]
  ];

  // Expose mesh names for debugging (accessible via browser console)
  window.__animationDebug = {
    meshNames: [...meshMap.keys()],
    stiffenerMatches: STIFFENER_NAMES.filter(n => meshMap.has(n)),
    stiffenerMisses: STIFFENER_NAMES.filter(n => !meshMap.has(n)),
    stiffenerLike: [...meshMap.keys()].filter(n => n.includes('stiver') || n.includes('Langs') || n.includes('Tvars')),
  };

  return { update, totalDuration, steps, meshMap };
}
