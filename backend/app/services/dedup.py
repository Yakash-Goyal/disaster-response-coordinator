"""Report deduplication — specification section 4.1.

Ten people phoning in the same collapsed building should produce one incident
with a report count of ten, not ten incidents competing for ten ambulances.
The report count then becomes a corroboration signal that feeds urgency.

Matching rule: an open incident within `DEDUP_RADIUS_M` metres, created within
`DEDUP_WINDOW_S` seconds, whose type is compatible with the new report's
classification. Text similarity is used as a tie-breaker when several incidents
are in range.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..geo import find_nearby, haversine_m
from ..models import Incident, IncidentStatus, IncidentType

_WORD = re.compile(r"[a-z']+")
_STOP = {
    "the", "a", "an", "is", "are", "at", "on", "in", "of", "and", "to", "for",
    "with", "there", "here", "we", "i", "it", "this", "that", "near", "by",
    "some", "has", "have", "been", "was", "were", "from",
}

# Types that plausibly describe the same underlying event.
COMPATIBLE: dict[str, set[str]] = {
    IncidentType.FLOOD.value: {IncidentType.FLOOD.value, IncidentType.RESCUE.value, IncidentType.ROAD_BLOCKED.value},
    IncidentType.RESCUE.value: {IncidentType.RESCUE.value, IncidentType.FLOOD.value, IncidentType.STRUCTURAL_COLLAPSE.value},
    IncidentType.FIRE.value: {IncidentType.FIRE.value, IncidentType.HAZMAT.value, IncidentType.MEDICAL.value},
    IncidentType.STRUCTURAL_COLLAPSE.value: {IncidentType.STRUCTURAL_COLLAPSE.value, IncidentType.RESCUE.value, IncidentType.MEDICAL.value},
    IncidentType.MEDICAL.value: {IncidentType.MEDICAL.value},
    IncidentType.HAZMAT.value: {IncidentType.HAZMAT.value, IncidentType.FIRE.value},
    IncidentType.POWER_OUTAGE.value: {IncidentType.POWER_OUTAGE.value},
    IncidentType.ROAD_BLOCKED.value: {IncidentType.ROAD_BLOCKED.value, IncidentType.FLOOD.value},
    IncidentType.OTHER.value: {IncidentType.OTHER.value},
}


def tokenise(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 2}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def find_duplicate(
    db: Session,
    lat: float,
    lng: float,
    text: str,
    incident_type: str,
    *,
    radius_m: float | None = None,
    window_s: float | None = None,
) -> tuple[Incident | None, float]:
    """Return the incident this report belongs to, plus a match score."""
    radius = radius_m if radius_m is not None else settings.DEDUP_RADIUS_M
    window = window_s if window_s is not None else settings.DEDUP_WINDOW_S
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window)

    nearby = find_nearby(db, "incidents", lat, lng, radius, limit=25)
    if not nearby:
        return None, 0.0

    ids = [i for i, _ in nearby]
    distances = dict(nearby)
    open_states = (IncidentStatus.RESOLVED.value, IncidentStatus.DISMISSED.value)
    incidents = db.scalars(
        select(Incident).where(Incident.id.in_(ids), Incident.status.notin_(open_states))
    ).all()

    compatible = COMPATIBLE.get(incident_type, {incident_type})
    tokens = tokenise(text)

    best: Incident | None = None
    best_score = 0.0

    for incident in incidents:
        created = incident.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if created < cutoff:
            continue
        if incident.type not in compatible and incident_type != IncidentType.OTHER.value:
            continue

        distance = distances.get(incident.id) or haversine_m(lat, lng, incident.lat, incident.lng)
        if distance > radius:
            continue

        proximity = 1.0 - (distance / radius)
        similarity = jaccard(tokens, tokenise(incident.summary))
        type_bonus = 0.25 if incident.type == incident_type else 0.0
        score = 0.55 * proximity + 0.25 * similarity + type_bonus

        if score > best_score:
            best, best_score = incident, score

    # Require reasonable confidence before collapsing two reports together —
    # a false merge hides a real incident, which is worse than a duplicate.
    if best is not None and best_score >= 0.45:
        return best, round(best_score, 3)
    return None, round(best_score, 3)
