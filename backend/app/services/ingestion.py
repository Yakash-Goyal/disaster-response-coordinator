"""Report Ingestion — specification section 4.1.

Three inbound channels feed the same pipeline:

  1. **Manual entry** — the commander's intake form (handled by the reports
     router; it calls straight into the supervisor).
  2. **Mock social feed** — synthetic posts drip-fed on a timer to simulate
     citizen chatter arriving during an unfolding event.
  3. **Weather / hazard API** — a real HTTP feed when `WEATHER_API_URL` is set
     (Open-Meteo compatible), otherwise a synthetic hazard generator so the
     channel still demonstrates end to end.

All three converge on `supervisor.handle_report`, so deduplication and triage
behave identically regardless of where a report came from.
"""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone

import httpx

from ..config import settings
from ..database import SessionLocal
from ..geo import offset_point
from ..models import ReportSource

log = logging.getLogger("drc.ingestion")

# --------------------------------------------------------------------------
# Synthetic social chatter. Deliberately messy: typos, vagueness, duplicates
# and the occasional irrelevant post, so triage and dedup have real work to do.
# --------------------------------------------------------------------------
SOCIAL_POSTS: list[tuple[str, str]] = [
    ("Water is up to the car doors on Sector 22 market road, nobody can get through", "flood"),
    ("water rising fast near the market, my shop is flooding", "flood"),
    ("Anyone know if the market road is open? Looks completely submerged from here", "flood"),
    ("smoke pouring out of the second floor of the apartment block behind the bus stand", "fire"),
    ("FIRE at the apartments near bus stand, please send help, people still inside", "fire"),
    ("Elderly man collapsed at the relief queue, he's not responding", "medical"),
    ("someone fainted in the queue at the community centre, needs a medic", "medical"),
    ("Part of the old school wall came down, dust everywhere, think someone is under it", "structural"),
    ("wall collapse at the school!! kids were playing there 10 min ago", "structural"),
    ("Whole street has no power since last night, phones are dying", "power"),
    ("transformer near the water tank sparked and blew, no electricity now", "power"),
    ("Huge tree fell across the road to the hospital, ambulances cant pass", "road"),
    ("road to hospital blocked by tree, need it cleared urgently", "road"),
    ("Family stuck on the roof of a house near the canal, water still rising", "rescue"),
    ("people stranded on rooftops by the canal, they've been up there an hour", "rescue"),
    ("Strong chemical smell coming from the godown, eyes burning", "hazmat"),
    ("something leaking from the storage yard, everyone moving away", "hazmat"),
    ("Great volunteer turnout at the relief camp today, so many people helping", "noise"),
    ("does anyone know when the shops will reopen", "noise"),
    ("Two people cut by broken glass at the shelter entrance, bleeding a lot", "medical"),
    ("Drain overflowing on the lane behind the temple, ankle deep now but rising", "flood"),
    ("i think i saw flames near the fuel station but not sure, might be a reflection", "fire"),
]

HAZARD_TEMPLATES = [
    ("Heavy rainfall warning: {mm} mm in the last hour, low-lying areas at risk of flooding", "flood"),
    ("River gauge above danger mark near {place}, embankment overflow likely within the hour", "flood"),
    ("High wind advisory: gusts to {kmh} km/h, expect downed trees and power lines", "road_blocked"),
    ("Thunderstorm cell over {place}, lightning strike risk to exposed structures", "other"),
]

PLACES = [
    "the canal bridge", "Sector 22 market", "the north embankment", "the industrial yard",
    "the community centre", "the bus stand", "the old school", "the water tank",
]


def _jitter_point(lat: float, lng: float, max_m: float) -> tuple[float, float]:
    distance = random.uniform(0, max_m)
    bearing = random.uniform(0, 360)
    return offset_point(lat, lng, distance, bearing)


