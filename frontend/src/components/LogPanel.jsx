import { clock } from "../lib/format";

/* Audit trail (NFR "Auditability").

   Agent entries are blue, human entries amber. Reading down the column tells
   you at a glance how much of the response was machine-proposed and how much
   a person changed — which is the question the after-action report asks. */
const AGENT_CLASS = {
  triage: "agent",
  dispatch: "agent",
  routing: "agent",
  supervisor: "agent",
  simulation: "",
  human: "human",
  responder: "human",
};

export default function LogPanel({ logs, filterIncident, onClearFilter }) {
  const rows = filterIncident ? logs.filter((l) => l.incident_id === filterIncident) : logs;

  return (
    <>
      <div className="panel-head">
        <span className="eyebrow">Decision log</span>
        {filterIncident && (
          <button className="btn sm ghost" onClick={onClearFilter}>
            #{filterIncident} only ✕
          </button>
        )}
      </div>
      <div className="panel-body">
        {!rows.length && <div className="empty">Nothing logged yet.</div>}
        {rows.map((log) => (
          <div className={`log-row${log.escalated ? " escalated" : ""}`} key={log.id}>
            <span className="log-time">{clock(log.created_at)}</span>
            <span className="log-body">
              <span className={`badge ${AGENT_CLASS[log.agent] ?? ""}`}>{log.agent.toUpperCase()}</span>{" "}
              {log.detail}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
