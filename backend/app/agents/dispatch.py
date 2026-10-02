"""Dispatch Agent — specification section 4.5.

Given an unresolved incident, evaluate candidate resources by proximity,
capability match and current load, get *real* ETAs for the shortlist from the
Routing Agent rather than assuming nearest equals best, and return a ranked
recommendation with a plain-language rationale.

The agent never assigns anything. It produces a recommendation object; the
Supervisor decides whether it goes to a commander for approval, and only a
human approval actually moves a vehicle.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..geo import find_nearby, haversine_m
from ..models import Incident, IncidentType, Resource, ResourceStatus, ResourceType
from . import llm, routing

log = logging.getLogger("drc.dispatch")

# Which resource types can meaningfully serve which incident types.
TYPE_AFFINITY: dict[str, dict[str, float]] = {
    IncidentType.MEDICAL.value: {"ambulance": 1.0, "personnel": 0.45, "fire_engine": 0.35},
    IncidentType.FIRE.value: {"fire_engine": 1.0, "ambulance": 0.4, "personnel": 0.3},
    IncidentType.STRUCTURAL_COLLAPSE.value: {"fire_engine": 0.9, "personnel": 0.8, "ambulance": 0.6},
    IncidentType.FLOOD.value: {"personnel": 0.9, "supply_truck": 0.8, "fire_engine": 0.5},
    IncidentType.RESCUE.value: {"personnel": 1.0, "fire_engine": 0.8, "ambulance": 0.5},
    IncidentType.HAZMAT.value: {"fire_engine": 1.0, "personnel": 0.5},
    IncidentType.POWER_OUTAGE.value: {"personnel": 0.9, "supply_truck": 0.6},
    IncidentType.ROAD_BLOCKED.value: {"personnel": 0.8, "supply_truck": 0.7, "fire_engine": 0.6},
    IncidentType.OTHER.value: {"personnel": 0.7, "ambulance": 0.5, "supply_truck": 0.5, "fire_engine": 0.5},
}


@dataclass
class Candidate:
    resource: Resource
    straight_distance_m: float
    capability_score: float
    affinity: float
    load_penalty: float
    route: routing.Route | None = None
    eta_seconds: float | None = None
    road_distance_m: float | None = None
    score: float = 0.0
    notes: list[str] = field(default_factory=list)

    def to_payload(self) -> dict:
        return {
            "resource_id": self.resource.id,
            "resource_name": self.resource.name,
            "resource_type": self.resource.type,
            "capabilities": list(self.resource.capabilities or []),
            "straight_distance_m": round(self.straight_distance_m, 1),
            "road_distance_m": round(self.road_distance_m, 1) if self.road_distance_m else None,
            "eta_seconds": round(self.eta_seconds, 1) if self.eta_seconds else None,
            "capability_match": round(self.capability_score, 3),
            "type_affinity": round(self.affinity, 3),
            "score": round(self.score, 4),
            "routed": self.route is not None,
            "detoured": bool(self.route and self.route.detoured),
            "notes": self.notes,
        }


@dataclass
class Recommendation:
    incident_id: int
    best: Candidate | None
    alternatives: list[Candidate]
    rationale: str
    confidence: float
    reason_no_candidate: str | None = None
    rationale_source: str = "template"

    @property
    def has_recommendation(self) -> bool:
        return self.best is not None


# --------------------------------------------------------------------------
# Scoring
# --------------------------------------------------------------------------
def capability_match(required: list[str], available: list[str]) -> tuple[float, list[str]]:
    if not required:
        return 1.0, []
    have = {c.lower() for c in (available or [])}
    need = [c.lower() for c in required]
    hits = [c for c in need if c in have]
    missing = [c for c in need if c not in have]
    return len(hits) / len(need), missing


def _load_penalty(db: Session, resource: Resource) -> float:
    """Resources that have been running all shift are less attractive than
    fresh ones when everything else is equal."""
    if resource.status != ResourceStatus.AVAILABLE.value:
        return 1.0
    fatigue = min(resource.missions_completed * 0.04, 0.25)
    return fatigue


def gather_candidates(db: Session, incident: Incident, exclude: set[int] | None = None) -> list[Candidate]:
    """Spatial shortlist. Uses the indexed proximity search (PostGIS or the
    in-process grid) — never a full-table distance loop. `exclude` holds units
    a commander has already rejected for this incident."""
    nearby = find_nearby(
        db,
        "resources",
        incident.lat,
        incident.lng,
        settings.CANDIDATE_SEARCH_RADIUS_M,
        limit=settings.CANDIDATE_POOL * 4,
    )
    if not nearby:
        return []

    ids = [rid for rid, _ in nearby]
    distance_by_id = dict(nearby)
    rows = db.scalars(select(Resource).where(Resource.id.in_(ids))).all()

    affinities = TYPE_AFFINITY.get(incident.type, TYPE_AFFINITY[IncidentType.OTHER.value])
    required = list(incident.required_capabilities or [])

    candidates: list[Candidate] = []
    for resource in rows:
        if resource.type == ResourceType.SHELTER.value:
            continue  # shelters are destinations, not dispatchable units
        if resource.status != ResourceStatus.AVAILABLE.value:
            continue
        if exclude and resource.id in exclude:
            continue
        affinity = affinities.get(resource.type, 0.25)
        if affinity < 0.2:
            continue

        cap_score, missing = capability_match(required, resource.capabilities or [])
        notes = []
        if missing:
            notes.append(f"missing {', '.join(missing)}")

        candidate = Candidate(
            resource=resource,
            straight_distance_m=distance_by_id.get(resource.id)
            or haversine_m(incident.lat, incident.lng, resource.lat, resource.lng),
            capability_score=cap_score,
            affinity=affinity,
            load_penalty=_load_penalty(db, resource),
            notes=notes,
        )
        candidates.append(candidate)

    # Pre-rank on cheap signals so we only pay for routing on the shortlist.
    for c in candidates:
        proximity = 1.0 / (1.0 + c.straight_distance_m / 1500.0)
        c.score = 0.5 * proximity + 0.3 * c.capability_score + 0.2 * c.affinity - c.load_penalty
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates[: settings.CANDIDATE_POOL]


async def score_with_routes(candidates: list[Candidate], incident: Incident, closures: list[dict]) -> list[Candidate]:
    """Get true road ETAs for the top candidates, then re-rank.

    This is the step that stops "nearest" from silently winning: a unit 400 m
    closer across a blocked bridge can easily be five minutes further away.
    """
    shortlist = candidates[: settings.ROUTED_CANDIDATES]
    if shortlist:
        pairs = [
            ((c.resource.lat, c.resource.lng), (incident.lat, incident.lng),
             c.resource.speed_kmh or routing.DEFAULT_SPEEDS.get(c.resource.type, 40.0))
            for c in shortlist
        ]
        routes = await routing.batch_routes(pairs, closures=closures)
        for candidate, route in zip(shortlist, routes):
            candidate.route = route
            candidate.eta_seconds = route.duration_s
            candidate.road_distance_m = route.distance_m
            if route.detoured:
                candidate.notes.append("route detours around a reported closure")

    # Unrouted candidates get an estimated ETA so ranking stays comparable.
    for candidate in candidates:
        if candidate.eta_seconds is None:
            speed = candidate.resource.speed_kmh or 40.0
            candidate.eta_seconds = (
                candidate.straight_distance_m * settings.ROAD_FACTOR / (speed * 1000 / 3600) + 45.0
            )
            candidate.road_distance_m = candidate.straight_distance_m * settings.ROAD_FACTOR
            candidate.notes.append("ETA estimated, not routed")

    fastest = min((c.eta_seconds for c in candidates if c.eta_seconds), default=1.0) or 1.0
    for c in candidates:
        eta_score = fastest / max(c.eta_seconds, 1.0)  # 1.0 for the fastest unit
        c.score = round(
            0.52 * eta_score + 0.28 * c.capability_score + 0.20 * c.affinity - c.load_penalty, 4
        )
    candidates.sort(key=lambda c: c.score, reverse=True)
    return candidates


# --------------------------------------------------------------------------
# Rationale (NFR: Explainability)
# --------------------------------------------------------------------------
def _fmt_minutes(seconds: float | None) -> str:
    if not seconds:
        return "unknown"
    minutes = seconds / 60
    return f"{minutes:.0f} min" if minutes >= 1 else f"{seconds:.0f} s"


def template_rationale(incident: Incident, best: Candidate, alternatives: list[Candidate]) -> str:
    parts = [
        f"{best.resource.name} recommended for incident #{incident.id} "
        f"({incident.type.replace('_', ' ')}, severity {incident.severity})."
    ]
    parts.append(
        f"ETA {_fmt_minutes(best.eta_seconds)} over "
        f"{(best.road_distance_m or 0) / 1000:.1f} km of road."
    )

    if alternatives:
        runner = alternatives[0]
        gap = (runner.eta_seconds or 0) - (best.eta_seconds or 0)
        if gap > 30:
            parts.append(
                f"That is {_fmt_minutes(gap)} faster than the next option, {runner.resource.name}."
            )
        elif best.capability_score > runner.capability_score:
            parts.append(
                f"{runner.resource.name} would arrive at a similar time but lacks "
                f"{', '.join(set(incident.required_capabilities or []) - set(runner.resource.capabilities or [])) or 'required equipment'}."
            )
        else:
            parts.append(f"Marginal call — {runner.resource.name} is a close second.")

    required = list(incident.required_capabilities or [])
    if required:
        have = [c for c in required if c in (best.resource.capabilities or [])]
        if len(have) == len(required):
            parts.append(f"Carries all required equipment ({', '.join(required)}).")
        elif have:
            parts.append(f"Carries {', '.join(have)}; missing {', '.join(set(required) - set(have))}.")
        else:
            parts.append(f"Does not carry {', '.join(required)} — confirm before dispatch.")

    if best.route and best.route.detoured:
        parts.append("Route detours around an active road closure.")
    if best.route and best.route.provider == "estimator":
        parts.append("ETA from the offline estimator; no live routing service configured.")

    return " ".join(parts)


RATIONALE_SYSTEM = """You are the Dispatch Agent in a disaster response command system.
Explain, to a human incident commander who has three seconds to read it, why one
unit was recommended over the others. Use the numbers you are given and no
others. Two or three sentences, plain language, no bullet points, no preamble.
Never claim certainty the data does not support. Return only the explanation text."""


async def llm_rationale(incident: Incident, best: Candidate, alternatives: list[Candidate]) -> str | None:
    lines = [
        f"Incident #{incident.id}: {incident.type} severity {incident.severity}, "
        f"{incident.report_count} corroborating report(s).",
        f"Summary: {incident.summary}",
        f"Required capabilities: {', '.join(incident.required_capabilities or []) or 'none specified'}",
        "",
        "Recommended unit:",
        f"  {best.resource.name} ({best.resource.type}) — ETA {_fmt_minutes(best.eta_seconds)}, "
        f"{(best.road_distance_m or 0)/1000:.1f} km, carries {', '.join(best.resource.capabilities or []) or 'no special equipment'}",
    ]
    if alternatives:
        lines.append("Alternatives considered:")
        for alt in alternatives[:3]:
            lines.append(
                f"  {alt.resource.name} ({alt.resource.type}) — ETA {_fmt_minutes(alt.eta_seconds)}, "
                f"{(alt.road_distance_m or 0)/1000:.1f} km, carries "
                f"{', '.join(alt.resource.capabilities or []) or 'no special equipment'}"
            )
    return await llm.try_text(RATIONALE_SYSTEM, "\n".join(lines), max_tokens=220)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
def _confidence(best: Candidate, alternatives: list[Candidate]) -> float:
    """How sure is the agent that this is the right unit? High when the margin
    over the runner-up is large and capability match is complete."""
    base = 0.45 + 0.35 * best.capability_score + 0.1 * best.affinity
    if alternatives:
        runner = alternatives[0]
        margin = (best.score - runner.score) / max(abs(best.score), 0.01)
        base += max(min(margin, 0.5), -0.2) * 0.3
    else:
        base += 0.05
    if best.route is None:
        base -= 0.08
    return round(max(0.05, min(base, 0.97)), 3)


async def recommend(
    db: Session,
    incident: Incident,
    closures: list[dict] | None = None,
    exclude: set[int] | None = None,
) -> Recommendation:
    closures = closures or []
    candidates = gather_candidates(db, incident, exclude)

    if not candidates and exclude:
        return Recommendation(
            incident_id=incident.id,
            best=None,
            alternatives=[],
            rationale="",
            confidence=0.0,
            reason_no_candidate=(
                f"No other suitable unit is available, and you rejected {len(exclude)} "
                f"unit(s) for incident #{incident.id}. Override with a specific unit, "
                "or ask for a fresh recommendation to reconsider them."
            ),
        )

    if not candidates:
        return Recommendation(
            incident_id=incident.id,
            best=None,
            alternatives=[],
            rationale="",
            confidence=0.0,
            reason_no_candidate=(
                f"No available unit within {settings.CANDIDATE_SEARCH_RADIUS_M/1000:.0f} km "
                f"suited to a {incident.type.replace('_', ' ')} incident. "
                "Free up a unit or widen the search radius."
            ),
        )

    candidates = await score_with_routes(candidates, incident, closures)
    best, alternatives = candidates[0], candidates[1:4]

    rationale = await llm_rationale(incident, best, alternatives)
    source = "llm"
    if not rationale:
        rationale = template_rationale(incident, best, alternatives)
        source = "template"

    return Recommendation(
        incident_id=incident.id,
        best=best,
        alternatives=alternatives,
        rationale=rationale,
        confidence=_confidence(best, alternatives),
        rationale_source=source,
    )
