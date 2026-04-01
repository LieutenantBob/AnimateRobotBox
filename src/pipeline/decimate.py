"""Decimate unfolded OBJ mesh per-group for web-friendly vertex counts.

Uses trimesh for loading and simplification.
Falls back to basic vertex reduction if quadric decimation is unavailable.
"""

import json
import sys
import os
import numpy as np
from pathlib import Path


def load_obj_groups(filepath: str) -> dict:
    """Load an OBJ file and return meshes split by group name.

    Parses OBJ groups manually since trimesh merges them.
    """
    import trimesh

    print(f"Loading OBJ with group splitting: {filepath}")

    # Parse the OBJ manually to extract group boundaries
    vertices = []
    groups: dict[str, list[list[int]]] = {}
    current_group = "default"

    with open(filepath, 'r', errors='replace') as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue
            if stripped.startswith('v '):
                parts = stripped.split()
                if len(parts) >= 4:
                    vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])
            elif stripped.startswith('g '):
                current_group = stripped[2:].strip()
                if current_group not in groups:
                    groups[current_group] = []
            elif stripped.startswith('f '):
                if current_group not in groups:
                    groups[current_group] = []
                face_verts = []
                for part in stripped.split()[1:]:
                    vi = int(part.split('/')[0]) - 1  # OBJ is 1-indexed
                    face_verts.append(vi)
                # Triangulate quads and polygons
                for i in range(1, len(face_verts) - 1):
                    groups[current_group].append([face_verts[0], face_verts[i], face_verts[i + 1]])

    all_vertices = np.array(vertices, dtype=np.float64)
    print(f"  Parsed {len(all_vertices)} vertices, {len(groups)} groups")

    # Build per-group meshes with re-indexed vertices
    meshes = {}
    for name, faces in groups.items():
        if not faces:
            continue
        face_array = np.array(faces, dtype=np.int64)
        # Get unique vertex indices used by this group
        unique_verts = np.unique(face_array.flatten())
        # Create vertex remapping
        vert_map = {old: new for new, old in enumerate(unique_verts)}
        new_verts = all_vertices[unique_verts]
        new_faces = np.vectorize(vert_map.get)(face_array)

        try:
            mesh = trimesh.Trimesh(vertices=new_verts, faces=new_faces, process=False)
            if len(mesh.vertices) > 0:
                meshes[name] = mesh
        except Exception as e:
            print(f"    Warning: failed to create mesh for {name}: {e}")

    print(f"  Created {len(meshes)} mesh groups")
    return meshes


def decimate_mesh(mesh, target_faces: int, name: str = ""):
    """Decimate a single mesh to target face count."""
    import trimesh

    if len(mesh.faces) <= target_faces:
        print(f"    {name}: {len(mesh.faces)} faces <= target {target_faces}, keeping as-is")
        return mesh

    # Try fast_simplification directly (more reliable than trimesh wrapper)
    try:
        import fast_simplification
        target_ratio = max(0.001, min(0.999, 1.0 - (target_faces / len(mesh.faces))))
        verts_out, faces_out = fast_simplification.simplify(
            mesh.vertices.astype(np.float32),
            mesh.faces.astype(np.int32),
            target_reduction=target_ratio,
        )
        decimated = trimesh.Trimesh(vertices=verts_out, faces=faces_out, process=False)
        print(f"    {name}: {len(mesh.faces):,} -> {len(decimated.faces):,} faces "
              f"({len(mesh.vertices):,} -> {len(decimated.vertices):,} verts)")
        return decimated
    except Exception as e:
        pass

    # Fallback: trimesh's built-in
    try:
        decimated = mesh.simplify_quadric_decimation(target_faces)
        print(f"    {name}: {len(mesh.faces):,} -> {len(decimated.faces):,} faces (trimesh)")
        return decimated
    except Exception as e:
        print(f"    {name}: decimation failed ({e}), keeping original ({len(mesh.vertices):,} verts)")
        return mesh


def categorize_group(name: str, vertex_count: int) -> str:
    """Categorize a group for decimation target selection."""
    if '1005703' in name or '1005866' in name:
        return 'cable'
    elif vertex_count > 50000:
        return 'hero'
    elif vertex_count > 5000:
        return 'medium'
    elif vertex_count > 100:
        return 'small'
    else:
        return 'tiny'


