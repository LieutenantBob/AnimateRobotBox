"""Decimate unfolded OBJ mesh per-group for web-friendly vertex counts.

Uses fast_simplification for quadric decimation with trimesh fallback.
"""

import json
import logging
import os
import sys

import numpy as np

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
log = logging.getLogger(__name__)

# Cable part number prefixes — extracted as constants for maintainability
CABLE_PART_PREFIXES = ('1005703', '1005866')


def _parse_vertex_index(raw_str: str, vertex_count: int) -> int:
    """Parse an OBJ vertex index, handling negative (relative) indices."""
    raw = int(raw_str.split('/')[0])
    return raw - 1 if raw > 0 else vertex_count + raw


def load_obj_groups(filepath: str) -> dict:
    """Load an OBJ file and return meshes split by group name.

    Parses OBJ groups manually since trimesh merges them.
    """
    import trimesh

    log.info("Loading OBJ with group splitting: %s", filepath)

    vertices: list[list[float]] = []
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
                    vi = _parse_vertex_index(part, len(vertices))
                    face_verts.append(vi)
                # Triangulate quads and polygons
                for i in range(1, len(face_verts) - 1):
                    groups[current_group].append([face_verts[0], face_verts[i], face_verts[i + 1]])

    all_vertices = np.array(vertices, dtype=np.float64)
    log.info("  Parsed %s vertices, %d groups", f"{len(all_vertices):,}", len(groups))

    # Build per-group meshes with re-indexed vertices
    meshes: dict[str, trimesh.Trimesh] = {}
    for name, faces in groups.items():
        if not faces:
            continue
        face_array = np.array(faces, dtype=np.int64)
        unique_verts = np.unique(face_array.flatten())
        # Use __getitem__ to raise KeyError on missing keys instead of silent None
        vert_map = {old: new for new, old in enumerate(unique_verts)}
        new_verts = all_vertices[unique_verts]
        new_faces = np.vectorize(vert_map.__getitem__)(face_array)

        try:
            mesh = trimesh.Trimesh(vertices=new_verts, faces=new_faces, process=False)
            if len(mesh.vertices) > 0:
                meshes[name] = mesh
        except Exception as e:
            log.warning("Failed to create mesh for %s: %s", name, e)

    log.info("  Created %d mesh groups", len(meshes))
    return meshes


def decimate_mesh(mesh, target_faces: int, name: str = ""):
    """Decimate a single mesh to target face count."""
    import trimesh

    if len(mesh.faces) <= target_faces:
        log.info("    %s: %d faces <= target %d, keeping as-is", name, len(mesh.faces), target_faces)
        return mesh

    # Validate target is achievable
    if target_faces < 4:
        target_faces = 4

    # Try fast_simplification directly
    try:
        import fast_simplification
        target_ratio = 1.0 - (target_faces / len(mesh.faces))
        # Clamp to valid range for fast_simplification
        target_ratio = max(0.01, min(0.99, target_ratio))
        verts_out, faces_out = fast_simplification.simplify(
            mesh.vertices.astype(np.float32),
            mesh.faces.astype(np.int32),
            target_reduction=target_ratio,
        )
        decimated = trimesh.Trimesh(vertices=verts_out, faces=faces_out, process=False)
        log.info("    %s: %s -> %s faces (%s -> %s verts)",
                 name, f"{len(mesh.faces):,}", f"{len(decimated.faces):,}",
                 f"{len(mesh.vertices):,}", f"{len(decimated.vertices):,}")
        return decimated
    except Exception as e:
        log.warning("    %s: fast_simplification failed (%s), trying trimesh fallback", name, e)

    # Fallback: trimesh's built-in
    try:
        decimated = mesh.simplify_quadric_decimation(target_faces)
        log.info("    %s: %s -> %s faces (trimesh fallback)",
                 name, f"{len(mesh.faces):,}", f"{len(decimated.faces):,}")
        return decimated
    except Exception as e:
        log.warning("    %s: all decimation failed (%s), keeping original (%s verts)",
                    name, e, f"{len(mesh.vertices):,}")
        return mesh


def categorize_group(name: str, vertex_count: int) -> str:
    """Categorize a group for decimation target selection."""
    if any(prefix in name for prefix in CABLE_PART_PREFIXES):
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

    # Approximate: faces ~ 2 * vertices for triangle meshes
    target_f = target_v * 2
    return max(12, min(target_f, face_count))


def decimate_obj(input_path: str, output_dir: str, config_path: str | None = None):
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
            'cable': {'target_ratio': 0.05, 'min_vertices': 4, 'max_vertices': 200},
            'tiny': {'keep_as_is': True},
        }

    # Normalize config: treat cable_merge as cable
    if 'cable_merge' in dec_config and 'cable' not in dec_config:
        dec_config['cable'] = dec_config['cable_merge']
    # Ensure cable config has the right keys
    if 'cable' in dec_config and 'target_ratio' not in dec_config['cable']:
        dec_config['cable'] = {'target_ratio': 0.05, 'min_vertices': 4, 'max_vertices': 200}

    os.makedirs(output_dir, exist_ok=True)

    meshes = load_obj_groups(input_path)
    if not meshes:
        log.error("No meshes loaded!")
        return None

    results = {
        'input': input_path,
        'output_dir': output_dir,
        'groups': [],
        'totals': {'original_vertices': 0, 'decimated_vertices': 0,
                   'original_faces': 0, 'decimated_faces': 0}
    }

    decimated_meshes: dict[str, trimesh.Trimesh] = {}

    for name, mesh in sorted(meshes.items()):
        vc = len(mesh.vertices)
        fc = len(mesh.faces)
        category = categorize_group(name, vc)
        target_f = compute_target_faces(vc, fc, category, dec_config)

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
        file_size_mb = os.path.getsize(combined_path) / (1024 * 1024)
        results['output_file'] = combined_path
        results['output_size_mb'] = round(file_size_mb, 2)
        log.info("Saved combined GLB: %s (%.1f MB)", combined_path, file_size_mb)
    except Exception as e:
        log.error("Failed to save combined GLB: %s", e)
        # Save individual OBJ files as fallback
        failed_count = 0
        for name, mesh in decimated_meshes.items():
            safe_name = name.replace(' ', '_').replace('/', '_')
            mesh_path = os.path.join(output_dir, f"{safe_name}.obj")
            try:
                mesh.export(mesh_path)
            except Exception as export_err:
                failed_count += 1
                log.warning("Failed to export %s: %s", name, export_err)
        if failed_count:
            log.warning("%d individual mesh exports failed", failed_count)

    # Save report
    report_path = os.path.join(output_dir, "decimation_report.json")
    with open(report_path, 'w') as f:
        json.dump(results, f, indent=2)
    log.info("Saved report: %s", report_path)

    # Print summary
    t = results['totals']
    log.info("=== DECIMATION SUMMARY ===")
    log.info("  Original:  %10s vertices, %10s faces",
             f"{t['original_vertices']:,}", f"{t['original_faces']:,}")
    log.info("  Decimated: %10s vertices, %10s faces",
             f"{t['decimated_vertices']:,}", f"{t['decimated_faces']:,}")
    pct = round(100 * (1 - t['decimated_vertices'] / max(1, t['original_vertices'])), 1)
    log.info("  Reduction: %s%%", pct)

    return results


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python decimate.py <input.obj> <output_dir> [config.json]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    config_path = sys.argv[3] if len(sys.argv) > 3 else None

    decimate_obj(input_path, output_dir, config_path)
