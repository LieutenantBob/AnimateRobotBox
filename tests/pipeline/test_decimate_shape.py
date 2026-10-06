"""Shape guard in the decimation pipeline: never ship a decimation that changes the part."""
import sys
from pathlib import Path

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src' / 'pipeline'))
import decimate


def test_identical_meshes_have_no_shape_error():
    box = trimesh.creation.box(extents=(100, 50, 20))
    # Sampling-based, so allow a little noise, far below the 2 mm tolerance floor.
    assert decimate.shape_error(box, box.copy()) < 0.5


def test_shape_error_detects_a_spike():
    box = trimesh.creation.box(extents=(100, 50, 20))
    spiked = box.copy()
    spiked.vertices[0] = spiked.vertices[0] + np.array([300.0, 0, 0])  # pull one corner far out
    assert decimate.shape_error(box, spiked) > 100


def test_shape_error_detects_a_missing_feature():
    rail = trimesh.creation.box(extents=(600, 20, 20))
    stub = trimesh.creation.box(extents=(300, 20, 20))
    stub.apply_translation((-150, 0, 0))  # rail cut short at one end
    assert decimate.shape_error(rail, stub) > 200


def test_decimate_mesh_keeps_shape_within_tolerance():
    rod = trimesh.creation.cylinder(radius=10, height=600, sections=64)
    rod = rod.subdivide().subdivide()
    out = decimate.decimate_mesh(rod, target_faces=60, name='rod')
    assert decimate.shape_error(rod, out) <= decimate.shape_tolerance(rod)


def test_mesh_already_under_target_is_returned_unchanged():
    box = trimesh.creation.box(extents=(10, 10, 10))
    assert decimate.decimate_mesh(box, target_faces=1000) is box
