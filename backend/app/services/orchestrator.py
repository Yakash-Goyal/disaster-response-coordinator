"""The orchestration heartbeat.

A single loop wakes on `ORCHESTRATOR_TICK_SECONDS`, recomputes queue urgency
(so aging actually happens without anyone touching the UI) and asks the
Supervisor to produce recommendations for anything still unassigned.

Keeping this on a timer rather than firing on every inbound report matters:
during a burst, twenty reports arrive in five seconds and would otherwise
trigger twenty overlapping dispatch cycles fighting over the same units.
"""
from __future__ import annotations

import asyncio
import logging

from ..config import settings
from ..database import SessionLocal
from ..events import Topic, bus
from ..services import queue

log = logging.getLogger("drc.orchestrator")


class Orchestrator:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False
        self.cycles = 0
        self.recommendations_made = 0

    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._running = True
            self._task = asyncio.create_task(self._loop(), name="drc-orchestrator")
            log.info("orchestrator started (tick %.1fs)", settings.ORCHESTRATOR_TICK_SECONDS)

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
                await asyncio.sleep(settings.ORCHESTRATOR_TICK_SECONDS)
                await self.cycle()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("orchestrator cycle failed")

    async def cycle(self) -> int:
        from ..agents import supervisor

        self.cycles += 1
        db = SessionLocal()
        try:
            ranked = queue.refresh_queue(db)
            decisions = await supervisor.run_dispatch_cycle(db)
            self.recommendations_made += len(decisions)

            await bus.publish(
                Topic.QUEUE_TICK,
                {
                    "cycle": self.cycles,
                    "open_incidents": len(ranked),
                    "new_recommendations": len(decisions),
                    "top": [
                        {"id": i.id, "urgency_score": i.urgency_score, "status": i.status}
                        for i in ranked[:10]
                    ],
                },
            )
            return len(decisions)
        finally:
            db.close()


orchestrator = Orchestrator()
