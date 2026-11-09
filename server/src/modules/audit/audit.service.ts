import { query } from '../../db/pool';

/**
 * Audit trail (SRS 4.7 / 5): every agent decision and every human response
 * is written here with a timestamp, so anyone can later see who decided
 * what, when, and why.
 */
export interface AuditEntry {
  actorType: 'agent' | 'human' | 'system';
  actorName: string;
  action: string;
  entityType?: 'incident' | 'resource' | 'report' | 'dispatch_decision' | 'user';
  entityId?: number;
  summary: string;
  details?: Record<string, unknown>;
}

export interface AuditRow {
  id: number;
  actorType: string;
  actorName: string;
  action: string;
  entityType: string | null;
  entityId: number | null;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  await query(
    `INSERT INTO audit_log (actor_type, actor_name, action, entity_type, entity_id, summary, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.actorType,
      entry.actorName,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      entry.summary,
      entry.details ?? {},
    ],
  );
}

const AUDIT_COLUMNS = `
  id, actor_type AS "actorType", actor_name AS "actorName", action,
  entity_type AS "entityType", entity_id AS "entityId", summary, details,
  created_at AS "createdAt"`;

/** History of one incident: its own entries plus those of its reports and dispatch decisions. */
export async function getIncidentHistory(incidentId: number): Promise<AuditRow[]> {
  return query<AuditRow>(
    `SELECT ${AUDIT_COLUMNS}
       FROM audit_log
      WHERE (entity_type = 'incident' AND entity_id = $1)
         OR (entity_type = 'dispatch_decision'
             AND entity_id IN (SELECT id FROM dispatch_decisions WHERE incident_id = $1))
         OR (entity_type = 'report'
             AND entity_id IN (SELECT id FROM reports WHERE incident_id = $1))
      ORDER BY created_at ASC, id ASC`,
    [incidentId],
  );
}
