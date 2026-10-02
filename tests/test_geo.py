"""Geospatial index correctness — the NFR that says no naive distance loops."""
import math
import random

from app.geo import SpatialGridIndex, haversine_m, point_at_distance, polyline_length_m


def test_haversine_known_distance():
    # Chandigarh to Delhi is roughly 240 km.
    d = haversine_m(30.7333, 76.7794, 28.6139, 77.2090)
    assert 235_000 < d < 250_000


def test_grid_index_matches_brute_force():
    """The whole point of the index is that it returns the same answer as a
    full scan while touching far fewer points."""
    random.seed(7)
    points = [
        (i, 30.70 + random.uniform(-0.05, 0.05), 76.75 + random.uniform(-0.05, 0.05))
        for i in range(600)
    ]
    index = SpatialGridIndex(cell_deg=0.01)
    index.rebuild(points)

    lat, lng, radius = 30.7333, 76.7794, 2000.0
    expected = sorted(
        pid for pid, plat, plng in points if haversine_m(lat, lng, plat, plng) <= radius
    )
    actual = sorted(pid for pid, _ in index.query_radius(lat, lng, radius))
    assert actual == expected
    assert index.cell_count > 1  # points really are spread across buckets


def test_grid_index_results_sorted_by_distance():
    index = SpatialGridIndex()
    index.rebuild([(1, 30.74, 76.78), (2, 30.7335, 76.7796), (3, 30.75, 76.80)])
    hits = index.query_radius(30.7333, 76.7794, 20000)
    assert [h[0] for h in hits] == [2, 1, 3]
    assert hits[0][1] < hits[1][1] < hits[2][1]


def test_index_upsert_moves_a_point_between_cells():
    index = SpatialGridIndex()
    index.upsert(1, 30.70, 76.70)
    assert index.query_radius(30.70, 76.70, 500)
    index.upsert(1, 30.90, 76.90)  # same id, new position
    assert not index.query_radius(30.70, 76.70, 500)
    assert index.query_radius(30.90, 76.90, 500)
    assert len(index) == 1


def test_point_at_distance_walks_a_polyline():
    line = [[30.70, 76.70], [30.71, 76.70], [30.72, 76.70]]
    total = polyline_length_m(line)
    start = point_at_distance(line, 0)
    mid = point_at_distance(line, total / 2)
    end = point_at_distance(line, total)
    assert math.isclose(start[0], 30.70, abs_tol=1e-6)
    assert math.isclose(mid[0], 30.71, abs_tol=1e-3)
    assert math.isclose(end[0], 30.72, abs_tol=1e-6)
