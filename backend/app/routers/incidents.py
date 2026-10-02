"""Report intake and incident queue endpoints (spec 4.1, 4.3)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.supervisor import incident_payload, record
from ..database import get_db
from ..events import Topic, bus
from ..geo import incident_index
from ..models import (
    HumanAction,
    Incident,
    IncidentStatus,
    IncidentType,
    Report,
    Resource,
    ResourceStatus,
    User,
)
from ..schemas import (
    IncidentDetail,
    IncidentOut,
    IncidentUpdate,
    MergeRequest,
    ReportCreate,
    ReportIngestResult,
    ReportOut,
    SplitRequest,
)
from ..security import current_user, require_commander
from ..services import queue
from ..services.simulation import simulation

reports_router = APIRouter(prefix="/api/reports", tags=["reports"])
router = APIRouter(prefix="/api/incidents", tags=["incidents"])


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------
@reports_router.post("", response_model=ReportIngestResult, status_code=201)
async def create_report(
    payload: ReportCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Manual intake — the same pipeline the social and weather feeds use."""
    from ..agents import supervisor

    report, incident, merged, triage = await supervisor.handle_report(
        db,
        text=payload.text,
        lat=payload.lat,
        lng=payload.lng,
        source=payload.source,
        address=payload.address,
        reporter=payload.reporter or user.name,
        image_url=payload.image_url,
    )
    return ReportIngestResult(
        report=ReportOut.model_validate(report),
        incident_id=incident.id,
        merged=merged,
        triage=triage.as_dict(),
    )


