"""Parse OBJ files to extract group names, vertex counts, and bounding boxes."""

import json
import logging
import os
import sys
from dataclasses import dataclass, field

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
log = logging.getLogger(__name__)


def _parse_vertex_index(raw_str: str, vertex_count: int) -> int:
    """Parse an OBJ vertex index, handling negative (relative) indices."""
    raw = int(raw_str.split('/')[0])
    return raw - 1 if raw > 0 else vertex_count + raw


@dataclass
class GroupInfo:
    name: str
    vertex_indices: set[int] = field(default_factory=set)
    face_count: int = 0
    bbox_min: list[float] = field(default_factory=lambda: [float('inf')] * 3)
    bbox_max: list[float] = field(default_factory=lambda: [float('-inf')] * 3)


def parse_obj(filepath: str) -> dict:
    """Parse an OBJ file and return group-level statistics."""
    vertices: list[list[float]] = []
    groups: dict[str, GroupInfo] = {}
    current_group = "default"

    with open(filepath, 'r', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            parts = line.split()
            if not parts:
                continue

            if parts[0] == 'v' and len(parts) >= 4:
                vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])

            elif parts[0] == 'g' and len(parts) >= 2:
                current_group = ' '.join(parts[1:])
                if current_group not in groups:
                    groups[current_group] = GroupInfo(name=current_group)

            elif parts[0] == 'f':
                if current_group not in groups:
                    groups[current_group] = GroupInfo(name=current_group)

                group = groups[current_group]
                group.face_count += 1

                for vert_ref in parts[1:]:
                    vi = _parse_vertex_index(vert_ref, len(vertices))
                    group.vertex_indices.add(vi)

    # Compute bounding boxes from vertex indices
    for group in groups.values():
        for vi in group.vertex_indices:
            if 0 <= vi < len(vertices):
                for axis in range(3):
                    group.bbox_min[axis] = min(group.bbox_min[axis], vertices[vi][axis])
                    group.bbox_max[axis] = max(group.bbox_max[axis], vertices[vi][axis])

    # Build result
    result = {
        "file": str(filepath),
        "total_vertices": len(vertices),
        "total_groups": len(groups),
        "groups": []
    }

    for name, group in groups.items():
        dims = [
            round(group.bbox_max[i] - group.bbox_min[i], 2)
            for i in range(3)
        ] if group.bbox_min[0] != float('inf') else [0, 0, 0]

        result["groups"].append({
            "name": name,
            "vertex_count": len(group.vertex_indices),
            "face_count": group.face_count,
            "bbox_min": [round(v, 2) for v in group.bbox_min] if group.bbox_min[0] != float('inf') else None,
            "bbox_max": [round(v, 2) for v in group.bbox_max] if group.bbox_max[0] != float('inf') else None,
            "dimensions_mm": dims,
        })

    return result


def parse_obj_streaming(filepath: str) -> dict:
    """Parse a large OBJ file with streaming bbox computation.

    Two-pass approach: first pass reads vertices into a list, second pass
    processes faces and accumulates bounding boxes per group using the
    vertex coordinates directly — no per-group vertex index sets needed.
    """
    log.info("Streaming parse of %s...", filepath)
    line_count = 0

    # First pass: read all vertices into a flat list
    vertices: list[list[float]] = []
    group_starts: list[tuple[int, str]] = []  # (line_number, group_name)

    with open(filepath, 'r', errors='replace') as f:
        for line in f:
            line_count += 1
            if line_count % 2_000_000 == 0:
                log.info("  Pass 1: %s lines...", f"{line_count:,}")

            stripped = line.strip()
            if stripped.startswith('v '):
                parts = stripped.split()
                if len(parts) >= 4:
                    vertices.append([float(parts[1]), float(parts[2]), float(parts[3])])

    log.info("  Pass 1 done: %s vertices", f"{len(vertices):,}")

    # Second pass: process groups and faces, accumulate bbox per group
    groups: dict[str, dict] = {}
    current_group = "default"
    total_faces = 0

    with open(filepath, 'r', errors='replace') as f:
        for line in f:
            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue

            if stripped.startswith('g '):
                current_group = stripped[2:].strip()
                if current_group not in groups:
                    groups[current_group] = {
                        "name": current_group,
                        "face_count": 0,
                        "vertex_count_set": set(),
                        "bbox_min": [float('inf')] * 3,
                        "bbox_max": [float('-inf')] * 3,
                    }

            elif stripped.startswith('f '):
                if current_group not in groups:
                    groups[current_group] = {
                        "name": current_group,
                        "face_count": 0,
                        "vertex_count_set": set(),
                        "bbox_min": [float('inf')] * 3,
                        "bbox_max": [float('-inf')] * 3,
                    }
                group = groups[current_group]
                group["face_count"] += 1
                total_faces += 1

                parts = stripped.split()
                for vert_ref in parts[1:]:
                    vi = _parse_vertex_index(vert_ref, len(vertices))
                    if vi not in group["vertex_count_set"]:
                        group["vertex_count_set"].add(vi)
                        # Accumulate bbox inline
                        if 0 <= vi < len(vertices):
                            coord = vertices[vi]
                            for axis in range(3):
                                if coord[axis] < group["bbox_min"][axis]:
                                    group["bbox_min"][axis] = coord[axis]
                                if coord[axis] > group["bbox_max"][axis]:
                                    group["bbox_max"][axis] = coord[axis]

    log.info("  Pass 2 done: %s faces, %d groups", f"{total_faces:,}", len(groups))

    # Build result
    result = {
        "file": str(filepath),
        "total_vertices": len(vertices),
        "total_faces": total_faces,
        "total_groups": len(groups),
        "groups": []
    }

    for name, group in sorted(groups.items()):
        vc = len(group["vertex_count_set"])
        dims = [
            round(group["bbox_max"][i] - group["bbox_min"][i], 2)
            for i in range(3)
        ] if group["bbox_min"][0] != float('inf') else [0, 0, 0]

        result["groups"].append({
            "name": name,
            "vertex_count": vc,
            "face_count": group["face_count"],
            "bbox_min": [round(v, 2) for v in group["bbox_min"]] if group["bbox_min"][0] != float('inf') else None,
            "bbox_max": [round(v, 2) for v in group["bbox_max"]] if group["bbox_max"][0] != float('inf') else None,
            "dimensions_mm": dims,
        })

    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python obj_parser.py <file.obj> [output.json]")
        sys.exit(1)

    filepath = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else None

    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    if size_mb > 10:
        result = parse_obj_streaming(filepath)
    else:
        result = parse_obj(filepath)

    if output:
        with open(output, 'w') as f:
            json.dump(result, f, indent=2)
        log.info("Saved to %s", output)
    else:
        print(json.dumps(result, indent=2))
