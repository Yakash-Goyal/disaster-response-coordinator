"""Geospatial primitives.

NFR "Geospatial accuracy" asks for proper spatial indexing rather than naive
distance loops over every row. Two paths are implemented:

* **PostgreSQL / PostGIS** — a generated `geography(Point,4326)` column with a
  GiST index; proximity searches run as `ST_DWithin` + `ST_Distance`, so the
  database never scans the whole table.
* **SQLite (default)** — an in-process uniform grid index. Points are hashed
  into ~0.01 degree cells; a radius query only visits the cells the circle can
  possibly touch, giving O(k) candidate lookups instead of O(n) scans. The
  haversine refinement then runs over that small candidate set only.

Both paths expose the same `find_nearby_resources()` signature, so the Dispatch
Agent is unaware of which backend is in use.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Sequence

from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import settings

EARTH_RADIUS_M = 6_371_008.8


# --------------------------------------------------------------------------
# Distance maths
# --------------------------------------------------------------------------
def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlam = math.radians(lng2 - lng1)
    y = math.sin(dlam) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlam)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def offset_point(lat: float, lng: float, distance_m: float, bearing: float) -> tuple[float, float]:
    """Point `distance_m` away from (lat,lng) along `bearing` degrees."""
    d = distance_m / EARTH_RADIUS_M
    br = math.radians(bearing)
    p1, l1 = math.radians(lat), math.radians(lng)
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(br))
    l2 = l1 + math.atan2(
        math.sin(br) * math.sin(d) * math.cos(p1),
        math.cos(d) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def interpolate(a: Sequence[float], b: Sequence[float], t: float) -> tuple[float, float]:
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t


def polyline_length_m(points: Sequence[Sequence[float]]) -> float:
    return sum(
        haversine_m(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1])
        for i in range(len(points) - 1)
    )


def point_at_distance(points: Sequence[Sequence[float]], distance_m: float) -> tuple[float, float]:
    """Walk along a polyline and return the coordinate `distance_m` in."""
    if not points:
        raise ValueError("empty polyline")
    if distance_m <= 0:
        return points[0][0], points[0][1]
    travelled = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        seg = haversine_m(a[0], a[1], b[0], b[1])
        if travelled + seg >= distance_m:
            t = 0.0 if seg == 0 else (distance_m - travelled) / seg
            return interpolate(a, b, t)
        travelled += seg
    return points[-1][0], points[-1][1]


def point_to_segment_distance_m(p, a, b) -> float:
    """Approximate distance from point p to segment a-b using a local planar
    projection — accurate at city scale, which is all we need for closures."""
    lat0 = math.radians((a[0] + b[0]) / 2)
    kx = math.cos(lat0) * 111_320.0
    ky = 110_540.0
    px, py = p[1] * kx, p[0] * ky
    ax, ay = a[1] * kx, a[0] * ky
    bx, by = b[1] * kx, b[0] * ky
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# --------------------------------------------------------------------------
# In-process grid index (SQLite path)
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class GeoItem:
    id: int
    lat: float
    lng: float


class SpatialGridIndex:
    """Uniform lat/lng grid hash.

    Cell size is expressed in degrees of latitude; longitude cells are widened
    by 1/cos(lat) so cells stay roughly square in metres. A radius query
    computes the cell window the circle spans and only reads those buckets.
    """

    def __init__(self, cell_deg: float = 0.01) -> None:
        self.cell_deg = cell_deg
        self._cells: dict[tuple[int, int], set[int]] = defaultdict(set)
        self._items: dict[int, GeoItem] = {}

    # -- maintenance ------------------------------------------------------
    def _key(self, lat: float, lng: float) -> tuple[int, int]:
        lon_cell = self.cell_deg / max(math.cos(math.radians(lat)), 0.15)
        return int(math.floor(lat / self.cell_deg)), int(math.floor(lng / lon_cell))

    def upsert(self, item_id: int, lat: float, lng: float) -> None:
        old = self._items.get(item_id)
        if old is not None:
            old_key = self._key(old.lat, old.lng)
            self._cells[old_key].discard(item_id)
            if not self._cells[old_key]:
                del self._cells[old_key]
        self._items[item_id] = GeoItem(item_id, lat, lng)
        self._cells[self._key(lat, lng)].add(item_id)

    def remove(self, item_id: int) -> None:
        item = self._items.pop(item_id, None)
        if item is None:
            return
        key = self._key(item.lat, item.lng)
        self._cells[key].discard(item_id)
        if not self._cells[key]:
            del self._cells[key]

    def rebuild(self, items: Iterable[tuple[int, float, float]]) -> None:
        self._cells.clear()
        self._items.clear()
        for item_id, lat, lng in items:
            self.upsert(item_id, lat, lng)

    def __len__(self) -> int:
        return len(self._items)

    @property
    def cell_count(self) -> int:
        return len(self._cells)

    # -- queries ----------------------------------------------------------
    def query_radius(self, lat: float, lng: float, radius_m: float) -> list[tuple[int, float]]:
        """Return [(id, distance_m)] within radius, nearest first."""
        lat_span = radius_m / 110_540.0
        lon_span = radius_m / max(math.cos(math.radians(lat)) * 111_320.0, 1.0)
        lon_cell = self.cell_deg / max(math.cos(math.radians(lat)), 0.15)

        lat_lo = int(math.floor((lat - lat_span) / self.cell_deg))
        lat_hi = int(math.floor((lat + lat_span) / self.cell_deg))
        lng_lo = int(math.floor((lng - lon_span) / lon_cell))
        lng_hi = int(math.floor((lng + lon_span) / lon_cell))

        out: list[tuple[int, float]] = []
        for r in range(lat_lo, lat_hi + 1):
            for c in range(lng_lo, lng_hi + 1):
                for item_id in self._cells.get((r, c), ()):  # only populated cells
                    item = self._items[item_id]
                    d = haversine_m(lat, lng, item.lat, item.lng)
                    if d <= radius_m:
                        out.append((item_id, d))
        out.sort(key=lambda x: x[1])
        return out

    def query_knn(self, lat: float, lng: float, k: int, max_radius_m: float) -> list[tuple[int, float]]:
        """Expanding-ring search: start small, grow until k found or capped."""
        radius = max(500.0, max_radius_m / 8)
        while True:
            found = self.query_radius(lat, lng, radius)
            if len(found) >= k or radius >= max_radius_m:
                return found[:k]
            radius = min(radius * 2, max_radius_m)


# Module-level indexes kept in sync by the services layer.
resource_index = SpatialGridIndex()
incident_index = SpatialGridIndex()


# --------------------------------------------------------------------------
# PostGIS setup + unified query API
# --------------------------------------------------------------------------
POSTGIS_READY = False


def ensure_postgis(db: Session) -> None:
    """Add generated geography columns + GiST indexes when running Postgres."""
    global POSTGIS_READY
    if not settings.is_postgres or POSTGIS_READY:
        return
    stmts = []
    for table in ("resources", "incidents", "reports"):
        stmts.append(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS geog geography(Point,4326) "
            f"GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat),4326)::geography) STORED"
        )
        stmts.append(f"CREATE INDEX IF NOT EXISTS ix_{table}_geog ON {table} USING GIST (geog)")
    try:
        for s in stmts:
            db.execute(text(s))
        db.commit()
        POSTGIS_READY = True
    except Exception:  # pragma: no cover - falls back to grid index
        db.rollback()
        POSTGIS_READY = False


def find_nearby(
    db: Session,
    table: str,
    lat: float,
    lng: float,
    radius_m: float,
    limit: int = 20,
    extra_where: str = "",
) -> list[tuple[int, float]]:
    """Backend-agnostic proximity search returning [(id, distance_m)]."""
    if settings.is_postgres and POSTGIS_READY:
        sql = text(
            f"""
            SELECT id, ST_Distance(geog, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography) AS d
            FROM {table}
            WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography, :r)
            {extra_where}
            ORDER BY d ASC LIMIT :lim
            """
        )
        rows = db.execute(sql, {"lat": lat, "lng": lng, "r": radius_m, "lim": limit}).all()
        return [(int(r[0]), float(r[1])) for r in rows]

    index = resource_index if table == "resources" else incident_index
    return index.query_knn(lat, lng, limit, radius_m)


def index_backend_name() -> str:
    if settings.is_postgres and POSTGIS_READY:
        return "postgis-gist"
    return "grid-hash"
