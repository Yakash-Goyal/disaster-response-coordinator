"""Application entrypoint.

Startup order matters: schema, then PostGIS setup, then seed data (which
populates the spatial indexes), and only then the background loops — the
orchestrator must not run a dispatch cycle against an empty resource index.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .agents import llm, routing
from .config import settings
from .database import SessionLocal, init_db
from .geo import ensure_postgis
from .routers import auth, dispatch, incidents, resources, responder, system
from .services.ingestion import ingestion
from .services.orchestrator import orchestrator
from .services.simulation import simulation

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)-18s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("drc")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    db = SessionLocal()
    try:
        ensure_postgis(db)
        from .seed.scenario import bootstrap, run_flood_scenario, scenario_is_seeded

        bootstrap(db)
        if settings.SEED_ON_START and not scenario_is_seeded(db):
            await run_flood_scenario(db)
    finally:
        db.close()

    if settings.SIM_ENABLED:
        simulation.start()
    orchestrator.start()
    ingestion.start()

    log.info(
        "%s v%s ready — LLM=%s routing=%s spatial=%s",
        settings.APP_NAME,
        settings.VERSION,
        llm.get_provider().name,
        routing.provider_name(),
        "postgis" if settings.is_postgres else "grid",
    )

    yield

    await ingestion.stop()
    await orchestrator.stop()
    await simulation.stop()
    await routing.aclose()
    await llm.shutdown_provider()
    log.info("shutdown complete")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description=(
        "AI-driven command-and-control platform for disaster response teams. "
        "Multi-agent triage, dispatch and routing with a human commander in the loop."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


app.include_router(auth.router)
app.include_router(incidents.reports_router)
app.include_router(incidents.router)
app.include_router(resources.router)
app.include_router(dispatch.router)
app.include_router(responder.router)
app.include_router(system.router)
app.include_router(system.ws_router)


# --------------------------------------------------------------------------
# Serve the built frontend when it exists, so one process runs the whole app.
# --------------------------------------------------------------------------
if settings.STATIC_DIR.exists():
    assets = settings.STATIC_DIR / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        candidate = settings.STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(settings.STATIC_DIR / "index.html")

else:

    @app.get("/", include_in_schema=False)
    async def no_frontend():
        return {
            "message": (
                "API is running. The frontend has not been built — run "
                "`npm install && npm run build` in frontend/, or use the dev server "
                "with `npm run dev`."
            ),
            "docs": "/docs",
        }
