"""Parse OBJ files to extract group names, vertex counts, and bounding boxes."""

import re
import json
import sys
from pathlib import Path
from dataclasses import dataclass, field, asdict


@dataclass
class GroupInfo:
    name: str
    vertex_indices: list[int] = field(default_factory=list)
    face_count: int = 0
    bbox_min: list[float] = field(default_factory=lambda: [float('inf')] * 3)
    bbox_max: list[float] = field(default_factory=lambda: [float('-inf')] * 3)


def parse_obj(filepath: str) -> dict:
    """Parse an OBJ file and return group-level statistics."""
    vertices = []
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
                    vi = int(vert_ref.split('/')[0]) - 1  # OBJ is 1-indexed
                    if vi not in group.vertex_indices:
                        group.vertex_indices.append(vi)

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
    """Parse a large OBJ file using streaming to avoid memory issues with vertex indices.

    Instead of tracking individual vertex indices per group, tracks vertex index ranges.
    """
    total_vertices = 0
    total_faces = 0
    groups: dict[str, dict] = {}
    current_group = "default"
    vertices_buffer = []  # Keep all vertices for bbox computation

    print(f"Streaming parse of {filepath}...")
    line_count = 0

    with open(filepath, 'r', errors='replace') as f:
        for line in f:
            line_count += 1
            if line_count % 1_000_000 == 0:
                print(f"  ...processed {line_count:,} lines")

            stripped = line.strip()
            if not stripped or stripped.startswith('#'):
                continue

            if stripped.startswith('v '):
                parts = stripped.split()
                if len(parts) >= 4:
                    coords = [float(parts[1]), float(parts[2]), float(parts[3])]
                    vertices_buffer.append(coords)
                    total_vertices += 1

            elif stripped.startswith('g '):
                current_group = stripped[2:].strip()
                if current_group not in groups:
                    groups[current_group] = {
                        "name": current_group,
                        "face_count": 0,
                        "vertex_indices_set": set(),
                        "bbox_min": [float('inf')] * 3,
                        "bbox_max": [float('-inf')] * 3,
                    }

            elif stripped.startswith('f '):
                if current_group not in groups:
                    groups[current_group] = {
                        "name": current_group,
                        "face_count": 0,
                        "vertex_indices_set": set(),
                        "bbox_min": [float('inf')] * 3,
                        "bbox_max": [float('-inf')] * 3,
                    }
                group = groups[current_group]
                group["face_count"] += 1
                total_faces += 1

                parts = stripped.split()
                for vert_ref in parts[1:]:
                    vi = int(vert_ref.split('/')[0]) - 1
                    group["vertex_indices_set"].add(vi)

    print(f"  Total: {total_vertices:,} vertices, {total_faces:,} faces, {len(groups)} groups")
    print("  Computing bounding boxes...")

    # Compute bounding boxes
    for group in groups.values():
        for vi in group["vertex_indices_set"]:
            if 0 <= vi < len(vertices_buffer):
                for axis in range(3):
                    group["bbox_min"][axis] = min(group["bbox_min"][axis], vertices_buffer[vi][axis])
                    group["bbox_max"][axis] = max(group["bbox_max"][axis], vertices_buffer[vi][axis])

    # Build result
    result = {
        "file": str(filepath),
        "total_vertices": total_vertices,
        "total_faces": total_faces,
        "total_groups": len(groups),
        "groups": []
    }

    for name, group in sorted(groups.items()):
        vc = len(group["vertex_indices_set"])
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

    # Use streaming parser for large files
    import os
    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    if size_mb > 10:
        result = parse_obj_streaming(filepath)
    else:
        result = parse_obj(filepath)

    if output:
        with open(output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"Saved to {output}")
    else:
        print(json.dumps(result, indent=2))
