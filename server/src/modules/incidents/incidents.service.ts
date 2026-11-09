import type pg from 'pg';
import { computeUrgency } from '../../agents/triage/urgency';
import { pool, query, withTransaction } from '../../db/pool';
import { INCIDENT_TYPE_LABELS, type IncidentStatus, type IncidentType } from '../../domain';
import type { AuthUser } from '../../middleware/auth';
import { broadcast } from '../../realtime/socket';
import { conflict, notFound } from '../../utils/httpError';
import { getIncidentHistory, logAudit } from '../audit/audit.service';
import { getResource, publish as publishResource } from '../resources/resources.service';

export interface AssignedUnit {
  id: number;
  code: string;
  name: string;
  type: string;
  status: string;
}

export interface Incident {
  id: number;
  title: string;
  type: IncidentType;
  severity: number;
  urgencyScore: number;
  urgencyReason: string;
  status: IncidentStatus;
  lat: number;
  lng: number;
  address: string | null;
  reportCount: number;
  confidence: number;
  needsReview: boolean;
  classifiedBy: 'ai' | 'rules' | 'commander';
  triageReason: string;
  createdAt: string;
  updatedAt: string;
  lastReportAt: string;
  dispatchedAt: string | null;
  resolvedAt: string | null;
  assignedUnits: AssignedUnit[];
  pendingDecisionId: number | null;
}

type Db = Pick<pg.Pool, 'query'> | pg.PoolClient;

const INCIDENT_SELECT = `
  SELECT i.id, i.title, i.type, i.severity, i.urgency_score AS "urgencyScore",
         i.urgency_reason AS "urgencyReason", i.status,
         ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lng,
         i.address, i.report_count AS "reportCount", i.confidence, i.needs_review AS "needsReview",
         i.classified_by AS "classifiedBy", i.triage_reason AS "triageReason",
         i.created_at AS "createdAt", i.updated_at AS "updatedAt", i.last_report_at AS "lastReportAt",
         i.dispatched_at AS "dispatchedAt", i.resolved_at AS "resolvedAt",
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'code', r.code, 'name', r.name,
                                                     'type', r.type, 'status', r.status) ORDER BY r.code)
                     FROM resources r WHERE r.assigned_incident_id = i.id), '[]') AS "assignedUnits",
         (SELECT d.id FROM dispatch_decisions d
           WHERE d.incident_id = i.id AND d.human_action = 'pending'
           ORDER BY d.created_at DESC LIMIT 1) AS "pendingDecisionId"
    FROM incidents i`;

/**
 * The incident queue (SRS 4.3): all active incidents, most urgent first.
 * Ties are broken by age, so an older incident is not starved by newer ones.
 */
export async function listActiveIncidents(): Promise<Incident[]> {
  return query<Incident>(
    `${INCIDENT_SELECT} WHERE i.status <> 'resolved' ORDER BY i.urgency_score DESC, i.created_at ASC`,
  );
}

export async function listResolvedIncidents(limit = 50): Promise<Incident[]> {
  return query<Incident>(
    `${INCIDENT_SELECT} WHERE i.status = 'resolved' ORDER BY i.resolved_at DESC LIMIT $1`,
    [limit],
  );
}

