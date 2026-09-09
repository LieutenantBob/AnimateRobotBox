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

/**
 * Detach-from-lid data: applied AFTER panel fold in array order.
 * At foldAmount=1, translates feet from wall position to lid-top (neatly lined up)
 * and slerps orientation to match Fodder_Top (flat on lid).
 *
 * GLB mesh positions are all [0,0,0]; geometry is offset.
 * Wall positions after panel fold (foldAmount=1):
 *   Forside: [0, -32, 32]      Bagside: [0, 1032, -968]
 *   venstre: [-32, 0, 32]      H: [1232, 0, -1168]
 *
 * Lid target: evenly spaced near Fodder_Top [0,-1000,1064], row along X.
 */
/**
 * Foot detach paths: each foot travels lid → clearance → wall via 3-phase arc
 * to avoid clipping through the box.
 *
 * lidOffset:       offset from wall position to lid-top position (foldAmount=1)
 * clearanceOffset: intermediate waypoint above & outside the box wall edge
 *                  Z must be > 1000 (box wall height) to clear the top edge
 *
 * Phases (as foldAmount goes 1→0, i.e. lid→wall):
 *   Phase 1 (1→0.67):  lid → clearance  (rise up & outward)
 *   Phase 2 (0.67→0.33): clearance → near wall (sweep down along outside)
 *   Phase 3 (0.33→0):  settle onto wall face
 */
const LID_DETACH_DATA = {
  'Fodder_Forside': {
    lidOffset:       [0, 32, 1032],
    clearanceOffset: [0, -100, 1150],      // above & in front of front wall
  },
  'Fodder_Bagside': {
    lidOffset:       [0, 968, 2032],
    clearanceOffset: [0, 1100, 1150],      // above & behind back wall
  },
  'Fodder_venstre': {
    lidOffset:       [1132, 1005, 1032],
    clearanceOffset: [-100, 500, 1150],    // above & left of left wall
  },
  'Fodder_H\u00f8jre': {
    lidOffset:       [-2332, 1005, 2232],
    clearanceOffset: [1300, 500, 1150],    // above & right of right wall
  },
  'Fodder_H\\xf8jre': {
    lidOffset:       [-2332, 1005, 2232],
    clearanceOffset: [1300, 500, 1150],
  },
};

// Quaternion matching Fodder_Top at t=0 (180° around X = lid closed, lying flat)
const LID_QUAT = new THREE.Quaternion(-1, 0, 0, 0);

