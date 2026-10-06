/**
 * Splits a mesh made of several disconnected solids (e.g. a foot = three
 * loose skids) into one mesh per solid, so each piece can move on its own.
 */
import * as THREE from 'three';

/** Groups vertex indices into connected components (shared index or identical position). */
function components(geometry) {
  const pos = geometry.attributes.position;
  const parent = Int32Array.from({ length: pos.count }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    if (seen.has(key)) union(i, seen.get(key)); else seen.set(key, i);
  }
  const index = geometry.index;
  const triCount = index ? index.count : pos.count;
  const at = (k) => (index ? index.getX(k) : k);
  for (let k = 0; k < triCount; k += 3) { union(at(k), at(k + 1)); union(at(k), at(k + 2)); }

  const groups = new Map();
  for (let k = 0; k < triCount; k += 3) {
    const root = find(at(k));
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(at(k), at(k + 1), at(k + 2));
  }
  return [...groups.values()];
}

/** New geometry containing only the given triangle-vertex list (copies every attribute). */
function subGeometry(geometry, triVerts) {
  const remap = new Map();
  for (const v of triVerts) if (!remap.has(v)) remap.set(v, remap.size);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const data = new attr.array.constructor(remap.size * attr.itemSize);
    for (const [src, dst] of remap) {
      for (let c = 0; c < attr.itemSize; c++) data[dst * attr.itemSize + c] = attr.array[src * attr.itemSize + c];
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize, attr.normalized));
  }
  out.setIndex(triVerts.map((v) => remap.get(v)));
  out.computeBoundingBox();
  return out;
}

/**
 * Replaces `mesh` (a direct child of its parent) with one mesh per solid,
 * named `${mesh.name}_skid1..n` ordered along the axis the pieces are spread on.
 * Returns the new names.
 */
export function splitMeshIntoPieces(mesh, suffix = '_skid') {
  const parts = components(mesh.geometry).map((tri) => subGeometry(mesh.geometry, tri));
  if (parts.length < 2) return [mesh.name];

  const centers = parts.map((g) => g.boundingBox.getCenter(new THREE.Vector3()));
  const spread = ['x', 'y', 'z']
    .map((a) => ({ a, d: Math.max(...centers.map((c) => c[a])) - Math.min(...centers.map((c) => c[a])) }))
    .sort((p, q) => q.d - p.d)[0].a;
  const order = parts.map((g, i) => ({ g, c: centers[i][spread] })).sort((p, q) => p.c - q.c);

  const parent = mesh.parent;
  const names = order.map(({ g }, i) => {
    const piece = new THREE.Mesh(g, mesh.material);
    piece.name = `${mesh.name}${suffix}${i + 1}`;
    piece.castShadow = mesh.castShadow;
    piece.receiveShadow = mesh.receiveShadow;
    piece.position.copy(mesh.position);
    piece.quaternion.copy(mesh.quaternion);
    piece.scale.copy(mesh.scale);
    parent.add(piece);
    return piece.name;
  });
  parent.remove(mesh);
  mesh.geometry.dispose();
  return names;
}