export async function getIncident(id: number, db: Db = pool): Promise<Incident> {
  const { rows } = await db.query<Incident>(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
  if (!rows[0]) throw notFound(`Incident #${id} was not found.`);
  return rows[0];
}

/** Full picture of one incident: details, its reports, and its history. */
export async function getIncidentDetails(id: number) {
  const incident = await getIncident(id);
  const reports = await query(
    `SELECT id, source, text, address, reporter, image_url AS "imageUrl", reported_at AS "reportedAt",
            ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM reports WHERE incident_id = $1 ORDER BY reported_at ASC`,
    [id],
  );
  const history = await getIncidentHistory(id);
  return { incident, reports, history };
}

/** Sends the latest version of an incident to every open dashboard. */
export async function publishIncident(id: number): Promise<Incident> {
  const incident = await getIncident(id);
  broadcast('incident:updated', incident);
  return incident;
}

/**
 * Commander confirms or corrects the Triage Agent's classification (SRS 4.2:
 * low-confidence results are reviewed by a human instead of silently guessed).
 */
export async function reviewClassification(
  id: number,
  input: { type: IncidentType; severity: number },
  user: AuthUser,
): Promise<Incident> {
  const before = await getIncident(id);
  if (before.status === 'resolved') throw conflict('This incident is already resolved.');

  const urgency = computeUrgency({ severity: input.severity, type: input.type, reportCount: before.reportCount });
  await query(
    `UPDATE incidents
        SET type = $2, severity = $3, confidence = 1, needs_review = false, classified_by = 'commander',
            urgency_score = $4, urgency_reason = $5, updated_at = now()
      WHERE id = $1`,
    [id, input.type, input.severity, urgency.score, urgency.reason],
  );

  const changed = before.type !== input.type || before.severity !== input.severity;
  await logAudit({
    actorType: 'human',
    actorName: user.name,
    action: changed ? 'incident.reclassified' : 'incident.classification_confirmed',
    entityType: 'incident',
    entityId: id,
    summary: changed
      ? `Corrected the classification from ${INCIDENT_TYPE_LABELS[before.type]} ` +
        `(severity ${before.severity}) to ${INCIDENT_TYPE_LABELS[input.type]} (severity ${input.severity}).`
      : `Confirmed the Triage Agent's classification.`,
    details: { before: { type: before.type, severity: before.severity }, after: input },
  });

  return publishIncident(id);
}

/**
 * Moves an incident forward: dispatched -> on_scene -> resolved.
 * Assigned units follow along; on resolve they become available again.
 */
export async function updateIncidentStatus(
  id: number,
  status: 'on_scene' | 'resolved',
  user: AuthUser,
): Promise<Incident> {
  const { resourceIds, previousStatus } = await withTransaction(async (client) => {
    // Lock the row first so two people clicking at once cannot both change it.
    await client.query('SELECT id FROM incidents WHERE id = $1 FOR UPDATE', [id]);
    const incident = await getIncident(id, client);

    if (incident.status === 'resolved') throw conflict('This incident is already resolved.');
    if (status === 'on_scene' && incident.status !== 'dispatched') {
      throw conflict('A unit must be dispatched before it can arrive on scene.');
    }

    const units = incident.assignedUnits.map((u) => u.id);

    if (status === 'on_scene') {
      await client.query(`UPDATE incidents SET status = 'on_scene', updated_at = now() WHERE id = $1`, [id]);
      // The unit has arrived, so its position is now the incident location.
      await client.query(
        `UPDATE resources r SET status = 'on_scene', location = i.location, updated_at = now()
           FROM incidents i WHERE i.id = $1 AND r.assigned_incident_id = $1`,
        [id],
      );
    } else {
      await client.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now(), needs_review = false, updated_at = now()
          WHERE id = $1`,
        [id],
      );
      await client.query(
        `UPDATE resources SET status = 'available', assigned_incident_id = NULL, updated_at = now()
          WHERE assigned_incident_id = $1`,
        [id],
      );
      await client.query(
        `UPDATE dispatch_decisions SET human_action = 'superseded'
          WHERE incident_id = $1 AND human_action = 'pending'`,
        [id],
      );
    }
    return { resourceIds: units, previousStatus: incident.status };
  });

  let summary = 'Marked the assigned unit as arrived on scene.';
  if (status === 'resolved') {
    summary =
      previousStatus === 'open'
        ? 'Closed the incident without sending a unit (no action needed).'
        : 'Marked the incident as resolved.' + (resourceIds.length ? ' Assigned units are available again.' : '');
  }

  await logAudit({
    actorType: 'human',
    actorName: user.name,
    action: `incident.${status}`,
    entityType: 'incident',
    entityId: id,
    summary,
  });

  for (const resourceId of resourceIds) publishResource(await getResource(resourceId));
  return publishIncident(id);
}