// "Staging area" next to the box where stiffeners wait during panel folding
// Positioned to the side at Y=-300 (in front of box), spread out along X
const STIFFENER_STAGING = {
  'Langsstiver_NH':              [-400, 100, 32],
  'Langsstiver_NV_2':            [-400, 400, 32],
  'Langsstiver_NV_master002':    [-400, 700, 32],
  'Langsstiver_\u00d8H':         [-400, 1000, 32],
  'Langsstiver_\u00d8V':         [1600, 100, 32],
  'Tvarstiver_Vandret_NH':       [1600, 400, 32],
  'Tvarstiver_Vandret_\u00d8H':  [1600, 700, 32],
  'Tvarstiver_Vandret_\u00d8V':  [1600, 1000, 32],
  // Escaped byte variants
  'Langsstiver_\\xd8H':          [-400, 1000, 32],
  'Langsstiver_\\xd8V':          [1600, 100, 32],
  'Tvarstiver_Vandret_\\xd8H':   [1600, 700, 32],
  'Tvarstiver_Vandret_\\xd8V':   [1600, 1000, 32],
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
  // Step 8: Keyboard and mouse placed. Fold = pack inside.
  'Place Keyboard and Mouse': {
    'keyboard': [619, -906, -500],
    'Mouse 2': [400, -800, -400],
    '_default': [400, -800, -400],
  },
  // Step 9: Robot arm — keep in final position, don't retract into box
  // Joint animation is handled separately
  'Extend Robot Arm': {
    '_skip_fold': true,
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
  const steps = (sequence.sequence || []).map((step) => {
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

          // Also apply same fold to feet mapped to this panel
          for (const [footName, panelName] of Object.entries(feetMapping)) {
            if (panelName === partName) {
              const footMeshes = findMeshes(footName);
              for (const fm of footMeshes) {
                if (!allMeshes.some(m => m.name === fm.name)) {
                  allMeshes.push(fm);
                }
                meshFolds.set(fm.name, foldData);
              }
            }
          }
        } else if (partName === 'Top2') {
          // Lid hinges at top edge of Forside2 wall.
          // Two-phase fold (like robot arm dual-axis):
          //   Phase 1: 90° around front bottom edge [600,0,32] — swings lid vertical
          //   Phase 2: 90° around front top edge [600,0,1032] — closes lid flat on top
          const lidFold = {
            pivot: new THREE.Vector3(600, 0, 32),
            axis: new THREE.Vector3(-1, 0, 0),
            angle: Math.PI / 2,                        // 90° — swing up to vertical
            secondaryPivot: new THREE.Vector3(600, 0, 1032),
            secondaryAxis: new THREE.Vector3(-1, 0, 0),
            secondaryAngle: Math.PI / 2,               // 90° — close flat on top
            isRobot: true,                             // reuse dual-axis rotation logic
          };
          for (const m of meshes) {
            meshFolds.set(m.name, lidFold);
          }
          // Fodder_Top rides on the lid — same fold
          const topFootMeshes = findMeshes('Fodder_Top');
          for (const fm of topFootMeshes) {
            if (!allMeshes.some(m => m.name === fm.name)) {
              allMeshes.push(fm);
            }
            meshFolds.set(fm.name, lidFold);
          }
        }
      }
    }

    // Shelf+TV flip
    if (step.action === 'rotate' && step.direction === 'flip_upward') {
      // Shelf+TV fold: pivot at the bottom-back edge of the box,
      // swing parts down and inward to pack flat inside.
      // Use a shared pivot so all shelf parts move together.
      const shelfPivot = new THREE.Vector3(600, 1000, 32);
      for (const m of allMeshes) {
        const center = getGeometryCenter([m]);
        meshFolds.set(m.name, {
          pivot: shelfPivot,
          axis: new THREE.Vector3(-1, 0, 0),  // fold backward and down
          angle: Math.PI * 0.6, // ~108° to clear the panels
          postTranslate: new THREE.Vector3(
            BOX_CENTER[0] - center.x,
            BOX_CENTER[1] - center.y,
            BOX_CENTER[2] - center.z
          ).multiplyScalar(0.7),
        });
      }
    }

    // Lift from box: 3-phase arc — inside box → up over wall → down to floor
    if (step.action === 'lift_from_box') {
      for (const { mesh, name: meshName } of allMeshes) {
        const center = getGeometryCenter([{ mesh, name: meshName }]);
        let floorPos = STIFFENER_STAGING[meshName];
        if (!floorPos) {
          floorPos = [center.x < 600 ? -300 : 1500, center.y, 32];
        }

        meshFolds.set(meshName, {
          pivot: new THREE.Vector3(),
          axis: new THREE.Vector3(),
          angle: 0,
          isLift: true,
          floorPos: new THREE.Vector3(...floorPos),
          boxPos: new THREE.Vector3(...BOX_CENTER),
          liftHeight: 1200,
          geomCenter: center.clone(),
        });
      }
    }

    // Feet detach from lid: slide wall→lid + slerp orientation to flat.
    // Must be processed AFTER the panel fold step in array order.
    if (step.action === 'detach_from_lid') {
      for (const { name: meshName } of allMeshes) {
        const data = LID_DETACH_DATA[meshName];
        if (data) {
          meshFolds.set(meshName, {
            pivot: new THREE.Vector3(),
            axis: new THREE.Vector3(),
            angle: 0,
            isDetachFromLid: true,
            lidOffset: new THREE.Vector3(...data.lidOffset),
            clearanceOffset: new THREE.Vector3(...data.clearanceOffset),
            lidQuat: LID_QUAT,
          });
        }
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

    // Robot arm joint animation: rotate entire assembly from parked to working
    let isRobotStep = false;
    if (step.action === 'robot_joints') {
      isRobotStep = true;
      // Robot base mount point (where arm attaches to base plate)
      // In OBJ Z-up coords, approximately center of the robot base
      const robotBase = new THREE.Vector3(600, 490, 370);
      // Rotation: from parked (upright, ~30° tilt) to working (current GLB position)
      // We apply a "park" rotation that tilts the arm upright when foldAmount=1
      const parkAxis = new THREE.Vector3(0, 1, 0).normalize(); // rotate around Y in OBJ space
      const parkAngle = Math.PI * 0.15; // ~27° swing
      // Also tilt the arm segments upward when parked
      const tiltAxis = new THREE.Vector3(1, 0, 0).normalize();
      const tiltAngle = Math.PI * 0.2; // ~36° upward tilt

      for (const m of allMeshes) {
        meshFolds.set(m.name, {
          pivot: robotBase,
          axis: parkAxis,
          angle: parkAngle,
          // Also add a tilt component
          secondaryPivot: robotBase,
          secondaryAxis: tiltAxis,
          secondaryAngle: tiltAngle,
          isRobot: true,
        });
      }
    }

    // Translation-based folds: move equipment toward box center
    // Use precise per-part translations from EQUIPMENT_FOLDS if available
    const perMeshTranslations = new Map();
    const equipFold = EQUIPMENT_FOLDS[step.name];

    if (allMeshes.length > 0 &&
        (step.action !== 'rotate' || !step.hinge_edge) &&
        !(equipFold && equipFold['_skip_fold'])) {
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
      startTime: step.start_time ?? 0,
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

      // Per-mesh rotations/translations (panels, shelf/TV, stiffeners)
      if (step.meshFolds.size > 0) {
        for (const { mesh, name } of step.meshes) {
          const fold = step.meshFolds.get(name);
          if (!fold) continue;

          // Feet detach from lid: 3-phase arc to avoid clipping through box.
          // foldAmount goes 1→0 as foot moves from lid to wall.
          // Phase 1 (1→0.67): lid → clearance (rise up & outward)
          // Phase 2 (0.67→0.33): clearance → near wall (sweep outside wall)
          // Phase 3 (0.33→0): settle onto wall face
          if (fold.isDetachFromLid) {
            const lid = fold.lidOffset;
            const clr = fold.clearanceOffset;

            if (foldAmount > 0.67) {
              // Phase 1: interpolate lid → clearance
              const p = (1 - foldAmount) / 0.33; // 0→1
              _translation.set(
                lid.x + (clr.x - lid.x) * p,
                lid.y + (clr.y - lid.y) * p,
                lid.z + (clr.z - lid.z) * p,
              );
            } else if (foldAmount > 0.33) {
              // Phase 2: interpolate clearance → zero (wall position)
              const p = (0.67 - foldAmount) / 0.34; // 0→1
              _translation.set(
                clr.x * (1 - p),
                clr.y * (1 - p),
                clr.z * (1 - p),
              );
            } else {
              // Phase 3: ease remaining offset to zero
              const p = foldAmount / 0.33; // 1→0
              _translation.set(0, 0, 0);
              // Already at wall position, no offset needed
            }

            mesh.position.add(_translation);
            if (foldAmount > 0) {
              mesh.quaternion.slerp(fold.lidQuat, foldAmount);
            }
            continue;
          }

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

          // Lift from box: 3-phase arc animation
          if (fold.isLift) {
            if (fold.isAdditiveLift) {
              // Additive lift for feet — offset on top of attach-step position
              // foldAmount=1 → at box center, foldAmount=0 → at floor (zero offset)
              const bOff = fold.boxOffset;
              const czOff = fold.clearanceZOff;

              if (foldAmount > 0.66) {
                // Phase 1: in box, rising to clearance height
                const phase = (1 - foldAmount) / 0.34;
                mesh.position.x += bOff.x;
                mesh.position.y += bOff.y;
                mesh.position.z += bOff.z + (czOff - bOff.z) * phase;
              } else if (foldAmount > 0.33) {
                // Phase 2: at clearance, moving horizontally to above floor
                const phase = (0.66 - foldAmount) / 0.33;
                mesh.position.x += bOff.x * (1 - phase);
                mesh.position.y += bOff.y * (1 - phase);
                mesh.position.z += czOff;
              } else {
                // Phase 3: descending to floor
                const phase = (0.33 - foldAmount) / 0.33;
                mesh.position.z += czOff * (1 - phase);
              }
            } else {
              // Original absolute lift for stiffeners etc.
              const boxPos = fold.boxPos;
              const floorPos = fold.floorPos;
              const liftH = fold.liftHeight;
              const geomCenter = fold.geomCenter;

              if (foldAmount > 0.66) {
                const phase = (1 - foldAmount) / 0.34;
                const inBoxOffset = boxPos.clone().sub(geomCenter);
                _translation.copy(inBoxOffset);
                mesh.position.add(_translation);
                mesh.position.z += liftH * phase;
              } else if (foldAmount > 0.33) {
                const phase = (0.66 - foldAmount) / 0.33;
                const aboveBox = new THREE.Vector3(boxPos.x, boxPos.y, boxPos.z + liftH);
                const aboveFloor = new THREE.Vector3(floorPos.x, floorPos.y, floorPos.z + liftH);
                const target = aboveBox.clone().lerp(aboveFloor, phase);
                _translation.copy(target).sub(geomCenter);
                mesh.position.add(_translation);
              } else {
                const phase = (0.33 - foldAmount) / 0.33;
                const aboveFloor = new THREE.Vector3(floorPos.x, floorPos.y, floorPos.z + liftH);
                const onFloor = new THREE.Vector3(floorPos.x, floorPos.y, floorPos.z);
                const target = aboveFloor.clone().lerp(onFloor, phase);
                _translation.copy(target).sub(geomCenter);
                mesh.position.add(_translation);
              }
            }
            continue;
          }

          // Robot arm: dual-axis rotation from working→parked
          if (fold.isRobot) {
            // Apply swing rotation
            const swingAngle = fold.angle * foldAmount;
            _quat.setFromAxisAngle(fold.axis, swingAngle);
            _offset.copy(mesh.position).sub(fold.pivot);
            _offset.applyQuaternion(_quat);
            mesh.position.copy(fold.pivot).add(_offset);
            const orig = originalTransforms.get(name);
            if (orig) {
              mesh.quaternion.copy(orig.quaternion).premultiply(_quat);
            }
            // Apply tilt rotation on top
            if (fold.secondaryAngle !== 0) {
              const tiltAngle = fold.secondaryAngle * foldAmount;
              _quat.setFromAxisAngle(fold.secondaryAxis, tiltAngle);
              _offset.copy(mesh.position).sub(fold.secondaryPivot);
              _offset.applyQuaternion(_quat);
              mesh.position.copy(fold.secondaryPivot).add(_offset);
              mesh.quaternion.premultiply(_quat);
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

    // Hide loose parts until their animation step starts.
    // This runs AFTER fold transforms so it cleanly overrides.
    for (const { name: meshName, mesh } of packIntoBox) {
      let stepStarted = false;
      for (const step of steps) {
        if (step.meshes.some(m => m.name === meshName) && t >= step.startTime) {
          stepStarted = true;
          break;
        }
      }
      mesh.visible = stepStarted || t >= totalDuration;
    }
  }

  // Parts animated by steps — these are moved by the fold engine
  const animatedParts = new Set();
  for (const step of steps) {
    for (const { name } of step.meshes) {
      animatedParts.add(name);
    }
  }

  // Base parts that sit on the floor and never need folding
  const alwaysVisible = new Set([
    'Palle', 'Jernplade', 'Sandwich_plade',
    // Robot arm — always visible in final position
    'C-2003903', 'C-2003904', 'C-2003907', 'C-2003908',
    'C-2007307', 'C-2007308', 'C-2007309', 'C-2007310',
    'C-2007311', 'C-2007312', 'C-2007588',
    '704-250-01_filled', '704-251-01_filled', '1005866',
  ]);

  // Parts that should be packed into the box center when folded.
  // Patterns match by exact name or prefix.
  const PACK_PATTERNS = [
    'Handle_Left', 'Handle_Right',
    'Langsstiver', 'Tvarstiver',  // stiffeners (prefix, all variants)
    'SOLID',                       // tripod solids (prefix)
    'Tripod',                      // tripod parts (prefix)
    'Controller_OEM', 'Kontakt',
    '1005703_A',                   // cable conduits (prefix)
    '1005867',
    'Pad0',                        // pads (prefix)
    'Stang_', 'Stang_bund',       // side struts (prefix)
    'Plade_T',                     // strut plates (prefix)
    'Hylde', 'TV', 'Body',        // shelf + TV
    'PC2',                         // PC
    'keyboard', 'Mouse ',
    '1',                           // unnamed mesh
  ];

  // Never pack these — they are the box structure or base
  const NEVER_PACK = new Set([
    'Forside2', 'Bag2', 'Left2', 'Right2', 'Top2',
    'Palle', 'Jernplade', 'Sandwich_plade',
    ...alwaysVisible,
  ]);

  // Build list of meshes to pack and pre-compute their geometry centers
  const packIntoBox = [];
  const packCenters = new Map();
  meshMap.forEach((mesh, name) => {
    if (NEVER_PACK.has(name)) return;

    const shouldPack = PACK_PATTERNS.some(p => name === p || name.startsWith(p));
    if (shouldPack) {
      packIntoBox.push({ name, mesh });
      if (mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        if (bb) {
          packCenters.set(name, bb.getCenter(new THREE.Vector3()));
        }
      }
      if (!packCenters.has(name)) {
        packCenters.set(name, new THREE.Vector3(600, 500, 200));
      }
    }
  });

  const HIDE_WHEN_FOLDED = [];

  // Expose mesh names for debugging (accessible via browser console)
  window.__animationDebug = {
    meshNames: [...meshMap.keys()],
    meshMap,
    animatedParts,
    alwaysVisible,
    stiffenerMatches: STIFFENER_NAMES.filter(n => meshMap.has(n)),
    stiffenerMisses: STIFFENER_NAMES.filter(n => !meshMap.has(n)),
    stiffenerLike: [...meshMap.keys()].filter(n => n.includes('stiver') || n.includes('Langs') || n.includes('Tvars')),
  };

  return { update, totalDuration, steps, meshMap };
}
