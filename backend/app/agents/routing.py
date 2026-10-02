"""Routing Agent — specification section 4.6.

Responsibilities:
  * real road-network routes and ETAs for resource-incident pairs
  * multi-stop planning for supply trucks serving several destinations
  * live re-routing when a road is reported blocked or a higher-priority
    incident interrupts an in-progress run

Provider strategy mirrors the LLM layer: if `OSRM_URL` is configured the agent
calls OSRM's HTTP API for true road geometry; otherwise it uses a built-in
estimator (great-circle distance scaled by a road-network factor, with a
synthetic multi-segment polyline so the map still animates believably). The
estimator is clearly labelled in every response so nobody mistakes a
demo ETA for a surveyed one.
"""
from __future__ import annotations

import asyncio
import logging
import math
from dataclasses import dataclass, field
from typing import Sequence

import httpx

from ..config import settings
from ..geo import (
    bearing_deg,
    haversine_m,
    offset_point,
    point_to_segment_distance_m,
    polyline_length_m,
)

log = logging.getLogger("drc.routing")

# Rough free-flow speeds (km/h) by resource type, degraded for disaster conditions.
DEFAULT_SPEEDS = {
    "ambulance": 46.0,
    "fire_engine": 40.0,
    "supply_truck": 32.0,
    "personnel": 24.0,
    "shelter": 1.0,
}


@dataclass
class Route:
    geometry: list[list[float]]
    distance_m: float
    duration_s: float
    provider: str
    detoured: bool = False
    stops: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "geometry": self.geometry,
            "distance_m": round(self.distance_m, 1),
            "duration_s": round(self.duration_s, 1),
            "provider": self.provider,
            "detoured": self.detoured,
            "stops": self.stops,
        }


_client: httpx.AsyncClient | None = None
_osrm_failures = 0


async def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=settings.ROUTING_TIMEOUT)
    return _client


async def aclose() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def provider_name() -> str:
    if settings.OSRM_URL and _osrm_failures < 3:
        return "osrm"
    return "estimator"


# --------------------------------------------------------------------------
# OSRM
# --------------------------------------------------------------------------
async def _osrm_route(points: Sequence[Sequence[float]], profile: str = "driving") -> Route | None:
    """points are (lat, lng); OSRM wants lng,lat."""
    global _osrm_failures
    if not settings.OSRM_URL or _osrm_failures >= 3:
        return None
    coords = ";".join(f"{p[1]:.6f},{p[0]:.6f}" for p in points)
    url = f"{settings.OSRM_URL.rstrip('/')}/route/v1/{profile}/{coords}"
    params = {"overview": "full", "geometries": "geojson", "continue_straight": "false"}
    try:
        client = await _http()
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        route = data["routes"][0]
        geometry = [[c[1], c[0]] for c in route["geometry"]["coordinates"]]
        _osrm_failures = 0
        return Route(
            geometry=geometry,
            distance_m=float(route["distance"]),
            duration_s=float(route["duration"]),
            provider="osrm",
        )
    except Exception as exc:  # noqa: BLE001
        _osrm_failures += 1
        log.warning("OSRM request failed (%s/3): %s", _osrm_failures, exc)
        return None


# --------------------------------------------------------------------------
# Offline estimator
# --------------------------------------------------------------------------
def _synthetic_polyline(origin: Sequence[float], destination: Sequence[float], steps: int = 14) -> list[list[float]]:
    """A plausible street-like path: the straight line broken into segments with
    a deterministic lateral wobble, so animated movement does not look like a
    ruler being drawn across the map."""
    total = haversine_m(origin[0], origin[1], destination[0], destination[1])
    if total < 60:
        return [[origin[0], origin[1]], [destination[0], destination[1]]]

    base_bearing = bearing_deg(origin[0], origin[1], destination[0], destination[1])
    seed = int(abs(origin[0] * 1000 + origin[1] * 1000 + destination[0] * 700)) % 97
    points: list[list[float]] = [[origin[0], origin[1]]]

    for i in range(1, steps):
        t = i / steps
        # Lateral offset follows a half-sine so the path leaves and rejoins the
        # straight line smoothly, capped at 8% of total distance.
        wobble = math.sin(t * math.pi) * math.sin((seed + i * 37) % 360 * math.pi / 180)
        lateral = wobble * min(total * 0.08, 400.0)
        along_lat = origin[0] + (destination[0] - origin[0]) * t
        along_lng = origin[1] + (destination[1] - origin[1]) * t
        lat, lng = offset_point(along_lat, along_lng, abs(lateral), (base_bearing + 90 * (1 if lateral >= 0 else -1)) % 360)
        points.append([round(lat, 6), round(lng, 6)])

    points.append([destination[0], destination[1]])
    return points


def estimate_route(
    origin: Sequence[float],
    destination: Sequence[float],
    speed_kmh: float = 40.0,
) -> Route:
    geometry = _synthetic_polyline(origin, destination)
    straight = haversine_m(origin[0], origin[1], destination[0], destination[1])
    distance = max(polyline_length_m(geometry), straight * settings.ROAD_FACTOR)
    speed_ms = max(speed_kmh, 5.0) * 1000 / 3600
    # Add a fixed mobilisation overhead — crews do not teleport into the cab.
    duration = distance / speed_ms + 45.0
    return Route(geometry=geometry, distance_m=distance, duration_s=duration, provider="estimator")


