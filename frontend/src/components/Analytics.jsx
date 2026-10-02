import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import { SEVERITY_COLORS, eta, pct, typeLabel } from "../lib/format";

/* After-action view (spec 4.12).

   The headline number is the acceptance rate: how often a commander took the
   agent's recommendation unchanged. It counts only decisions a human actually
   ruled on, so auto-approvals cannot inflate it. */
const AXIS = { stroke: "#5b7189", fontSize: 11 };
const TOOLTIP = {
  contentStyle: {
    background: "#1f2c3a",
    border: "1px solid #2c3d4f",
    borderRadius: 4,
    fontSize: 12,
  },
  labelStyle: { color: "#e2e9f0" },
};

export default function Analytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .analytics()
        .then((d) => alive && setData(d))
        .catch((e) => alive && setError(e.message));
    load();
    const timer = setInterval(load, 10000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="empty">Compiling after-action figures…</div>;

  const byType = Object.entries(data.incidents_by_type).map(([type, count]) => ({
    name: typeLabel(type),
    count,
  }));
  const bySeverity = Object.entries(data.incidents_by_severity).map(([sev, count]) => ({
    name: `Sev ${sev}`,
    count,
    sev: Number(sev),
  }));
  const timings = data.timings
    .filter((t) => t.seconds_to_on_scene !== null)
    .slice(-14)
    .map((t) => ({ name: `#${t.incident_id}`, minutes: +(t.seconds_to_on_scene / 60).toFixed(1) }));

  const judged = data.decisions_accepted + data.decisions_overridden + data.decisions_rejected;

  return (
    <div className="analytics">
      <div className="metric-grid">
        <div className="metric">
          <span className="eyebrow">Agent acceptance</span>
          <b style={{ color: "var(--agent)" }}>{pct(data.agent_acceptance_rate)}</b>
          <small>
            {data.decisions_accepted} accepted of {judged} ruled on
          </small>
        </div>
        <div className="metric">
          <span className="eyebrow">Median to dispatch</span>
          <b>{eta(data.median_seconds_to_dispatch)}</b>
          <small>report filed → unit committed</small>
        </div>
        <div className="metric">
          <span className="eyebrow">Median to on scene</span>
          <b>{eta(data.median_seconds_to_on_scene)}</b>
          <small>report filed → crew arrives</small>
        </div>
        <div className="metric">
          <span className="eyebrow">Reports merged</span>
          <b>{pct(data.dedup_ratio)}</b>
          <small>
            {data.reports_total} reports → {data.incidents_total} incidents
          </small>
        </div>
        <div className="metric">
          <span className="eyebrow">Open now</span>
          <b>{data.incidents_open}</b>
          <small>{data.incidents_resolved} resolved</small>
        </div>
        <div className="metric">
          <span className="eyebrow">Awaiting you</span>
          <b style={{ color: data.decisions_pending ? "var(--warn)" : "var(--text)" }}>
            {data.decisions_pending}
          </b>
          <small>recommendations not yet ruled on</small>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Incidents by type</h3>
          <ResponsiveContainer width="100%" height={205}>
            <BarChart data={byType}>
              <CartesianGrid stroke="#223141" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP} cursor={{ fill: "rgba(127,169,255,0.08)" }} />
              <Bar dataKey="count" fill="#7fa9ff" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Incidents by severity</h3>
          <ResponsiveContainer width="100%" height={205}>
            <BarChart data={bySeverity}>
              <CartesianGrid stroke="#223141" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis allowDecimals={false} {...AXIS} />
              <Tooltip {...TOOLTIP} cursor={{ fill: "rgba(127,169,255,0.08)" }} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {bySeverity.map((row) => (
                  <Cell key={row.name} fill={SEVERITY_COLORS[row.sev] || "#7fa9ff"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {timings.length > 0 && (
          <div className="chart-card">
            <h3>Minutes to on scene</h3>
            <ResponsiveContainer width="100%" height={205}>
              <BarChart data={timings}>
                <CartesianGrid stroke="#223141" vertical={false} />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis {...AXIS} />
                <Tooltip {...TOOLTIP} cursor={{ fill: "rgba(127,169,255,0.08)" }} />
                <Bar dataKey="minutes" fill="#5fbfa0" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="chart-card">
          <h3>Unit utilisation</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Missions</th>
                <th>Committed</th>
              </tr>
            </thead>
            <tbody>
              {data.resource_utilisation.map((r) => (
                <tr key={r.resource_id}>
                  <td>{r.name}</td>
                  <td className="num">{r.missions_completed}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span className="bar">
                        <i style={{ width: `${Math.round(r.utilisation * 100)}%` }} />
                      </span>
                      <span className="num" style={{ fontSize: 11 }}>
                        {pct(r.utilisation)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="hint" style={{ marginTop: 14 }}>
        Acceptance rate counts only recommendations a commander accepted, overrode or rejected.
        Auto-approved and superseded decisions are excluded so the figure cannot flatter the agent.
      </p>
    </div>
  );
}
