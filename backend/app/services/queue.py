"""Incident Queue & Prioritisation — specification section 4.3.

Urgency is recomputed continuously rather than fixed at intake, so an incident
that nobody has answered climbs the queue on its own. That aging term is the
part commanders actually feel: without it, a severity-3 report filed forty
minutes ago sits forever underneath a stream of fresh severity-4s.

    urgency = severity_weight
            + corroboration_bonus     (more independent reports = more real)
            + age_bonus               (unaddressed time, capped)
            + type_weight
            - progress_discount       (already being worked)

A commander-set `manual_priority` overrides the computed value entirely.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Incident, IncidentStatus, IncidentType

SEVERITY_WEIGHT = {1: 8.0, 2: 20.0, 3: 38.0, 4: 58.0, 5: 74.0}

TYPE_WEIGHT = {
    IncidentType.MEDICAL.value: 8.0,
    IncidentType.STRUCTURAL_COLLAPSE.value: 8.0,
    IncidentType.RESCUE.value: 7.0,
    IncidentType.FIRE.value: 7.0,
    IncidentType.HAZMAT.value: 6.0,
    IncidentType.FLOOD.value: 4.0,
    IncidentType.POWER_OUTAGE.value: 2.0,
    IncidentType.ROAD_BLOCKED.value: 2.0,
    IncidentType.OTHER.value: 0.0,
}

PROGRESS_DISCOUNT = {
    IncidentStatus.PENDING.value: 0.0,
    IncidentStatus.AWAITING_APPROVAL.value: 0.0,
    IncidentStatus.ASSIGNED.value: 6.0,
    IncidentStatus.EN_ROUTE.value: 12.0,
    IncidentStatus.ON_SCENE.value: 22.0,
    IncidentStatus.RESOLVED.value: 100.0,
    IncidentStatus.DISMISSED.value: 100.0,
}

OPEN_STATES = (
    IncidentStatus.PENDING.value,
    IncidentStatus.AWAITING_APPROVAL.value,
    IncidentStatus.ASSIGNED.value,
    IncidentStatus.EN_ROUTE.value,
    IncidentStatus.ON_SCENE.value,
)


def _age_minutes(incident: Incident, now: datetime) -> float:
    created = incident.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max((now - created).total_seconds() / 60.0, 0.0)


def compute_urgency(incident: Incident, now: datetime | None = None) -> float:
    if incident.manual_priority is not None:
        return round(max(0.0, min(100.0, incident.manual_priority)), 2)

    now = now or datetime.now(timezone.utc)
    score = SEVERITY_WEIGHT.get(incident.severity, 30.0)
    score += TYPE_WEIGHT.get(incident.type, 0.0)

    # Corroboration: logarithmic, so the 12th duplicate report adds far less
    # than the 2nd. Ten callers means it is real, not ten times worse.
    if incident.report_count > 1:
        score += min(9.0 * math.log(incident.report_count, 3), 14.0)

    # Aging applies only while nobody is on scene.
    if incident.status in (IncidentStatus.PENDING.value, IncidentStatus.AWAITING_APPROVAL.value):
        score += min(_age_minutes(incident, now) * settings.AGE_URGENCY_PER_MIN, settings.AGE_URGENCY_CAP)

    score -= PROGRESS_DISCOUNT.get(incident.status, 0.0)

    if incident.needs_review:
        score += 3.0  # unclear reports deserve a look, not burial

    return round(max(0.0, min(100.0, score)), 2)


def refresh_queue(db: Session, *, commit: bool = True) -> list[Incident]:
    """Recompute urgency for every open incident and return them ranked."""
    now = datetime.now(timezone.utc)
    incidents = db.scalars(select(Incident).where(Incident.status.in_(OPEN_STATES))).all()
    changed = False
    for incident in incidents:
        new_score = compute_urgency(incident, now)
        if abs(new_score - (incident.urgency_score or 0.0)) > 0.01:
            incident.urgency_score = new_score
            changed = True
    if changed and commit:
        db.commit()
    return sorted(incidents, key=lambda i: i.urgency_score, reverse=True)


def ranked_queue(db: Session, limit: int | None = None) -> list[Incident]:
    incidents = db.scalars(
        select(Incident)
        .where(Incident.status.in_(OPEN_STATES))
        .order_by(Incident.urgency_score.desc(), Incident.created_at.asc())
    ).all()
    return incidents[:limit] if limit else incidents


def unassigned(db: Session) -> list[Incident]:
    """Incidents that still need a dispatch decision, most urgent first."""
    incidents = db.scalars(
        select(Incident)
        .where(Incident.status == IncidentStatus.PENDING.value)
        .order_by(Incident.urgency_score.desc(), Incident.created_at.asc())
    ).all()
    return incidents


def merge_incidents(db: Session, source: Incident, target: Incident) -> Incident:
    """Fold `source` into `target`, moving its reports across."""
    if source.id == target.id:
        raise ValueError("An incident cannot be merged into itself.")

    for report in list(source.reports):
        report.incident_id = target.id

    target.report_count = (target.report_count or 0) + (source.report_count or 0)
    target.severity = max(target.severity, source.severity)
    if source.required_capabilities:
        target.required_capabilities = sorted(
            set(target.required_capabilities or []) | set(source.required_capabilities)
        )
    source.status = IncidentStatus.DISMISSED.value
    source.merged_into_id = target.id
    source.resolved_at = datetime.now(timezone.utc)
    source.urgency_score = 0.0
    target.urgency_score = compute_urgency(target)
    db.commit()
    return target


def split_incident(db: Session, incident: Incident, report_ids: list[int]) -> Incident:
    """Pull selected reports out into a new incident."""
    from ..models import Report

    reports = [r for r in incident.reports if r.id in set(report_ids)]
    if not reports:
        raise ValueError("None of those reports belong to this incident.")
    if len(reports) >= len(incident.reports):
        raise ValueError("Splitting off every report would leave the original empty.")

    anchor = reports[0]
    new_incident = Incident(
        type=incident.type,
        severity=incident.severity,
        status=IncidentStatus.PENDING.value,
        summary=anchor.text[:200],
        lat=anchor.lat,
        lng=anchor.lng,
        address=anchor.address,
        report_count=len(reports),
        triage_confidence=incident.triage_confidence,
        needs_review=True,  # a human just said the machine grouped these wrong
        triage_source="human_split",
        required_capabilities=list(incident.required_capabilities or []),
    )
    db.add(new_incident)
    db.flush()

    for report in reports:
        report.incident_id = new_incident.id

    incident.report_count = max(1, (incident.report_count or 1) - len(reports))
    incident.urgency_score = compute_urgency(incident)
    new_incident.urgency_score = compute_urgency(new_incident)
    db.commit()
    return new_incident
