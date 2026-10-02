"""Routing Agent: estimates, detours and multi-stop planning (spec 4.6)."""
import asyncio

from app.agents.routing import estimate_route, get_multi_stop_route, get_route, route_is_blocked
from app.geo import haversine_m

ORIGIN = (30.7333, 76.7794)
DEST = (30.7500, 76.8000)


def test_estimate_is_longer_than_straight_line():
    """Roads are not straight; a route shorter than the crow flies is a bug."""
    route = estimate_route(ORIGIN, DEST, speed_kmh=45)
    straight = haversine_m(*ORIGIN, *DEST)
    assert route.distance_m > straight
    assert route.duration_s > 0
    assert route.geometry[0] == [ORIGIN[0], ORIGIN[1]]
    assert route.geometry[-1] == [DEST[0], DEST[1]]


def test_slower_units_get_longer_etas():
    fast = estimate_route(ORIGIN, DEST, speed_kmh=60)
    slow = estimate_route(ORIGIN, DEST, speed_kmh=20)
    assert slow.duration_s > fast.duration_s


def test_blocked_route_is_detected_and_detoured():
    direct = asyncio.run(get_route(ORIGIN, DEST, speed_kmh=45))
    midpoint = direct.geometry[len(direct.geometry) // 2]
    closure = {"lat": midpoint[0], "lng": midpoint[1], "radius_m": 300}

    assert route_is_blocked(direct, [closure]) is not None

    detour = asyncio.run(get_route(ORIGIN, DEST, speed_kmh=45, closures=[closure]))
    assert detour.detoured is True
    assert detour.distance_m > direct.distance_m


def test_unblocked_route_is_left_alone():
    far = [{"lat": 20.0, "lng": 60.0, "radius_m": 500}]
    route = asyncio.run(get_route(ORIGIN, DEST, speed_kmh=45, closures=far))
    assert route.detoured is False


def test_multi_stop_visits_every_stop_in_order():
    stops = [
        {"lat": 30.740, "lng": 76.790, "incident_id": 1, "priority": 1.0},
        {"lat": 30.750, "lng": 76.800, "incident_id": 2, "priority": 1.0},
        {"lat": 30.736, "lng": 76.782, "incident_id": 3, "priority": 1.0},
    ]
    route = asyncio.run(get_multi_stop_route(ORIGIN, stops, speed_kmh=32))
    assert len(route.stops) == 3
    assert [s["order"] for s in route.stops] == [1, 2, 3]
    assert {s["incident_id"] for s in route.stops} == {1, 2, 3}
    etas = [s["eta_seconds"] for s in route.stops]
    assert etas == sorted(etas), "cumulative ETAs must increase along the run"


def test_multi_stop_orders_comparable_stops_by_priority():
    """Between two stops at similar distance, the urgent one is served first.
    (Priority is weighted against distance, not absolute — a stop 20x closer
    still gets picked up on the way, which is the behaviour we want.)"""
    low = {"lat": 30.7450, "lng": 76.7950, "incident_id": 1, "priority": 0.3}
    high = {"lat": 30.7250, "lng": 76.7650, "incident_id": 2, "priority": 3.0}
    route = asyncio.run(get_multi_stop_route(ORIGIN, [low, high], speed_kmh=32))
    assert route.stops[0]["incident_id"] == 2


def test_multi_stop_still_collects_a_very_close_stop_first():
    """Efficiency check: an almost-adjacent stop is not skipped for a distant
    urgent one — the truck grabs it on the way past."""
    adjacent = {"lat": 30.7336, "lng": 76.7797, "incident_id": 1, "priority": 0.3}
    distant = {"lat": 30.7600, "lng": 76.8200, "incident_id": 2, "priority": 3.0}
    route = asyncio.run(get_multi_stop_route(ORIGIN, [adjacent, distant], speed_kmh=32))
    assert route.stops[0]["incident_id"] == 1
