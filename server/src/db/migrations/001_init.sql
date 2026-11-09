-- =====================================================================
-- 001_init.sql : initial database schema
--
-- Locations are stored as GEOGRAPHY(POINT, 4326):
--   * 4326 = standard GPS coordinates (latitude / longitude)
--   * "geography" makes PostGIS measure distances in metres on the earth
-- Every location column has a GIST index so that "find nearest" and
-- "find within N metres" queries use the index instead of scanning rows.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- Resources: everything that can be dispatched or used in a response
-- ---------------------------------------------------------------------
CREATE TABLE resources (
  id                   SERIAL PRIMARY KEY,
  code                 TEXT NOT NULL UNIQUE,              -- short call sign, e.g. AMB-04
  name                 TEXT NOT NULL,                     -- e.g. "Ambulance 4"
  type                 TEXT NOT NULL CHECK (type IN ('ambulance', 'supply_truck', 'personnel', 'shelter')),
  status               TEXT NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available', 'en_route', 'on_scene', 'out_of_service')),
  location             GEOGRAPHY(POINT, 4326) NOT NULL,   -- current (simulated) GPS position
  home_base            TEXT NOT NULL DEFAULT '',          -- area the unit is stationed at
  capacity             INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 0),
  current_load         INTEGER NOT NULL DEFAULT 0 CHECK (current_load >= 0),
  capabilities         TEXT[] NOT NULL DEFAULT '{}',      -- e.g. {advanced_life_support}
  assigned_incident_id INTEGER,                           -- foreign key added below
  retired_at           TIMESTAMPTZ,                       -- set when an admin retires the resource
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (current_load <= capacity)
);

CREATE INDEX resources_location_gix ON resources USING GIST (location);
CREATE INDEX resources_status_idx   ON resources (status);

-- ---------------------------------------------------------------------
-- Users: commanders, field responders and admins
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('commander', 'responder', 'admin')),
  resource_id   INTEGER REFERENCES resources(id) ON DELETE SET NULL,  -- only for responders
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Incidents: one real-world event, built from one or more reports
-- ---------------------------------------------------------------------
CREATE TABLE incidents (
  id              SERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('flood', 'fire', 'structural_collapse', 'medical',
                                                'road_blockage', 'power_outage', 'supply_shortage', 'other')),
  severity        SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  urgency_score   NUMERIC(5, 1) NOT NULL DEFAULT 0,
  urgency_reason  TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'dispatched', 'on_scene', 'resolved')),
  location        GEOGRAPHY(POINT, 4326) NOT NULL,
  address         TEXT,
  report_count    INTEGER NOT NULL DEFAULT 1,
  confidence      NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  needs_review    BOOLEAN NOT NULL DEFAULT false,
  classified_by   TEXT NOT NULL CHECK (classified_by IN ('ai', 'rules', 'commander')),
  triage_reason   TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_report_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at   TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX incidents_location_gix ON incidents USING GIST (location);
CREATE INDEX incidents_status_idx   ON incidents (status);

ALTER TABLE resources
  ADD CONSTRAINT resources_assigned_incident_fk
  FOREIGN KEY (assigned_incident_id) REFERENCES incidents(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Reports: raw input from any channel (form, social media, weather API)
-- ---------------------------------------------------------------------
CREATE TABLE reports (
  id           SERIAL PRIMARY KEY,
  source       TEXT NOT NULL CHECK (source IN ('manual', 'social_media', 'weather_api')),
  text         TEXT NOT NULL,
  location     GEOGRAPHY(POINT, 4326) NOT NULL,
  address      TEXT,
  image_url    TEXT,
  reporter     TEXT,                                   -- caller name or social media handle
  reported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  incident_id  INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_location_gix ON reports USING GIST (location);
CREATE INDEX reports_incident_idx ON reports (incident_id);

-- ---------------------------------------------------------------------
-- Dispatch decisions: what the Dispatch Agent recommended and
-- what the human commander did with it
-- ---------------------------------------------------------------------
CREATE TABLE dispatch_decisions (
  id                       SERIAL PRIMARY KEY,
  incident_id              INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  recommended_resource_id  INTEGER NOT NULL REFERENCES resources(id),
  resource_id              INTEGER REFERENCES resources(id),   -- unit actually sent
  agent_recommendation     JSONB NOT NULL,                     -- ranked candidates with ETA and scores
  rationale                TEXT NOT NULL,                      -- plain-language reason
  human_action             TEXT NOT NULL DEFAULT 'pending'
                             CHECK (human_action IN ('pending', 'accepted', 'overridden', 'superseded')),
  override_reason          TEXT,
  decided_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at               TIMESTAMPTZ
);

CREATE INDEX dispatch_decisions_incident_idx ON dispatch_decisions (incident_id);

-- ---------------------------------------------------------------------
-- Audit log: every agent decision and every human response
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_name   TEXT NOT NULL,          -- e.g. "Triage Agent" or the user's name
  action       TEXT NOT NULL,          -- e.g. "incident.classified"
  entity_type  TEXT,
  entity_id    INTEGER,
  summary      TEXT NOT NULL,          -- one readable sentence
  details      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX audit_log_entity_idx  ON audit_log (entity_type, entity_id);