def compute_target_faces(vertex_count: int, face_count: int, category: str, config: dict) -> int:
    """Compute target face count based on category and config."""
    cat_config = config.get(category, config.get('small', {}))

    if cat_config.get('keep_as_is', False):
        return face_count

    ratio = cat_config.get('target_ratio', 0.1)
    min_v = cat_config.get('min_vertices', 50)
    max_v = cat_config.get('max_vertices', 5000)

    target_v = int(vertex_count * ratio)
    target_v = max(min_v, min(max_v, target_v))

    # Approximate: faces ≈ 2 * vertices for triangle meshes
    target_f = target_v * 2
    return max(12, min(target_f, face_count))


def decimate_obj(input_path: str, output_dir: str, config_path: str = None):
    """Decimate all groups in an OBJ file and save results."""
    import trimesh

    # Load config
    if config_path:
        with open(config_path) as f:
            config = json.load(f)
        dec_config = config.get('decimation_targets', {})
    else:
        dec_config = {
            'hero': {'target_ratio': 0.02, 'min_vertices': 2000, 'max_vertices': 20000},
            'medium': {'target_ratio': 0.1, 'min_vertices': 500, 'max_vertices': 5000},
            'small': {'target_ratio': 0.3, 'min_vertices': 50, 'max_vertices': 2000},
            'cable_merge': {'target_ratio': 0.05, 'min_vertices': 4, 'max_vertices': 200},
            'tiny': {'keep_as_is': True},
        }

    os.makedirs(output_dir, exist_ok=True)

    # Load meshes
    meshes = load_obj_groups(input_path)
    if not meshes:
        print("ERROR: No meshes loaded!")
        return

    results = {
        'input': input_path,
        'output_dir': output_dir,
        'groups': [],
        'totals': {'original_vertices': 0, 'decimated_vertices': 0,
                   'original_faces': 0, 'decimated_faces': 0}
    }

    decimated_meshes = {}

    for name, mesh in sorted(meshes.items()):
        vc = len(mesh.vertices)
        fc = len(mesh.faces)
        category = categorize_group(name, vc)

        # Use cable_merge config for cables
        cfg_key = 'cable_merge' if category == 'cable' else category
        target_f = compute_target_faces(vc, fc, cfg_key, dec_config)

        decimated = decimate_mesh(mesh, target_f, name)
        decimated_meshes[name] = decimated

        results['totals']['original_vertices'] += vc
        results['totals']['decimated_vertices'] += len(decimated.vertices)
        results['totals']['original_faces'] += fc
        results['totals']['decimated_faces'] += len(decimated.faces)

        results['groups'].append({
            'name': name,
            'category': category,
            'original_vertices': vc,
            'decimated_vertices': len(decimated.vertices),
            'original_faces': fc,
            'decimated_faces': len(decimated.faces),
            'reduction_pct': round(100 * (1 - len(decimated.vertices) / max(1, vc)), 1),
        })

    # Save combined decimated mesh
    combined_path = os.path.join(output_dir, "robot_decimated.glb")
    try:
        scene = trimesh.Scene()
        for name, mesh in decimated_meshes.items():
            scene.add_geometry(mesh, node_name=name, geom_name=name)
        scene.export(combined_path)
        print(f"\nSaved combined GLB: {combined_path}")
        file_size_mb = os.path.getsize(combined_path) / (1024 * 1024)
        results['output_file'] = combined_path
        results['output_size_mb'] = round(file_size_mb, 2)
    except Exception as e:
        print(f"\nFailed to save combined GLB: {e}")
        # Save individual OBJ files as fallback
        for name, mesh in decimated_meshes.items():
            safe_name = name.replace(' ', '_').replace('/', '_')
            mesh_path = os.path.join(output_dir, f"{safe_name}.obj")
            try:
                mesh.export(mesh_path)
            except Exception:
                pass

    # Save report
    report_path = os.path.join(output_dir, "decimation_report.json")
    with open(report_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"Saved report: {report_path}")

    # Print summary
    t = results['totals']
    print(f"\n=== DECIMATION SUMMARY ===")
    print(f"  Original:  {t['original_vertices']:>10,} vertices, {t['original_faces']:>10,} faces")
    print(f"  Decimated: {t['decimated_vertices']:>10,} vertices, {t['decimated_faces']:>10,} faces")
    pct = round(100 * (1 - t['decimated_vertices'] / max(1, t['original_vertices'])), 1)
    print(f"  Reduction: {pct}%")

    return results


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python decimate.py <input.obj> <output_dir> [config.json]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    config_path = sys.argv[3] if len(sys.argv) > 3 else None

    decimate_obj(input_path, output_dir, config_path)