# --------------------------------------------------------------------------
# Road closures
# --------------------------------------------------------------------------
def route_is_blocked(route: Route, closures: Sequence[dict]) -> dict | None:
    """Return the first closure the route geometry passes through."""
    for closure in closures:
        c = (closure["lat"], closure["lng"])
        radius = closure.get("radius_m", 250.0)
        for i in range(len(route.geometry) - 1):
            d = point_to_segment_distance_m(c, route.geometry[i], route.geometry[i + 1])
            if d <= radius:
                return closure
    return None


def _detour_waypoint(closure: dict, origin: Sequence[float], destination: Sequence[float]) -> tuple[float, float]:
    """Pick a waypoint clear of the closure, offset perpendicular to the
    origin-destination line on the side that adds least distance."""
    heading = bearing_deg(origin[0], origin[1], destination[0], destination[1])
    clearance = closure.get("radius_m", 250.0) * 2.2 + 150.0
    left = offset_point(closure["lat"], closure["lng"], clearance, (heading + 90) % 360)
    right = offset_point(closure["lat"], closure["lng"], clearance, (heading - 90) % 360)

    def detour_cost(wp):
        return haversine_m(origin[0], origin[1], wp[0], wp[1]) + haversine_m(
            wp[0], wp[1], destination[0], destination[1]
        )

    return left if detour_cost(left) <= detour_cost(right) else right


async def get_route(
    origin: Sequence[float],
    destination: Sequence[float],
    *,
    speed_kmh: float = 40.0,
    closures: Sequence[dict] = (),
    profile: str = "driving",
) -> Route:
    """Primary entry point: a routed path from origin to destination that
    respects active road closures."""
    route = await _osrm_route([origin, destination], profile) or estimate_route(origin, destination, speed_kmh)

    if not closures:
        return route

    blocker = route_is_blocked(route, closures)
    if blocker is None:
        return route

    waypoint = _detour_waypoint(blocker, origin, destination)
    detour = await _osrm_route([origin, waypoint, destination], profile)
    if detour is None:
        leg_a = estimate_route(origin, waypoint, speed_kmh)
        leg_b = estimate_route(waypoint, destination, speed_kmh)
        detour = Route(
            geometry=leg_a.geometry + leg_b.geometry[1:],
            distance_m=leg_a.distance_m + leg_b.distance_m,
            duration_s=leg_a.duration_s + leg_b.duration_s - 45.0,
            provider=leg_a.provider,
        )
    detour.detoured = True

    # If the detour still clips a closure, accept it but keep the flag —
    # better to surface an imperfect route to the commander than to hide it.
    return detour


# --------------------------------------------------------------------------
# Multi-stop routing (supply trucks — section 4.6)
# --------------------------------------------------------------------------
def _order_stops_nearest_neighbour(
    origin: Sequence[float], stops: list[dict]
) -> list[dict]:
    remaining = list(stops)
    ordered: list[dict] = []
    cursor = (origin[0], origin[1])
    while remaining:
        # Priority-weighted nearest neighbour: a stop that is twice as urgent
        # is worth travelling meaningfully further for.
        best = min(
            remaining,
            key=lambda s: haversine_m(cursor[0], cursor[1], s["lat"], s["lng"])
            / max(s.get("priority", 1.0), 0.2),
        )
        ordered.append(best)
        remaining.remove(best)
        cursor = (best["lat"], best["lng"])
    return ordered


async def get_multi_stop_route(
    origin: Sequence[float],
    stops: list[dict],
    *,
    speed_kmh: float = 32.0,
    closures: Sequence[dict] = (),
) -> Route:
    """Plan one trip visiting several destinations. `stops` entries need
    lat/lng and may carry `priority` and `label`."""
    if not stops:
        raise ValueError("at least one stop is required")

    ordered = _order_stops_nearest_neighbour(origin, stops)
    geometry: list[list[float]] = []
    total_distance = 0.0
    total_duration = 0.0
    detoured = False
    cursor = [origin[0], origin[1]]
    stop_meta: list[dict] = []

    for index, stop in enumerate(ordered):
        leg = await get_route(
            cursor, [stop["lat"], stop["lng"]], speed_kmh=speed_kmh, closures=closures
        )
        detoured = detoured or leg.detoured
        geometry.extend(leg.geometry if not geometry else leg.geometry[1:])
        total_distance += leg.distance_m
        total_duration += leg.duration_s
        stop_meta.append(
            {
                "order": index + 1,
                "label": stop.get("label") or f"Stop {index + 1}",
                "incident_id": stop.get("incident_id"),
                "lat": stop["lat"],
                "lng": stop["lng"],
                "cumulative_distance_m": round(total_distance, 1),
                "eta_seconds": round(total_duration, 1),
            }
        )
        # Service time at each stop.
        total_duration += float(stop.get("service_seconds", 180))
        cursor = [stop["lat"], stop["lng"]]

    return Route(
        geometry=geometry,
        distance_m=total_distance,
        duration_s=total_duration,
        provider=provider_name(),
        detoured=detoured,
        stops=stop_meta,
    )


async def batch_routes(
    pairs: list[tuple[Sequence[float], Sequence[float], float]],
    closures: Sequence[dict] = (),
) -> list[Route]:
    """Route several candidate pairs concurrently — used by the Dispatch Agent
    so getting real ETAs for the shortlist costs one round trip, not N."""
    tasks = [
        get_route(origin, destination, speed_kmh=speed, closures=closures)
        for origin, destination, speed in pairs
    ]
    return list(await asyncio.gather(*tasks))
