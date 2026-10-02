"""Scenario seeding — specification section 9 (Evaluation / Demo Plan).

Creates the accounts, the resource fleet and, on request, a burst of incoming
reports representing a flood spreading across a mock city. The burst is the
demo's opening move: reports arrive faster than a human could read them, the
Triage Agent classifies and deduplicates them live, and the queue orders itself.

Coordinates are laid out around `SCENARIO_CENTER_LAT/LNG` so the scenario can
be relocated to any city by changing two settings.
"""
from __future__ import annotations

import asyncio
import logging
import random

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..geo import offset_point, resource_index, incident_index
from ..models import Incident, ReportSource, Resource, ResourceStatus, ResourceType, Role, User
from ..security import hash_password

log = logging.getLogger("drc.seed")

CENTER = (settings.SCENARIO_CENTER_LAT, settings.SCENARIO_CENTER_LNG)

# name, type, capabilities, bearing from centre (deg), distance (m), speed km/h
FLEET: list[tuple[str, str, list[str], float, float, float]] = [
    ("Ambulance 01", ResourceType.AMBULANCE.value, ["trauma_kit", "paramedic", "oxygen"], 20, 1800, 48),
    ("Ambulance 02", ResourceType.AMBULANCE.value, ["trauma_kit", "paramedic"], 95, 2600, 48),
    ("Ambulance 03", ResourceType.AMBULANCE.value, ["paramedic", "oxygen", "cardiac_monitor"], 165, 3100, 46),
    ("Ambulance 04", ResourceType.AMBULANCE.value, ["trauma_kit"], 250, 2200, 46),
    ("Engine 11", ResourceType.FIRE_ENGINE.value, ["fire_suppression", "breathing_apparatus", "cutting_gear"], 55, 2400, 40),
    ("Engine 12", ResourceType.FIRE_ENGINE.value, ["fire_suppression", "hazmat_suit", "decon_unit"], 200, 3400, 38),
    ("Engine 13", ResourceType.FIRE_ENGINE.value, ["fire_suppression", "heavy_lift", "cutting_gear"], 310, 2900, 38),
    ("Rescue Team A", ResourceType.PERSONNEL.value, ["boat", "rope_rescue", "search_dog"], 140, 1500, 26),
    ("Rescue Team B", ResourceType.PERSONNEL.value, ["boat", "water_pump", "rope_rescue"], 285, 2700, 26),
    ("Rescue Team C", ResourceType.PERSONNEL.value, ["heavy_lift", "chainsaw", "generator"], 15, 3300, 24),
    ("Rescue Team D", ResourceType.PERSONNEL.value, ["electrician", "generator", "chainsaw"], 230, 4000, 24),
    ("Supply Truck S1", ResourceType.SUPPLY_TRUCK.value, ["water", "blankets", "rations"], 75, 3800, 34),
    ("Supply Truck S2", ResourceType.SUPPLY_TRUCK.value, ["water_pump", "generator", "rations"], 190, 4400, 32),
    ("Shelter North", ResourceType.SHELTER.value, ["beds_120", "kitchen", "medical_post"], 350, 3600, 1),
    ("Shelter South", ResourceType.SHELTER.value, ["beds_80", "kitchen"], 170, 4200, 1),
]

USERS: list[tuple[str, str, str, str]] = [
    ("commander", "Commander Rao", Role.COMMANDER.value, "commander123"),
    ("admin", "Ops Admin", Role.ADMIN.value, "admin123"),
    ("responder1", "R. Sharma (Ambulance 01)", Role.RESPONDER.value, "responder123"),
    ("responder2", "K. Iyer (Engine 11)", Role.RESPONDER.value, "responder123"),
    ("responder3", "M. Bedi (Rescue Team A)", Role.RESPONDER.value, "responder123"),
]

RESPONDER_UNITS = {
    "responder1": "Ambulance 01",
    "responder2": "Engine 11",
    "responder3": "Rescue Team A",
}

