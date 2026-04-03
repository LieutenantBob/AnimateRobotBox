/**
 * PBR material assignment for the Robot-in-a-Box model.
 * Loads materials.json and applies Three.js MeshStandardMaterial
 * to each mesh based on name matching.
 */
import * as THREE from 'three';

/**
 * Apply PBR materials to all meshes in the model.
 * @param {THREE.Group} model - The loaded glTF scene root
 * @param {Object} materialsConfig - The parsed materials.json
 */
export function applyMaterials(model, materialsConfig) {
  const matDefs = materialsConfig.materials;
  if (!matDefs) return;

  // Build lookup: meshName -> materialDef
  const nameToMat = new Map();
  const patternToMat = [];

  for (const [matName, matDef] of Object.entries(matDefs)) {
    // Exact name matches
    if (matDef.applies_to) {
      for (const partName of matDef.applies_to) {
        if (partName !== '_default_') {
          nameToMat.set(partName, { ...matDef, _matName: matName });
        }
      }
    }
    // Pattern matches (glob-like with *)
    if (matDef.applies_to_pattern) {
      for (const pattern of matDef.applies_to_pattern) {
        const prefix = pattern.replace('*', '');
        patternToMat.push({ prefix, matDef: { ...matDef, _matName: matName } });
      }
    }
  }

  // Default/fallback material
  const defaultDef = matDefs.generic_gray || {
    baseColor: [0.698, 0.698, 0.698],
    metallic: 0.3,
    roughness: 0.5,
  };

  // Cache created Three.js materials to reuse instances
  const materialCache = new Map();

  function createMaterial(matDef) {
    const cacheKey = matDef._matName || JSON.stringify(matDef.baseColor);
    if (materialCache.has(cacheKey)) {
      return materialCache.get(cacheKey);
    }

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(
        matDef.baseColor[0],
        matDef.baseColor[1],
        matDef.baseColor[2]
      ),
      metalness: matDef.metallic ?? 0.3,
      roughness: matDef.roughness ?? 0.5,
      side: THREE.DoubleSide,
    });

    // Emissive (for TV screen etc.)
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

  // Find the best material for a mesh name
  function findMaterial(meshName) {
    // Exact match
    if (nameToMat.has(meshName)) {
      return nameToMat.get(meshName);
    }

    // Pattern match (prefix)
    for (const { prefix, matDef } of patternToMat) {
      if (meshName.startsWith(prefix) || meshName.includes(prefix)) {
        return matDef;
      }
    }

    // No match — return default
    return defaultDef;
  }

  // Apply materials to all meshes
  let applied = 0;
  model.traverse((node) => {
    if (!node.isMesh) return;

    const name = node.name || '';
    const matDef = findMaterial(name);
    const material = createMaterial(matDef);
    node.material = material;

    // Ensure normals are computed for proper lighting
    if (node.geometry && !node.geometry.attributes.normal) {
      node.geometry.computeVertexNormals();
    }

    applied++;
  });

  return { applied, materialsCreated: materialCache.size };
}
