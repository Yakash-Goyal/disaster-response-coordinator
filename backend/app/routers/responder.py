"""Responder View endpoints — specification section 4.9.

A field responder's device only ever asks two questions: what am I on, and how
do I get there. Status changes push straight back to the dashboard and the
Supervisor's log.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..agents.supervisor import incident_payload, record, resource_payload
from ..database import get_db
from ..events import Topic, bus
from ..models import Incident, IncidentStatus, Resource, ResourceStatus, User
from ..schemas import IncidentOut, ResourceOut, ResponderStatusUpdate, ResponderTask
from ..security import current_user
from ..services import queue
from ..services.simulation import simulation

router = APIRouter(prefix="/api/responder", tags=["responder"])


def _my_unit(db: Session, user: User) -> Resource:
    if user.resource_id is None:
        raise HTTPException(409, "Your account is not linked to a unit. Ask an admin to link one.")
    resource = db.get(Resource, user.resource_id)
    if resource is None or resource.status == ResourceStatus.RETIRED.value:
        raise HTTPException(404, "The unit linked to your account has been retired. Ask an admin to link another.")
    return resource


@router.get("/task", response_model=ResponderTask)
def my_task(db: Session = Depends(get_db), user: User = Depends(current_user)):
    resource = _my_unit(db, user)
    incident = db.get(Incident, resource.incident_id) if resource.incident_id else None

    if incident is None:
        instructions = "No active assignment. Stand by at your current position."
    else:
        where = incident.address or f"{incident.lat:.4f}, {incident.lng:.4f}"
        instructions = (
            f"{incident.type.replace('_', ' ').title()}, severity {incident.severity}. "
            f"Proceed to {where}. {incident.summary}"
        )
        if incident.required_capabilities:
            instructions += f" Bring: {', '.join(incident.required_capabilities)}."

    return ResponderTask(
        resource=ResourceOut.model_validate(resource),
        incident=IncidentOut.model_validate(incident) if incident else None,
        route=resource.route,
        eta_seconds=resource.eta_seconds,
        instructions=instructions,
    )


@router.post("/status", response_model=ResponderTask)
async def update_status(
    payload: ResponderStatusUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """en route -> on scene -> resolved, pushed live to the command dashboard."""
    resource = _my_unit(db, user)
    incident = db.get(Incident, resource.incident_id) if resource.incident_id else None
    now = datetime.now(timezone.utc)
    detail = ""

    if payload.status == "en_route":
        if incident is None:
            raise HTTPException(409, "You have no assignment to be en route to.")
        resource.status = ResourceStatus.EN_ROUTE.value
        incident.status = IncidentStatus.EN_ROUTE.value
        detail = f"{user.name} confirmed en route to incident #{incident.id}."

    elif payload.status == "on_scene":
        if incident is None:
            raise HTTPException(409, "You have no assignment to arrive at.")
        resource.status = ResourceStatus.ON_SCENE.value
        resource.eta_seconds = 0.0
        resource.route_progress_m = resource.route_length_m or 0.0
        incident.status = IncidentStatus.ON_SCENE.value
        if incident.on_scene_at is None:
            incident.on_scene_at = now
        detail = f"{user.name} is on scene at incident #{incident.id}."

    elif payload.status == "resolved":
        if incident is None:
            raise HTTPException(409, "You have no assignment to resolve.")
        incident.status = IncidentStatus.RESOLVED.value
        incident.resolved_at = now
        incident.urgency_score = 0.0
        resource.missions_completed += 1
        detail = f"{user.name} reported incident #{incident.id} resolved."

    elif payload.status == "out_of_service":
        resource.status = ResourceStatus.OUT_OF_SERVICE.value
        detail = f"{user.name} marked {resource.name} out of service."

    else:  # available
        resource.status = ResourceStatus.AVAILABLE.value
        resource.incident_id = None
        resource.route = None
        resource.route_progress_m = 0.0
        resource.route_length_m = 0.0
        resource.eta_seconds = None
        detail = f"{user.name} marked {resource.name} available."

    if payload.note:
        detail += f" Note: {payload.note}"
    if incident is not None:
        incident.urgency_score = queue.compute_urgency(incident)
    db.commit()

    record(
        db,
        "responder",
        f"status_{payload.status}",
        detail,
        incident_id=incident.id if incident else None,
        resource_id=resource.id,
        actor=user.username,
    )

    if payload.status == "resolved" and incident is not None:
        await simulation.send_home(db, resource)

    await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
    if incident is not None:
        topic = Topic.INCIDENT_RESOLVED if payload.status == "resolved" else Topic.INCIDENT_UPDATED
        await bus.publish(topic, incident_payload(incident))
        await bus.publish(
            Topic.ALERT,
            {
                "level": "info",
                "title": f"{resource.name}: {payload.status.replace('_', ' ')}",
                "message": detail,
                "incident_id": incident.id,
            },
            roles={"commander", "admin"},
        )

    db.refresh(resource)
    return my_task(db=db, user=user)