# The opening burst: bearing, distance_m, text, source.
FLOOD_BURST: list[tuple[float, float, str, str]] = [
    (30, 900, "Water is rising fast on the market road, it's over the kerb and coming into the shops", ReportSource.SOCIAL.value),
    (34, 1000, "market road completely flooded, cars are stuck, nobody can get through", ReportSource.SOCIAL.value),
    (28, 850, "Shopkeepers wading out through knee-deep water on the market road", ReportSource.MANUAL.value),
    (120, 1600, "Family of four stranded on the roof of a house near the canal, water still rising", ReportSource.MANUAL.value),
    (122, 1650, "people on rooftops by the canal shouting for help, been there 20 minutes", ReportSource.SOCIAL.value),
    (210, 2100, "Elderly man collapsed at the relief queue outside the community centre, unconscious and not responding", ReportSource.MANUAL.value),
    (265, 1900, "Smoke coming from the second floor of the apartment block behind the bus stand, people still inside", ReportSource.SOCIAL.value),
    (267, 1950, "FIRE at the apartments near the bus stand!! flames visible from the road now", ReportSource.SOCIAL.value),
    (340, 2400, "Part of the old school boundary wall has collapsed, rubble across the footpath, someone may be under it", ReportSource.MANUAL.value),
    (75, 2800, "Large tree down across the hospital approach road, ambulances cannot pass", ReportSource.MANUAL.value),
    (160, 3000, "Transformer near the water tank blew, whole lane has no power since last night", ReportSource.SOCIAL.value),
    (300, 3300, "Strong chemical smell from the storage yard, several people complaining their eyes are burning", ReportSource.MANUAL.value),
    (95, 1200, "Drain overflowing behind the temple, ankle deep but rising steadily", ReportSource.SOCIAL.value),
    (185, 2600, "Two people cut by broken glass at the shelter entrance, one is bleeding heavily", ReportSource.MANUAL.value),
    (250, 3600, "not sure what i saw near the fuel station, maybe smoke maybe just haze", ReportSource.SOCIAL.value),
]


def _point(bearing: float, distance_m: float) -> tuple[float, float]:
    return offset_point(CENTER[0], CENTER[1], distance_m, bearing)


# --------------------------------------------------------------------------
# Base data
# --------------------------------------------------------------------------
def seed_resources(db: Session) -> int:
    if db.scalar(select(func.count(Resource.id))):
        _reindex(db)
        return 0
    created = 0
    for name, rtype, caps, bearing, distance, speed in FLEET:
        lat, lng = _point(bearing, distance)
        db.add(
            Resource(
                name=name,
                type=rtype,
                status=(
                    ResourceStatus.OUT_OF_SERVICE.value
                    if rtype == ResourceType.SHELTER.value
                    else ResourceStatus.AVAILABLE.value
                ),
                lat=round(lat, 6),
                lng=round(lng, 6),
                home_lat=round(lat, 6),
                home_lng=round(lng, 6),
                capabilities=caps,
                capacity=4 if rtype == ResourceType.AMBULANCE.value else 8,
                speed_kmh=speed,
            )
        )
        created += 1
    db.commit()
    _reindex(db)
    log.info("seeded %d resources", created)
    return created


def seed_users(db: Session) -> int:
    created = 0
    for username, name, role, password in USERS:
        if db.scalar(select(User).where(User.username == username)):
            continue
        user = User(
            username=username,
            name=name,
            role=role,
            hashed_password=hash_password(password),
        )
        unit_name = RESPONDER_UNITS.get(username)
        if unit_name:
            resource = db.scalar(select(Resource).where(Resource.name == unit_name))
            if resource:
                user.resource_id = resource.id
        db.add(user)
        created += 1
    db.commit()
    if created:
        log.info("seeded %d users", created)
    return created


def _reindex(db: Session) -> None:
    """Rebuild the in-process spatial indexes from the database."""
    resource_index.rebuild(
        (r.id, r.lat, r.lng)
        for r in db.scalars(select(Resource).where(Resource.status != ResourceStatus.RETIRED.value)).all()
    )
    incident_index.rebuild(
        (i.id, i.lat, i.lng) for i in db.scalars(select(Incident)).all()
    )


def bootstrap(db: Session) -> None:
    seed_resources(db)
    seed_users(db)
    _reindex(db)


# --------------------------------------------------------------------------
# Scenario burst
# --------------------------------------------------------------------------
async def run_flood_scenario(db: Session, *, stagger_seconds: float = 0.0) -> list[int]:
    """Fire the opening burst of reports through the real intake pipeline."""
    from ..agents import supervisor

    incident_ids: list[int] = []
    for bearing, distance, text, source in FLOOD_BURST:
        lat, lng = _point(bearing + random.uniform(-4, 4), distance * random.uniform(0.95, 1.05))
        _report, incident, _merged, _triage = await supervisor.handle_report(
            db,
            text=text,
            lat=round(lat, 6),
            lng=round(lng, 6),
            source=source,
            reporter=f"@citizen_{random.randint(100, 999)}" if source == ReportSource.SOCIAL.value else "Field intake",
        )
        incident_ids.append(incident.id)
        if stagger_seconds:
            await asyncio.sleep(stagger_seconds)

    log.info("flood scenario seeded: %d reports -> %d incidents", len(FLOOD_BURST), len(set(incident_ids)))
    return incident_ids


def scenario_is_seeded(db: Session) -> bool:
    return bool(db.scalar(select(func.count(Incident.id))))