class IngestionService:
    """Owns the two background feed workers."""

    def __init__(self) -> None:
        self._tasks: list[asyncio.Task] = []
        self._social_cursor = 0
        self.social_emitted = 0
        self.weather_emitted = 0

    # -- lifecycle --------------------------------------------------------
    def start(self) -> None:
        if settings.SOCIAL_FEED_ENABLED:
            self._tasks.append(asyncio.create_task(self._social_loop(), name="drc-social-feed"))
        if settings.WEATHER_FEED_ENABLED:
            self._tasks.append(asyncio.create_task(self._weather_loop(), name="drc-weather-feed"))
        if self._tasks:
            log.info("ingestion feeds started (%d workers)", len(self._tasks))

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._tasks.clear()

    # -- workers ----------------------------------------------------------
    async def _social_loop(self) -> None:
        await asyncio.sleep(8)  # let the scenario settle before chatter starts
        while True:
            try:
                await asyncio.sleep(settings.SOCIAL_FEED_INTERVAL_S * random.uniform(0.6, 1.4))
                await self.emit_social_post()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("social feed worker failed")

    async def _weather_loop(self) -> None:
        await asyncio.sleep(20)
        while True:
            try:
                await asyncio.sleep(settings.WEATHER_FEED_INTERVAL_S)
                await self.emit_weather_alert()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("weather feed worker failed")

    # -- emitters ---------------------------------------------------------
    async def emit_social_post(self, index: int | None = None) -> int | None:
        from ..agents import supervisor

        if index is None:
            index = self._social_cursor % len(SOCIAL_POSTS)
            self._social_cursor += 1
        text, _tag = SOCIAL_POSTS[index % len(SOCIAL_POSTS)]

        lat, lng = _jitter_point(
            settings.SCENARIO_CENTER_LAT,
            settings.SCENARIO_CENTER_LNG,
            settings.SCENARIO_RADIUS_KM * 1000 * 0.7,
        )
        db = SessionLocal()
        try:
            _report, incident, merged, _triage = await supervisor.handle_report(
                db,
                text=text,
                lat=lat,
                lng=lng,
                source=ReportSource.SOCIAL.value,
                reporter=f"@citizen_{random.randint(100, 999)}",
            )
            self.social_emitted += 1
            log.debug("social post -> incident %s (merged=%s)", incident.id, merged)
            return incident.id
        finally:
            db.close()

    async def emit_weather_alert(self) -> int | None:
        from ..agents import supervisor

        text = await self._fetch_weather_text()
        if text is None:
            return None

        lat, lng = _jitter_point(
            settings.SCENARIO_CENTER_LAT,
            settings.SCENARIO_CENTER_LNG,
            settings.SCENARIO_RADIUS_KM * 1000,
        )
        db = SessionLocal()
        try:
            _report, incident, _merged, _triage = await supervisor.handle_report(
                db,
                text=text,
                lat=lat,
                lng=lng,
                source=ReportSource.WEATHER.value,
                reporter="hazard-feed",
            )
            self.weather_emitted += 1
            return incident.id
        finally:
            db.close()

    async def _fetch_weather_text(self) -> str | None:
        """Real feed when configured; synthetic hazard otherwise."""
        if settings.WEATHER_API_URL:
            try:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    resp = await client.get(
                        settings.WEATHER_API_URL,
                        params={
                            "latitude": settings.SCENARIO_CENTER_LAT,
                            "longitude": settings.SCENARIO_CENTER_LNG,
                            "current": "precipitation,wind_speed_10m",
                        },
                    )
                    resp.raise_for_status()
                    current = resp.json().get("current", {})
                    rain = float(current.get("precipitation", 0) or 0)
                    wind = float(current.get("wind_speed_10m", 0) or 0)
                    if rain >= 4:
                        return (
                            f"Rainfall warning: {rain:.1f} mm in the last hour, "
                            "low-lying areas at risk of flooding"
                        )
                    if wind >= 45:
                        return (
                            f"High wind advisory: gusts to {wind:.0f} km/h, "
                            "expect downed trees and power lines"
                        )
                    return None  # nothing worth reporting; stay quiet
            except Exception as exc:  # noqa: BLE001
                log.warning("weather API unreachable, using synthetic hazard: %s", exc)

        template, _tag = random.choice(HAZARD_TEMPLATES)
        return template.format(
            mm=random.randint(28, 74),
            kmh=random.randint(52, 95),
            place=random.choice(PLACES),
        )


ingestion = IngestionService()
