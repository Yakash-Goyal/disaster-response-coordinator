"""Vehicle Simulation Layer — specification section 4.10.

No real fleet exists, so this loop advances every en-route unit along its
assigned polyline and publishes position updates over WebSockets. Speed is
configurable (`SIM_SPEED_MULTIPLIER`) so a demo can compress a 12-minute drive
into under a minute without changing any other component: everything upstream
sees ordinary GPS pings.

The loop also handles arrival — flipping the unit to on-scene, stamping the
incident timing used by the after-action analytics, and sending crews home once
an incident is resolved.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from ..config import settings
from ..database import SessionLocal
from ..events import Topic, bus
from ..geo import haversine_m, point_at_distance, resource_index
from ..models import Incident, IncidentStatus, Resource, ResourceStatus
from ..services import queue

log = logging.getLogger("drc.sim")


class SimulationEngine:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False
        self.tick_count = 0

    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._loop(), name="drc-simulation")
            log.info("vehicle simulation started (%.1fx speed)", settings.SIM_SPEED_MULTIPLIER)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(settings.SIM_TICK_SECONDS)
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("simulation tick failed")

    async def tick(self) -> None:
        self.tick_count += 1
        db = SessionLocal()
        try:
            moving = db.scalars(
                select(Resource).where(
                    Resource.status.in_(
                        [ResourceStatus.EN_ROUTE.value, ResourceStatus.RETURNING.value]
                    )
                )
            ).all()
            if not moving:
                return

            arrivals: list[tuple[Resource, Incident | None]] = []
            moved: list[Resource] = []

            for resource in moving:
                if not resource.route or len(resource.route) < 2:
                    continue

                speed_ms = (resource.speed_kmh or 40.0) * 1000 / 3600
                step = speed_ms * settings.SIM_TICK_SECONDS * settings.SIM_SPEED_MULTIPLIER
                resource.route_progress_m = min(
                    resource.route_progress_m + step, resource.route_length_m or 0.0
                )

                lat, lng = point_at_distance(resource.route, resource.route_progress_m)
                resource.lat, resource.lng = round(lat, 6), round(lng, 6)
                resource.busy_seconds += settings.SIM_TICK_SECONDS * settings.SIM_SPEED_MULTIPLIER

                remaining = max((resource.route_length_m or 0.0) - resource.route_progress_m, 0.0)
                resource.eta_seconds = remaining / speed_ms if speed_ms else None
                resource_index.upsert(resource.id, resource.lat, resource.lng)

                if remaining <= max(step, 25.0):
                    arrivals.append((resource, db.get(Incident, resource.incident_id) if resource.incident_id else None))
                else:
                    moved.append(resource)

            db.commit()

            for resource in moved:
                await bus.publish(
                    Topic.RESOURCE_MOVED,
                    {
                        "id": resource.id,
                        "lat": resource.lat,
                        "lng": resource.lng,
                        "status": resource.status,
                        "incident_id": resource.incident_id,
                        "eta_seconds": round(resource.eta_seconds, 1) if resource.eta_seconds else None,
                        "route_progress_m": round(resource.route_progress_m, 1),
                        "route_length_m": round(resource.route_length_m or 0, 1),
                    },
                )

            for resource, incident in arrivals:
                await self._handle_arrival(db, resource, incident)

        finally:
            db.close()

    async def _handle_arrival(self, db, resource: Resource, incident: Incident | None) -> None:
        from ..agents.supervisor import incident_payload, record, resource_payload

        now = datetime.now(timezone.utc)

        if resource.status == ResourceStatus.RETURNING.value:
            resource.status = ResourceStatus.AVAILABLE.value
            resource.route = None
            resource.route_stops = None
            resource.route_progress_m = 0.0
            resource.route_length_m = 0.0
            resource.eta_seconds = None
            resource.incident_id = None
            db.commit()
            await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
            return

        resource.status = ResourceStatus.ON_SCENE.value
        resource.eta_seconds = 0.0
        resource.route_progress_m = resource.route_length_m or 0.0

        if incident is not None and incident.status not in (
            IncidentStatus.RESOLVED.value,
            IncidentStatus.DISMISSED.value,
        ):
            incident.status = IncidentStatus.ON_SCENE.value
            if incident.on_scene_at is None:
                incident.on_scene_at = now
            incident.urgency_score = queue.compute_urgency(incident)

        db.commit()

        await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
        if incident is not None:
            await bus.publish(Topic.INCIDENT_UPDATED, incident_payload(incident))
            record(
                db,
                "simulation",
                "arrived",
                f"{resource.name} is on scene at incident #{incident.id}.",
                incident_id=incident.id,
                resource_id=resource.id,
                actor="simulation",
            )
            await bus.publish(
                Topic.ALERT,
                {
                    "level": "info",
                    "title": f"{resource.name} on scene",
                    "message": f"Incident #{incident.id} — {incident.summary}",
                    "incident_id": incident.id,
                },
                roles={"commander", "admin"},
            )

    # ----------------------------------------------------------------------
    async def send_home(self, db, resource: Resource) -> None:
        """Return a released unit to its home base, driving back on the map."""
        from ..agents import routing
        from ..agents.supervisor import active_closures, resource_payload

        distance = haversine_m(resource.lat, resource.lng, resource.home_lat, resource.home_lng)
        if distance < 120:
            resource.status = ResourceStatus.AVAILABLE.value
            resource.incident_id = None
            resource.route = None
            resource.route_progress_m = 0.0
            resource.route_length_m = 0.0
            resource.eta_seconds = None
            db.commit()
            await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))
            return

        route = await routing.get_route(
            (resource.lat, resource.lng),
            (resource.home_lat, resource.home_lng),
            speed_kmh=resource.speed_kmh or 40.0,
            closures=active_closures(db),
        )
        resource.status = ResourceStatus.RETURNING.value
        resource.incident_id = None
        resource.route = route.geometry
        resource.route_progress_m = 0.0
        resource.route_length_m = route.distance_m
        resource.eta_seconds = route.duration_s
        db.commit()
        await bus.publish(Topic.RESOURCE_UPDATED, resource_payload(resource))


simulation = SimulationEngine()
