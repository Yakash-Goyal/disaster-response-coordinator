import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

# Point at a throwaway database and disable every background loop before the
# app package is imported — settings are read at import time.
_tmp = tempfile.mkdtemp()
os.environ.update(
    DATABASE_URL=f"sqlite:///{_tmp}/test.db",
    SEED_ON_START="false",
    SIM_ENABLED="false",
    SOCIAL_FEED_ENABLED="false",
    WEATHER_FEED_ENABLED="false",
    LLM_PROVIDER="heuristic",
    OSRM_URL="",
    SECRET_KEY="test-secret",
)

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.geo import incident_index, resource_index  # noqa: E402


@pytest.fixture
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    incident_index.rebuild([])
    resource_index.rebuild([])
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seeded(db):
    from app.seed.scenario import bootstrap

    bootstrap(db)
    return db
