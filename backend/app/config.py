"""Central configuration. Everything is overridable via environment variables
or a .env file placed in backend/."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
PROJECT_DIR = BASE_DIR.parent                      # repo root


def _load_dotenv() -> None:
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _b(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _f(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _i(name: str, default: int) -> int:
    try:
        return int(float(os.getenv(name, default)))
    except (TypeError, ValueError):
        return default


class Settings:
    # --- app -------------------------------------------------------------
    APP_NAME = "Disaster Response Resource Coordinator"
    VERSION = "1.0.0"
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = _i("PORT", 8000)

    # --- database --------------------------------------------------------
    # SQLite by default so the project runs with zero infrastructure.
    # Point DATABASE_URL at PostgreSQL to activate the PostGIS query path:
    #   postgresql+psycopg://user:pass@localhost:5432/drc
    DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'drc.db'}")

    @property
    def is_postgres(self) -> bool:
        return self.DATABASE_URL.startswith("postgres")

    # --- auth ------------------------------------------------------------
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me-in-production")
    JWT_ALGORITHM = "HS256"
    TOKEN_TTL_MINUTES = _i("TOKEN_TTL_MINUTES", 720)

    # --- LLM / agent layer ----------------------------------------------
    # With no key set, every agent falls back to its deterministic heuristic
    # implementation, so the whole system still runs offline.
    LLM_PROVIDER = os.getenv("LLM_PROVIDER", "auto")  # auto | anthropic | heuristic
    ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
    LLM_MODEL = os.getenv("LLM_MODEL", "claude-sonnet-4-6")
    LLM_TIMEOUT = _f("LLM_TIMEOUT", 20.0)
    LLM_MAX_TOKENS = _i("LLM_MAX_TOKENS", 700)

    # --- routing ---------------------------------------------------------
    # Public demo server: https://router.project-osrm.org
    # Self-hosted:        http://localhost:5000
    OSRM_URL = os.getenv("OSRM_URL", "")
    ROUTING_TIMEOUT = _f("ROUTING_TIMEOUT", 8.0)
    ROAD_FACTOR = _f("ROAD_FACTOR", 1.38)  # straight-line -> road distance

    # --- triage / queue --------------------------------------------------
    TRIAGE_REVIEW_THRESHOLD = _f("TRIAGE_REVIEW_THRESHOLD", 0.62)
    DEDUP_RADIUS_M = _f("DEDUP_RADIUS_M", 350.0)
    DEDUP_WINDOW_S = _f("DEDUP_WINDOW_S", 1800.0)
    AGE_URGENCY_PER_MIN = _f("AGE_URGENCY_PER_MIN", 0.55)
    AGE_URGENCY_CAP = _f("AGE_URGENCY_CAP", 25.0)

    # --- dispatch --------------------------------------------------------
    CANDIDATE_SEARCH_RADIUS_M = _f("CANDIDATE_SEARCH_RADIUS_M", 12000.0)
    CANDIDATE_POOL = _i("CANDIDATE_POOL", 8)
    ROUTED_CANDIDATES = _i("ROUTED_CANDIDATES", 3)
    # Human-in-the-loop is the default posture. Turning this on lets the
    # supervisor auto-approve *low* severity dispatches only; severity >= 4
    # is never auto-approved regardless of this setting (see NFR "Human override").
    ALLOW_AUTO_APPROVE = _b("ALLOW_AUTO_APPROVE", False)
    AUTO_APPROVE_MAX_SEVERITY = _i("AUTO_APPROVE_MAX_SEVERITY", 2)
    ESCALATE_SEVERITY = _i("ESCALATE_SEVERITY", 4)

    # --- simulation ------------------------------------------------------
    SIM_ENABLED = _b("SIM_ENABLED", True)
    SIM_TICK_SECONDS = _f("SIM_TICK_SECONDS", 1.0)
    SIM_SPEED_MULTIPLIER = _f("SIM_SPEED_MULTIPLIER", 12.0)
    ORCHESTRATOR_TICK_SECONDS = _f("ORCHESTRATOR_TICK_SECONDS", 4.0)

    # --- ingestion -------------------------------------------------------
    SOCIAL_FEED_ENABLED = _b("SOCIAL_FEED_ENABLED", True)
    SOCIAL_FEED_INTERVAL_S = _f("SOCIAL_FEED_INTERVAL_S", 25.0)
    WEATHER_FEED_ENABLED = _b("WEATHER_FEED_ENABLED", True)
    WEATHER_FEED_INTERVAL_S = _f("WEATHER_FEED_INTERVAL_S", 120.0)
    WEATHER_API_URL = os.getenv("WEATHER_API_URL", "")  # blank -> synthetic hazards

    # --- scenario --------------------------------------------------------
    SEED_ON_START = _b("SEED_ON_START", True)
    SCENARIO_CENTER_LAT = _f("SCENARIO_CENTER_LAT", 30.7333)   # Chandigarh
    SCENARIO_CENTER_LNG = _f("SCENARIO_CENTER_LNG", 76.7794)
    SCENARIO_RADIUS_KM = _f("SCENARIO_RADIUS_KM", 6.0)

    # --- misc ------------------------------------------------------------
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
    STATIC_DIR = PROJECT_DIR / "frontend" / "dist"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
