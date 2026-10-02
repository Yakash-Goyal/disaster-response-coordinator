import { typeLabel, ago } from "../lib/format";

/* The ranked queue (spec 4.3).

   Each row carries an urgency spine on its left edge whose fill height is the
   incident's current urgency score. Because urgency includes an ageing term,
   an unanswered incident visibly climbs its own gutter while you watch — the
   one thing a plain sorted list cannot show you. */
export default function IncidentQueue({ incidents, decisions, selectedId, onSelect }) {
  const pendingByIncident = new Map(
    decisions.filter((d) => d.human_action === "pending").map((d) => [d.incident_id, d])
  );

  if (!incidents.length) {
    return <div className="empty">Queue is clear. New reports appear here the moment they are triaged.</div>;
  }

  return (
    <div>
      {incidents.map((incident) => {
        const awaiting = pendingByIncident.has(incident.id);
        const fill = Math.max(4, Math.min(100, incident.urgency_score || 0));
        return (
          <button
            key={incident.id}
            className={`queue-row${selectedId === incident.id ? " selected" : ""}${
              awaiting ? " awaiting" : ""
            }`}
            onClick={() => onSelect(incident.id)}
            aria-current={selectedId === incident.id}
          >
            <span className="spine" aria-hidden="true">
              <i className={`bg-sev-${incident.severity}`} style={{ height: `${fill}%` }} />
            </span>

            <span className="queue-top">
              <span className="queue-id">#{incident.id}</span>
              <span className={`queue-type sev-${incident.severity}`}>{typeLabel(incident.type)}</span>
              <span className={`queue-score sev-${incident.severity}`}>
                {Math.round(incident.urgency_score || 0)}
              </span>
            </span>

            <div className="queue-summary">{incident.summary}</div>

            <div className="queue-meta">
              <span className="badge">SEV {incident.severity}</span>
              {incident.report_count > 1 && (
                <span className="badge">{incident.report_count} REPORTS</span>
              )}
              {incident.needs_review && <span className="badge warn">REVIEW</span>}
              {awaiting && <span className="badge agent">AWAITING YOU</span>}
              {incident.status !== "pending" && !awaiting && (
                <span className="badge">{incident.status.replace(/_/g, " ").toUpperCase()}</span>
              )}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--faint)" }}>
                {ago(incident.created_at)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
