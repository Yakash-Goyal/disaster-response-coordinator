import type pg from 'pg';
import { pool, query } from '../../db/pool';
import type { ResourceStatus, ResourceType } from '../../domain';
import { broadcast } from '../../realtime/socket';
import { conflict, notFound } from '../../utils/httpError';

export interface Resource {
  id: number;
  code: string;
  name: string;
  type: ResourceType;
  status: ResourceStatus;
  lat: number;
  lng: number;
  homeBase: string;
  capacity: number;
  currentLoad: number;
  capabilities: string[];
  assignedIncidentId: number | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Columns selected for a resource, with the PostGIS point split into lat/lng. */
export const RESOURCE_COLUMNS = `
  r.id, r.code, r.name, r.type, r.status,
  ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
  r.home_base AS "homeBase", r.capacity, r.current_load AS "currentLoad", r.capabilities,
  r.assigned_incident_id AS "assignedIncidentId", r.retired_at AS "retiredAt",
  r.created_at AS "createdAt", r.updated_at AS "updatedAt"`;

type Db = Pick<pg.Pool, 'query'> | pg.PoolClient;

export async function listResources(includeRetired: boolean): Promise<Resource[]> {
  return query<Resource>(
    `SELECT ${RESOURCE_COLUMNS} FROM resources r
      WHERE ($1::boolean OR r.retired_at IS NULL)
      ORDER BY r.type, r.code`,
    [includeRetired],
  );
}

export async function getResource(id: number, db: Db = pool): Promise<Resource> {
  const { rows } = await db.query<Resource>(`SELECT ${RESOURCE_COLUMNS} FROM resources r WHERE r.id = $1`, [id]);
  if (!rows[0]) throw notFound(`Resource #${id} was not found.`);
  return rows[0];
}

export interface ResourceInput {
  code: string;
  name: string;
  type: ResourceType;
  status: ResourceStatus;
  lat: number;
  lng: number;
  homeBase: string;
  capacity: number;
  currentLoad: number;
  capabilities: string[];
}

export async function createResource(input: ResourceInput): Promise<Resource> {
  await ensureCodeIsFree(input.code);
  const [row] = await query<{ id: number }>(
    `INSERT INTO resources (code, name, type, status, location, home_base, capacity, current_load, capabilities)
     VALUES ($1, $2, $3, $4, ST_MakePoint($5, $6)::geography, $7, $8, $9, $10)
     RETURNING id`,
    [input.code, input.name, input.type, input.status, input.lng, input.lat,
     input.homeBase, input.capacity, input.currentLoad, input.capabilities],
  );
  return publish(await getResource(row.id));
}

export async function updateResource(id: number, input: ResourceInput): Promise<Resource> {
  const existing = await getResource(id);
  if (input.code !== existing.code) await ensureCodeIsFree(input.code);

  // A unit that is out on a job must keep its status until the incident is
  // resolved; otherwise the dashboard would show a "free" unit that is busy.
  if (existing.assignedIncidentId && input.status !== existing.status) {
    throw conflict(
      `${existing.code} is assigned to incident #${existing.assignedIncidentId}. ` +
        'Resolve that incident first, then change the status.',
    );
  }

  await query(
    `UPDATE resources
        SET code = $2, name = $3, type = $4, status = $5,
            location = ST_MakePoint($6, $7)::geography, home_base = $8,
            capacity = $9, current_load = $10, capabilities = $11, updated_at = now()
      WHERE id = $1`,
    [id, input.code, input.name, input.type, input.status, input.lng, input.lat,
     input.homeBase, input.capacity, input.currentLoad, input.capabilities],
  );
  return publish(await getResource(id));
}

/** Retiring removes a resource from service without deleting its history. */
export async function setRetired(id: number, retired: boolean): Promise<Resource> {
  const existing = await getResource(id);
  if (retired && existing.assignedIncidentId) {
    throw conflict(`${existing.code} is on an active incident and cannot be retired right now.`);
  }
  await query(
    `UPDATE resources
        SET retired_at = CASE WHEN $2 THEN now() ELSE NULL END,
            status = CASE WHEN $2 THEN 'out_of_service' ELSE 'available' END,
            updated_at = now()
      WHERE id = $1`,
    [id, retired],
  );
  return publish(await getResource(id));
}

/** Counts per status, for the dashboard's resource status panel. */
export async function resourceStatusSummary() {
  return query<{ type: ResourceType; status: ResourceStatus; count: number }>(
    `SELECT type, status, COUNT(*)::int AS count
       FROM resources WHERE retired_at IS NULL
      GROUP BY type, status ORDER BY type, status`,
  );
}

async function ensureCodeIsFree(code: string) {
  const rows = await query('SELECT 1 FROM resources WHERE code = $1', [code]);
  if (rows.length) throw conflict(`Another resource already uses the code "${code}".`);
}

/** Sends the latest version of a resource to every open dashboard. */
export function publish(resource: Resource): Resource {
  broadcast('resource:updated', resource);
  return resource;
}