@reports_router.get("", response_model=list[ReportOut])
def list_reports(
    limit: int = Query(100, le=500),
    incident_id: int | None = None,
    source: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    stmt = select(Report).order_by(Report.created_at.desc()).limit(limit)
    if incident_id is not None:
        stmt = stmt.where(Report.incident_id == incident_id)
    if source:
        stmt = stmt.where(Report.source == source)
    return [ReportOut.model_validate(r) for r in db.scalars(stmt).all()]


# --------------------------------------------------------------------------
# Incident queue
# --------------------------------------------------------------------------
@router.get("", response_model=list[IncidentOut])
def list_incidents(
    status_filter: str | None = Query(default=None, alias="status"),
    open_only: bool = True,
    limit: int = Query(200, le=500),
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    """The live queue, ranked by urgency (section 4.3)."""
    if status_filter:
        rows = db.scalars(
            select(Incident)
            .where(Incident.status == status_filter)
            .order_by(Incident.urgency_score.desc())
            .limit(limit)
        ).all()
    elif open_only:
        rows = queue.ranked_queue(db, limit)
    else:
        rows = db.scalars(
            select(Incident).order_by(Incident.urgency_score.desc(), Incident.created_at.desc()).limit(limit)
        ).all()
    return [IncidentOut.model_validate(i) for i in rows]


@router.get("/{incident_id}", response_model=IncidentDetail)
def get_incident(incident_id: int, db: Session = Depends(get_db), _user: User = Depends(current_user)):
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(404, "No incident with that id.")
    detail = IncidentDetail.model_validate(incident)
    detail.reports = [ReportOut.model_validate(r) for r in incident.reports]
    from ..schemas import DecisionOut, ResourceOut

    detail.decisions = [DecisionOut.model_validate(d) for d in incident.decisions]
    detail.assigned_resources = [ResourceOut.model_validate(r) for r in incident.resources]
    return detail


@router.patch("/{incident_id}", response_model=IncidentOut)
async def update_incident(
    incident_id: int,
    payload: IncidentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Commander override of the agent's classification or priority."""
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(404, "No incident with that id.")

    changes: list[str] = []
    if payload.type is not None:
        if payload.type not in {t.value for t in IncidentType}:
            raise HTTPException(422, "That is not a recognised incident type.")
        if payload.type != incident.type:
            changes.append(f"type {incident.type} -> {payload.type}")
            incident.type = payload.type
            incident.triage_source = "human"
    if payload.severity is not None and payload.severity != incident.severity:
        changes.append(f"severity {incident.severity} -> {payload.severity}")
        incident.severity = payload.severity
    if payload.summary is not None:
        incident.summary = payload.summary[:400]
    if payload.manual_priority is not None:
        changes.append(f"priority pinned to {payload.manual_priority}")
        incident.manual_priority = payload.manual_priority
    if payload.needs_review is not None:
        incident.needs_review = payload.needs_review
        if not payload.needs_review:
            changes.append("classification confirmed")
    if payload.status is not None:
        if payload.status not in {s.value for s in IncidentStatus}:
            raise HTTPException(422, "That is not a recognised status.")
        changes.append(f"status {incident.status} -> {payload.status}")
        incident.status = payload.status
        if payload.status == IncidentStatus.RESOLVED.value and incident.resolved_at is None:
            incident.resolved_at = datetime.now(timezone.utc)

    incident.urgency_score = queue.compute_urgency(incident)
    incident.updated_at = datetime.now(timezone.utc)
    db.commit()

    if changes:
        record(
            db,
            "human",
            "incident_edited",
            f"{user.username} changed incident #{incident.id}: {'; '.join(changes)}.",
            incident_id=incident.id,
            actor=user.username,
        )
    await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(incident))
    return IncidentOut.model_validate(incident)


@router.post("/{incident_id}/resolve", response_model=IncidentOut)
async def resolve_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Close an incident and release the units working it."""
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(404, "No incident with that id.")
    if incident.status == IncidentStatus.RESOLVED.value:
        raise HTTPException(409, "That incident is already resolved.")

    incident.status = IncidentStatus.RESOLVED.value
    incident.resolved_at = datetime.now(timezone.utc)
    incident.urgency_score = 0.0

    released = []
    for resource in list(incident.resources):
        resource.missions_completed += 1
        released.append(resource)
    db.commit()

    for resource in released:
        await simulation.send_home(db, resource)

    record(
        db,
        "human",
        "incident_resolved",
        f"{user.username} resolved incident #{incident.id}; "
        f"{len(released)} unit(s) released and returning to base.",
        incident_id=incident.id,
        actor=user.username,
    )
    await bus.publish(Topic.INCIDENT_RESOLVED, incident_payload(incident))
    return IncidentOut.model_validate(incident)


@router.post("/merge", response_model=IncidentOut)
async def merge(
    payload: MergeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    source = db.get(Incident, payload.source_incident_id)
    target = db.get(Incident, payload.target_incident_id)
    if source is None or target is None:
        raise HTTPException(404, "One of those incidents does not exist.")
    try:
        merged = queue.merge_incidents(db, source, target)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    record(
        db,
        "human",
        "incidents_merged",
        f"{user.username} merged incident #{source.id} into #{target.id}; "
        f"{merged.report_count} reports now describe one event.",
        incident_id=target.id,
        actor=user.username,
    )
    await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(merged))
    await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(source))
    return IncidentOut.model_validate(merged)


@router.post("/{incident_id}/split", response_model=IncidentOut, status_code=201)
async def split(
    incident_id: int,
    payload: SplitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(404, "No incident with that id.")
    try:
        new_incident = queue.split_incident(db, incident, payload.report_ids)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc

    incident_index.upsert(new_incident.id, new_incident.lat, new_incident.lng)
    record(
        db,
        "human",
        "incident_split",
        f"{user.username} split {len(payload.report_ids)} report(s) out of "
        f"incident #{incident.id} into new incident #{new_incident.id}.",
        incident_id=new_incident.id,
        actor=user.username,
    )
    await bus.publish(Topic.INCIDENT_CREATED, incident_payload(new_incident))
    await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(incident))
    return IncidentOut.model_validate(new_incident)
