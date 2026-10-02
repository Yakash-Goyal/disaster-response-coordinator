import { eta, statusLabel } from "../lib/format";

/* Resource status board (spec 4.4 / 4.8). Grouped by status so the number a
   commander actually needs — how many units are free right now — is the first
   thing on screen rather than something to count. */
const ORDER = ["available", "en_route", "on_scene", "returning", "out_of_service"];

export default function ResourcePanel({ resources, onFocus }) {
  const groups = ORDER.map((status) => [status, resources.filter((r) => r.status === status)]).filter(
    ([, list]) => list.length
  );
  const free = resources.filter((r) => r.status === "available" && r.type !== "shelter").length;

  return (
    <>
      <div className="panel-head">
        <span className="eyebrow">Units</span>
        <span className="badge ok">{free} AVAILABLE</span>
        <span className="badge">{resources.length} TOTAL</span>
      </div>
      <div className="panel-body">
        {groups.map(([status, list]) => (
          <div key={status}>
            <div
              className="eyebrow"
              style={{ padding: "7px 12px 3px", background: "var(--panel)", fontSize: 10.5 }}
            >
              {statusLabel(status)} · {list.length}
            </div>
            {list.map((r) => (
              <div className="res-row" key={r.id} onClick={() => onFocus?.(r)}>
                <span className="res-name">
                  {r.name}
                  <div className="res-caps">{(r.capabilities || []).slice(0, 3).join(" · ")}</div>
                </span>
                {r.incident_id && <span className="badge">#{r.incident_id}</span>}
                {r.eta_seconds > 0 && r.status === "en_route" && (
                  <span className="num" style={{ fontSize: 11.5, color: "var(--agent)" }}>
                    {eta(r.eta_seconds)}
                  </span>
                )}
                <span className={`status-pill s-${r.status}`}>{statusLabel(r.status)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
