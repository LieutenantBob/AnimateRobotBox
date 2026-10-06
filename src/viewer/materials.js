/**
 * PBR material assignment for the Robot-in-a-Box model.
 * Uses MeshPhysicalMaterial for advanced PBR: clearcoat, sheen, transmission.
 * Generates procedural normal maps for surface detail.
 */
import * as THREE from 'three';

/**
 * Generate a procedural normal map from a canvas pattern.
 * @param {number} size - Texture resolution
 * @param {Function} drawFn - Canvas drawing function
 * @returns {THREE.CanvasTexture}
 */
function makeNormalMap(size, drawFn) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Texture(); // fallback if 2D context unavailable
  drawFn(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Fine brushed-metal normal map */
function brushedMetalNormal(scale = 1) {
  return makeNormalMap(256, (ctx, s) => {
    // Base neutral normal (128, 128, 255)
    ctx.fillStyle = 'rgb(128, 128, 255)';
    ctx.fillRect(0, 0, s, s);
    // Horizontal brush strokes
    for (let y = 0; y < s; y++) {
      const offset = Math.floor(Math.random() * 6) - 3;
      const brightness = 125 + offset;
      ctx.fillStyle = `rgb(${brightness}, 128, 255)`;
      ctx.fillRect(0, y, s, 1);
    }
  });
}

/** Subtle noise normal map for painted/plastic surfaces */
function noiseNormal(intensity = 4) {
  return makeNormalMap(128, (ctx, s) => {
    const imgData = ctx.createImageData(s, s);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const nx = 128 + (Math.random() - 0.5) * intensity * 2;
      const ny = 128 + (Math.random() - 0.5) * intensity * 2;
      d[i] = nx;
      d[i + 1] = ny;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  });
}

/** Wood grain normal map for pallet */
function woodGrainNormal() {
  return makeNormalMap(256, (ctx, s) => {
    ctx.fillStyle = 'rgb(128, 128, 255)';
    ctx.fillRect(0, 0, s, s);
    // Grain lines running along X
    for (let y = 0; y < s; y++) {
      const grain = Math.sin(y * 0.3 + Math.sin(y * 0.07) * 8) * 10;
      const noise = (Math.random() - 0.5) * 4;
      const nx = 128 + grain + noise;
      ctx.fillStyle = `rgb(${Math.floor(nx)}, 128, 255)`;
      ctx.fillRect(0, y, s, 1);
    }
  });
}

/** Rough rubber/grip normal map */
function rubberNormal() {
  return makeNormalMap(64, (ctx, s) => {
    const imgData = ctx.createImageData(s, s);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const nx = 128 + (Math.random() - 0.5) * 20;
      const ny = 128 + (Math.random() - 0.5) * 20;
      d[i] = nx;
      d[i + 1] = ny;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  });
}

/**
 * Apply PBR materials to all meshes in the model.
 */
export function applyMaterials(model, materialsConfig) {
  const matDefs = materialsConfig.materials;
  if (!matDefs) return;

  // Build lookup: meshName -> materialDef
  const nameToMat = new Map();
  const patternToMat = [];

  for (const [matName, matDef] of Object.entries(matDefs)) {
    if (matDef.applies_to) {
      for (const partName of matDef.applies_to) {
        if (partName !== '_default_') {
          nameToMat.set(partName, { ...matDef, _matName: matName });
        }
      }
    }
    if (matDef.applies_to_pattern) {
      for (const pattern of matDef.applies_to_pattern) {
        const prefix = pattern.replace('*', '');
        patternToMat.push({ prefix, matDef: { ...matDef, _matName: matName } });
      }
    }
  }

  const defaultDef = matDefs.generic_gray || {
    baseColor: [0.550, 0.555, 0.570],
    metallic: 0.35,
    roughness: 0.5,
  };

  // Generate shared procedural textures (reused across materials)
  const textures = {
    brushed: brushedMetalNormal(),
    noise: noiseNormal(3),
    noiseFine: noiseNormal(2),
    wood: woodGrainNormal(),
    rubber: rubberNormal(),
  };
  // Set repeat for all
  for (const tex of Object.values(textures)) {
    tex.repeat.set(2, 2);
  }

  const materialCache = new Map();

  function createMaterial(matDef) {
    const cacheKey = matDef._matName || JSON.stringify(matDef.baseColor);
    if (materialCache.has(cacheKey)) {
      return materialCache.get(cacheKey);
    }

    const color = new THREE.Color(
      matDef.baseColor[0],
      matDef.baseColor[1],
      matDef.baseColor[2]
    );
    const name = matDef._matName || '';

    // Use MeshPhysicalMaterial for advanced PBR
    const params = {
      color,
      metalness: matDef.metallic ?? 0.3,
      roughness: matDef.roughness ?? 0.5,
      side: THREE.DoubleSide,
      envMapIntensity: 1.0,
    };

    // Material-specific enhancements
    if (name === 'panel_light') {
      // Painted sheet metal with a glossy clear coat, like car paint: the
      // showroom softboxes read as long clean highlights across the walls.
      params.clearcoat = 1.0;
      params.clearcoatRoughness = 0.05;
      params.normalMap = textures.noiseFine;
      params.normalScale = new THREE.Vector2(0.03, 0.03);
    } else if (name === 'robot_arm_blue') {
      // UR robot — smooth painted plastic with clearcoat
      params.clearcoat = 0.6;
      params.clearcoatRoughness = 0.15;
      params.normalMap = textures.noiseFine;
      params.normalScale = new THREE.Vector2(0.08, 0.08);
    } else if (name === 'robot_arm_joint') {
      // Machined aluminum joints
      params.clearcoat = 0.2;
      params.clearcoatRoughness = 0.3;
      params.normalMap = textures.brushed;
      params.normalScale = new THREE.Vector2(0.25, 0.25);
    } else if (name === 'base_steel' || name === 'stiffener_steel') {
      // Brushed/galvanized steel
      params.normalMap = textures.brushed;
      params.normalScale = new THREE.Vector2(0.3, 0.3);
      params.envMapIntensity = 1.5;
    } else if (name === 'pallet_wood') {
      // Wood grain
      params.normalMap = textures.wood;
      params.normalScale = new THREE.Vector2(0.6, 0.6);
      params.roughness = 0.85;
    } else if (name === 'feet_rubber') {
      // Rubber pads — rough, non-reflective
      params.normalMap = textures.rubber;
      params.normalScale = new THREE.Vector2(0.5, 0.5);
      params.sheen = 0.15;
      params.sheenRoughness = 0.8;
      params.sheenColor = new THREE.Color(0.15, 0.15, 0.15);
    } else if (name === 'screen_emissive') {
      // Glass screen
      params.clearcoat = 1.0;
      params.clearcoatRoughness = 0.05;
      params.envMapIntensity = 0.3;
    } else if (name === 'pc_case') {
      // PC tower — matte black with subtle texture
      params.normalMap = textures.noiseFine;
      params.normalScale = new THREE.Vector2(0.1, 0.1);
    } else if (name === 'dark_metal') {
      // Anodized dark frame
      params.clearcoat = 0.15;
      params.clearcoatRoughness = 0.5;
      params.normalMap = textures.brushed;
      params.normalScale = new THREE.Vector2(0.2, 0.2);
    } else if (name === 'shelf_metal') {
      // Powder-coated shelf
      params.clearcoat = 0.2;
      params.clearcoatRoughness = 0.4;
      params.normalMap = textures.noiseFine;
      params.normalScale = new THREE.Vector2(0.12, 0.12);
    } else if (name === 'side_mechanism' || name === 'tripod_metal') {
      // Chrome/polished struts and tripod
      params.normalMap = textures.brushed;
      params.normalScale = new THREE.Vector2(0.15, 0.15);
      params.envMapIntensity = 1.8;
    } else if (name === 'clamp_dark') {
      // Dark clamps — slight rubber feel
      params.normalMap = textures.noise;
      params.normalScale = new THREE.Vector2(0.2, 0.2);
    } else if (name === 'keyboard_plastic') {
      // Keyboard/mouse — smooth plastic
      params.normalMap = textures.noiseFine;
      params.normalScale = new THREE.Vector2(0.05, 0.05);
      params.clearcoat = 0.1;
      params.clearcoatRoughness = 0.6;
    } else if (name === 'sandwich_plate') {
      // Composite plate — fine texture
      params.normalMap = textures.noise;
      params.normalScale = new THREE.Vector2(0.1, 0.1);
    } else if (name === 'generic_gray') {
      // Default: subtle surface noise
      params.normalMap = textures.noiseFine;
      params.normalScale = new THREE.Vector2(0.1, 0.1);
    }

    const mat = new THREE.MeshPhysicalMaterial(params);

    // Emissive (TV screen glow)
    if (matDef.emissiveFactor) {
      mat.emissive = new THREE.Color(
        matDef.emissiveFactor[0],
        matDef.emissiveFactor[1],
        matDef.emissiveFactor[2]
      );
      mat.emissiveIntensity = 2.0;
    }

    materialCache.set(cacheKey, mat);
    return mat;
  }

  function findMaterial(meshName) {
    if (nameToMat.has(meshName)) {
      return nameToMat.get(meshName);
    }
    for (const { prefix, matDef } of patternToMat) {
      if (meshName.startsWith(prefix) || meshName.includes(prefix)) {
        return matDef;
      }
    }
    return defaultDef;
  }

  let applied = 0;
  model.traverse((node) => {
    if (!node.isMesh) return;
    const name = node.name || '';
    const matDef = findMaterial(name);
    const material = createMaterial(matDef);
    node.material = material;
    if (node.geometry && !node.geometry.attributes.normal) {
      node.geometry.computeVertexNormals();
    }
    applied++;
  });

  return { applied, materialsCreated: materialCache.size };
}
