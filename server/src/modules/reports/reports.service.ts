import { runTriage } from '../../agents/triage/triageGraph';
import type { TriageResult } from '../../agents/triage/types';
import { computeUrgency } from '../../agents/triage/urgency';
import { env } from '../../config/env';
import { query, withTransaction } from '../../db/pool';
import { INCIDENT_TYPE_LABELS, SEVERITY_LABELS, type ReportSource } from '../../domain';
import { logAudit } from '../audit/audit.service';
import { publishIncident, type Incident } from '../incidents/incidents.service';

/**
 * REPORT INGESTION PIPELINE (SRS 4.1 + 4.2)
 *
 *   1. save the raw report
 *   2. Triage Agent classifies it (type, severity, confidence)
 *   3. deduplicate: is there already an active incident of the same type
 *      close by (PostGIS ST_DWithin) and recent? -> merge into it
 *      otherwise -> create a new incident
 *   4. compute the urgency score, write the audit log, push live update
 */

export interface ReportInput {
  source: ReportSource;
  text: string;
  lat: number;
  lng: number;
  address?: string | null;
  reporter?: string | null;
  reportedAt?: Date;
  createdBy?: number | null;
}

export interface IngestResult {
  reportId: number;
  incident: Incident;
  merged: boolean;
  triage: TriageResult;
}

/**
 * Reports are triaged in parallel (the slow AI part), but the
 * "find duplicate or create incident" step runs one at a time.
 * Otherwise two reports of the same event arriving together could both
 * miss each other and create two incidents.
 */
let dedupQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = dedupQueue.then(task, task);
  dedupQueue = run.catch(() => undefined);
  return run;
}

export async function ingestReport(input: ReportInput): Promise<IngestResult> {
  const reportedAt = input.reportedAt ?? new Date();

  // 1. Save the raw report first, so nothing is lost even if a later step fails.
  const [report] = await query<{ id: number }>(
    `INSERT INTO reports (source, text, location, address, reporter, reported_at, created_by)
     VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5, $6, $7, $8)
     RETURNING id`,
    [input.source, input.text, input.lng, input.lat, input.address ?? null,
     input.reporter ?? null, reportedAt, input.createdBy ?? null],
  );

  // 2. Triage Agent
  const triage = await runTriage(input.text);
  await logAudit({
    actorType: 'agent',
    actorName: 'Triage Agent',
    action: 'report.classified',
    entityType: 'report',
    entityId: report.id,
    summary:
      `Classified report #${report.id} as ${INCIDENT_TYPE_LABELS[triage.type]}, ` +
      `severity ${triage.severity} (${SEVERITY_LABELS[triage.severity]}), ` +
      `${Math.round(triage.confidence * 100)}% confident` +
      (triage.method === 'rules' ? ' using keyword rules.' : ' using AI.') +
      (triage.needsReview ? ' Flagged for human review.' : ''),
    details: { ...triage },
  });

  // 3 + 4. Deduplicate and create/update the incident
  const { incidentId, merged } = await oneAtATime(() => attachToIncident(report.id, input, reportedAt, triage));
  const incident = await publishIncident(incidentId);
  return { reportId: report.id, incident, merged, triage };
}

