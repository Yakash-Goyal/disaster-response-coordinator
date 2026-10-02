"""Resource inventory and admin management (spec 4.4)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents import routing
from ..agents.supervisor import active_closures, record, resource_payload
from ..database import get_db
from ..events import Topic, bus
from ..geo import resource_index
from ..models import Incident, Resource, ResourceStatus, ResourceType, User
from ..schemas import (
    MultiStopRequest,
    ResourceCreate,
    ResourceOut,
    ResourceUpdate,
    RouteOut,
)
from ..security import current_user, require_admin, require_commander

router = APIRouter(prefix="/api/resources", tags=["resources"])


@router.get("", response_model=list[ResourceOut])
def list_resources(
    status_filter: str | None = Query(default=None, alias="status"),
    type_filter: str | None = Query(default=None, alias="type"),
    db: Session = Depends(get_db),
    _user: User = Depends(current_user),
):
    stmt = select(Resource).order_by(Resource.name)
    if status_filter:
        stmt = stmt.where(Resource.status == status_filter)
    else:
        stmt = stmt.where(Resource.status != ResourceStatus.RETIRED.value)
    if type_filter:
        stmt = stmt.where(Resource.type == type_filter)
    return [ResourceOut.model_validate(r) for r in db.scalars(stmt).all()]


@router.get("/{resource_id}", response_model=ResourceOut)
def get_resource(resource_id: int, db: Session = Depends(get_db), _user: User = Depends(current_user)):
    resource = db.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(404, "No unit with that id.")
    return ResourceOut.model_validate(resource)


@router.post("", response_model=ResourceOut, status_code=201)
async def create_resource(
    payload: ResourceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    if db.scalar(select(Resource).where(Resource.name == payload.name)):
        raise HTTPException(409, f"A unit named {payload.name} already exists.")

    resource = Resource(
        name=payload.name,
        type=payload.type,
        lat=payload.lat,
        lng=payload.lng,
        home_lat=payload.lat,
        home_lng=payload.lng,
        capabilities=payload.capabilities,
        capacity=payload.capacity,
        speed_kmh=payload.speed_kmh,
        status=(
            ResourceStatus.OUT_OF_SERVICE.value
            if payload.type == ResourceType.SHELTER.value
            else ResourceStatus.AVAILABLE.value
        ),
    )
    db.add(resource)
    db.commit()
    resource_index.upsert(resource.id, resource.lat, resource.lng)

    record(db, "human", "resource_added", f"{user.username} added {resource.name}.",
           resource_id=resource.id, actor=user.username)
    await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
    return ResourceOut.model_validate(resource)


@router.patch("/{resource_id}", response_model=ResourceOut)
async def update_resource(
    resource_id: int,
    payload: ResourceUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    resource = db.get(Resource, resource_id)
    if resource is None:
        raise HTTPException(404, "No unit with that id.")
    if resource.status == ResourceStatus.RETIRED.value:
        raise HTTPException(409, f"{resource.name} has been retired and cannot be edited.")
    if payload.status == ResourceStatus.RETIRED.value:
        raise HTTPException(422, "Retire a unit with DELETE /api/resources/{id}, not a status change.")

    changes = []
    if payload.name is not None:
        resource.name = payload.name
    if payload.status is not None:
        if payload.status not in {s.value for s in ResourceStatus}:
            raise HTTPException(422, "That is not a recognised unit status.")
        changes.append(f"status {resource.status} -> {payload.status}")
        if payload.status == ResourceStatus.AVAILABLE.value:
            resource.incident_id = None
            resource.route = None
            resource.route_stops = None
            resource.route_progress_m = 0.0
            resource.route_length_m = 0.0
            resource.eta_seconds = None
        resource.status = payload.status
    if payload.capabilities is not None:
        resource.capabilities = payload.capabilities
    if payload.capacity is not None:
        resource.capacity = payload.capacity
    if payload.speed_kmh is not None:
        resource.speed_kmh = payload.speed_kmh
    if payload.lat is not None and payload.lng is not None:
        resource.lat, resource.lng = payload.lat, payload.lng
        resource.home_lat, resource.home_lng = payload.lat, payload.lng
        resource_index.upsert(resource.id, resource.lat, resource.lng)

    db.commit()
    if changes:
        record(db, "human", "resource_updated",
               f"{user.username} updated {resource.name}: {'; '.join(changes)}.",
               resource_id=resource.id, actor=user.username)
    await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
    return ResourceOut.model_validate(resource)


@router.delete("/{resource_id}", status_code=204)
async def retire_resource(
    resource_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Retire a unit. Units on an active job cannot be retired mid-run.

    Retiring is a soft delete: the audit log and past decisions reference the
    unit, and the log is append-only, so the row stays and only its status
    changes. The name is freed so a replacement can be added under it.
    """
    resource = db.get(Resource, resource_id)
    if resource is None or resource.status == ResourceStatus.RETIRED.value:
        raise HTTPException(404, "No unit with that id.")
    if resource.status in (ResourceStatus.EN_ROUTE.value, ResourceStatus.ON_SCENE.value):
        raise HTTPException(
            409,
            f"{resource.name} is {resource.status.replace('_', ' ')} on incident "
            f"#{resource.incident_id}. Release it first.",
        )
    name = resource.name
    resource.status = ResourceStatus.RETIRED.value
    resource.name = f"{name} (retired #{resource.id})"[:80]
    resource.incident_id = None
    resource.route = None
    resource.route_stops = None
    resource.eta_seconds = None
    db.commit()
    resource_index.remove(resource_id)
    record(db, "human", "resource_retired", f"{user.username} retired {name}.",
           resource_id=resource.id, actor=user.username)
    await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))


@router.post("/multi-stop", response_model=RouteOut)
async def plan_multi_stop(
    payload: MultiStopRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_commander),
):
    """Plan one supply run serving several incidents or shelters (spec 4.6)."""
    resource = db.get(Resource, payload.resource_id)
    if resource is None:
        raise HTTPException(404, "No unit with that id.")

    incidents = db.scalars(select(Incident).where(Incident.id.in_(payload.incident_ids))).all()
    if len(incidents) != len(set(payload.incident_ids)):
        raise HTTPException(404, "One or more of those incidents does not exist.")

    stops = [
        {
            "lat": i.lat,
            "lng": i.lng,
            "incident_id": i.id,
            "label": f"#{i.id} {i.type.replace('_', ' ')}",
            "priority": max(i.urgency_score, 1.0) / 50.0,
        }
        for i in incidents
    ]
    route = await routing.get_multi_stop_route(
        (resource.lat, resource.lng),
        stops,
        speed_kmh=resource.speed_kmh or 32.0,
        closures=active_closures(db),
    )

    resource.route = route.geometry
    resource.route_stops = route.stops
    resource.route_progress_m = 0.0
    resource.route_length_m = route.distance_m
    resource.eta_seconds = route.duration_s
    resource.status = ResourceStatus.EN_ROUTE.value
    resource.incident_id = route.stops[0]["incident_id"] if route.stops else None
    db.commit()

    record(
        db,
        "routing",
        "multi_stop_planned",
        f"{user.username} sent {resource.name} on a {len(route.stops)}-stop run "
        f"covering {route.distance_m/1000:.1f} km, total {route.duration_s/60:.0f} min.",
        payload=route.as_dict(),
        resource_id=resource.id,
        actor=user.username,
    )
    await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
    return RouteOut(**route.as_dict())
