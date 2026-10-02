"""Real-time fan-out.

A single `EventBus` owns every connected WebSocket. Anything in the system that
changes shared state publishes a typed event here; the dashboard and responder
views subscribe. Publishing is non-blocking — slow or dead sockets are dropped
rather than allowed to stall the orchestrator.

NFR "Real-time performance": events are pushed the moment state changes, so
propagation is bounded by network latency rather than a polling interval.
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

log = logging.getLogger("drc.events")


class Topic:
    INCIDENT_CREATED = "incident.created"
    INCIDENT_UPDATED = "incident.updated"
    INCIDENT_RESOLVED = "incident.resolved"
    REPORT_CREATED = "report.created"
    RESOURCE_UPDATED = "resource.updated"
    RESOURCE_MOVED = "resource.moved"
    DECISION_CREATED = "decision.created"
    DECISION_RESOLVED = "decision.resolved"
    LOG_APPENDED = "log.appended"
    ALERT = "alert"
    ASSIGNMENT = "assignment"
    QUEUE_TICK = "queue.tick"
    CLOSURE_UPDATED = "closure.updated"


class Connection:
    __slots__ = ("socket", "user_id", "role", "resource_id")

    def __init__(self, socket: WebSocket, user_id: int, role: str, resource_id: int | None):
        self.socket = socket
        self.user_id = user_id
        self.role = role
        self.resource_id = resource_id


class EventBus:
    def __init__(self, history: int = 200) -> None:
        self._connections: set[Connection] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=history)
        self._lock = asyncio.Lock()

    # -- lifecycle --------------------------------------------------------
    async def connect(self, socket: WebSocket, user_id: int, role: str, resource_id: int | None) -> Connection:
        await socket.accept()
        conn = Connection(socket, user_id, role, resource_id)
        async with self._lock:
            self._connections.add(conn)
        log.info("ws connected user=%s role=%s (total=%d)", user_id, role, len(self._connections))
        return conn

    async def disconnect(self, conn: Connection) -> None:
        async with self._lock:
            self._connections.discard(conn)

    @property
    def client_count(self) -> int:
        return len(self._connections)

    # -- publishing -------------------------------------------------------
    def _envelope(self, topic: str, data: Any) -> dict[str, Any]:
        return {
            "topic": topic,
            "ts": datetime.now(timezone.utc).isoformat(),
            "data": data,
        }

    async def publish(self, topic: str, data: Any, *, roles: set[str] | None = None,
                      resource_id: int | None = None) -> None:
        """Broadcast an event. `roles` restricts delivery; `resource_id`
        targets a single responder's device."""
        message = self._envelope(topic, data)
        self._history.append(message)
        payload = json.dumps(message, default=str)

        async with self._lock:
            targets = list(self._connections)

        dead: list[Connection] = []
        for conn in targets:
            if roles and conn.role not in roles:
                continue
            if resource_id is not None and conn.role == "responder" and conn.resource_id != resource_id:
                continue
            try:
                await conn.socket.send_text(payload)
            except Exception:
                dead.append(conn)

        if dead:
            async with self._lock:
                for conn in dead:
                    self._connections.discard(conn)

    def publish_soon(self, topic: str, data: Any, **kwargs) -> None:
        """Fire-and-forget publish for synchronous call sites."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.create_task(self.publish(topic, data, **kwargs))

    def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        return list(self._history)[-limit:]


bus = EventBus()