async function attachToIncident(
  reportId: number,
  input: ReportInput,
  reportedAt: Date,
  triage: TriageResult,
): Promise<{ incidentId: number; merged: boolean }> {
  // Find the closest active incident of the same type within the radius and time window.
  // ST_DWithin on geography uses metres and the GIST index on incidents.location.
  // "other" is never merged: two vague reports nearby are not necessarily the same event.
  const [duplicate] =
    triage.type === 'other'
      ? []
      : await query<{ id: number; reportCount: number; distance: number }>(
          `SELECT id, report_count AS "reportCount",
                  ST_Distance(location, ST_MakePoint($2, $3)::geography) AS distance
             FROM incidents
            WHERE status <> 'resolved'
              AND type = $1
              AND ST_DWithin(location, ST_MakePoint($2, $3)::geography, $4)
              AND last_report_at >= $5::timestamptz - make_interval(mins => $6)
            ORDER BY location <-> ST_MakePoint($2, $3)::geography
            LIMIT 1`,
          [triage.type, input.lng, input.lat, env.DEDUP_RADIUS_METERS, reportedAt, env.DEDUP_WINDOW_MINUTES],
        );

  if (duplicate) {
    await mergeIntoIncident(duplicate.id, reportId, triage);
    await logAudit({
      actorType: 'agent',
      actorName: 'Triage Agent',
      action: 'report.merged',
      entityType: 'report',
      entityId: reportId,
      summary:
        `Report #${reportId} describes the same event as incident #${duplicate.id} ` +
        `(${Math.round(duplicate.distance)} m away), so it was merged. ` +
        `The incident now has ${duplicate.reportCount + 1} reports.`,
      details: { incidentId: duplicate.id, distanceMeters: Math.round(duplicate.distance) },
    });
    return { incidentId: duplicate.id, merged: true };
  }

  const incidentId = await createIncident(reportId, input, triage);
  await logAudit({
    actorType: 'agent',
    actorName: 'Triage Agent',
    action: 'incident.created',
    entityType: 'incident',
    entityId: incidentId,
    summary: `Created incident #${incidentId} from report #${reportId}: ${triage.title}`,
  });
  return { incidentId, merged: false };
}

async function createIncident(reportId: number, input: ReportInput, triage: TriageResult): Promise<number> {
  const urgency = computeUrgency({ severity: triage.severity, type: triage.type, reportCount: 1 });
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO incidents (title, type, severity, urgency_score, urgency_reason, location, address,
                              confidence, needs_review, classified_by, triage_reason)
       VALUES ($1, $2, $3, $4, $5, ST_MakePoint($6, $7)::geography, $8, $9, $10, $11, $12)
       RETURNING id`,
      [triage.title, triage.type, triage.severity, urgency.score, urgency.reason, input.lng, input.lat,
       input.address ?? null, triage.confidence, triage.needsReview, triage.method, triage.reason],
    );
    await client.query('UPDATE reports SET incident_id = $1 WHERE id = $2', [rows[0].id, reportId]);
    return rows[0].id;
  });
}

/**
 * A confirming report raises the report count (a severity signal), keeps the
 * highest severity seen, and recomputes urgency. A commander's manual
 * classification is never overwritten by an agent.
 */
async function mergeIntoIncident(incidentId: number, reportId: number, triage: TriageResult) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT type, severity, report_count AS "reportCount", classified_by AS "classifiedBy"
         FROM incidents WHERE id = $1 FOR UPDATE`,
      [incidentId],
    );
    const current = rows[0];
    const reviewedByHuman = current.classifiedBy === 'commander';
    const severity = reviewedByHuman ? current.severity : Math.max(current.severity, triage.severity);
    const reportCount = current.reportCount + 1;
    const urgency = computeUrgency({ severity, type: current.type, reportCount });

    await client.query(
      `UPDATE incidents
          SET report_count = $2,
              severity = $3,
              urgency_score = $4,
              urgency_reason = $5,
              confidence = CASE WHEN $6 THEN confidence ELSE GREATEST(confidence, $7) END,
              -- stays flagged only if the new report is also uncertain
              needs_review = CASE WHEN $6 THEN false ELSE needs_review AND $8 END,
              last_report_at = now(),
              updated_at = now()
        WHERE id = $1`,
      [incidentId, reportCount, severity, urgency.score, urgency.reason, reviewedByHuman,
       triage.confidence, triage.needsReview],
    );
    await client.query('UPDATE reports SET incident_id = $1 WHERE id = $2', [incidentId, reportId]);
  });
}

/** Latest reports across all channels (for the "incoming reports" list). */
export async function listRecentReports(limit = 30) {
  return query(
    `SELECT id, source, text, address, reporter, incident_id AS "incidentId", reported_at AS "reportedAt"
       FROM reports ORDER BY reported_at DESC, id DESC LIMIT $1`,
    [limit],
  );
}
