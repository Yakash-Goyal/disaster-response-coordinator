import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { eta, km, typeLabel } from "../lib/format";

/* The approval surface (spec 4.5 / 4.7 / NFR "Human override").

   Nothing here dispatches on its own. The agent's pick, its reasoning and the
   alternatives it weighed are all shown together, because a commander who
   cannot see what was rejected cannot meaningfully override. */
export default function DecisionPanel({ incident, decision, resources, onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [showOverride, setShowOverride] = useState(false);

  useEffect(() => {
    setNote("");
    setShowOverride(false);
    setCandidates(null);
  }, [decision?.id]);

  if (!incident) {
    return <div className="empty">Select an incident to see what the agents recommend.</div>;
  }

  async function act(action, resourceId) {
    setBusy(true);
    try {
      await api.actOnDecision(decision.id, action, resourceId, note || null);
      onDone?.();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function requestRecommendation() {
    setBusy(true);
    try {
      await api.recommend(incident.id, true);
      onDone?.();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates() {
    setShowOverride(true);
    try {
      setCandidates(await api.candidates(incident.id));
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function resolve() {
    setBusy(true);
    try {
      await api.resolveIncident(incident.id);
      onDone?.();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  const pending = decision && decision.human_action === "pending";
  const rec = decision?.agent_recommendation || {};

  return (
    <div style={{ padding: "0 0 12px" }}>
      <div style={{ padding: "11px 12px", borderBottom: "1px solid var(--line)" }}>
        <div className="queue-top">
          <span className="queue-id">#{incident.id}</span>
          <span className={`queue-type sev-${incident.severity}`}>{typeLabel(incident.type)}</span>
          <span className="badge">SEV {incident.severity}</span>
        </div>
        <div style={{ color: "var(--text-2)", fontSize: 12.5, marginTop: 4 }}>{incident.summary}</div>
        <div className="queue-meta">
          <span className="badge">{incident.report_count} REPORT(S)</span>
          <span className="badge agent">
            TRIAGE {Math.round((incident.triage_confidence || 0) * 100)}%
          </span>
          <span className="badge">{incident.triage_source.toUpperCase()}</span>
          {incident.needs_review && <span className="badge warn">NEEDS REVIEW</span>}
        </div>
        {!!(incident.required_capabilities || []).length && (
          <div className="hint">Needs: {incident.required_capabilities.join(", ")}</div>
        )}
      </div>

      {!decision && (
        <div style={{ padding: 12 }}>
          <div className="empty" style={{ padding: "14px 0" }}>
            No recommendation yet for this incident.
          </div>
          <button className="btn" onClick={requestRecommendation} disabled={busy}>
            Ask the dispatch agent
          </button>
        </div>
      )}

      {decision && (
        <div className="decision">
          <div className="decision-head">
            <span className="badge agent">DISPATCH AGENT</span>
            <span className="badge">{Math.round((decision.confidence || 0) * 100)}% CONFIDENT</span>
          </div>

          <div className="decision-unit">{rec.resource_name || `Unit ${decision.resource_id}`}</div>

          <div className="facts">
            <div className="fact">
              <div className="eyebrow">ETA</div>
              <b>{eta(decision.eta_seconds)}</b>
            </div>
            <div className="fact">
              <div className="eyebrow">Distance</div>
              <b>{km(decision.distance_m)}</b>
            </div>
            <div className="fact">
              <div className="eyebrow">Match</div>
              <b>{Math.round((rec.capability_match ?? 0) * 100)}%</b>
            </div>
          </div>

          <div className="rationale">{decision.rationale}</div>

          {decision.escalation_reason && pending && (
            <div className="escalation">{decision.escalation_reason}</div>
          )}

          {!!(decision.alternatives || []).length && (
            <div className="alts">
              <div className="eyebrow" style={{ marginBottom: 4 }}>Also considered</div>
              {decision.alternatives.map((alt) => (
                <div className="alt" key={alt.resource_id}>
                  <span className="alt-name">{alt.resource_name}</span>
                  <span className="num" style={{ color: "var(--muted)" }}>{eta(alt.eta_seconds)}</span>
                  {pending && (
                    <button
                      className="btn sm ghost"
                      disabled={busy}
                      onClick={() => act("override", alt.resource_id)}
                    >
                      Send this
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {pending ? (
            <>
              <input
                className="input"
                style={{ marginTop: 9 }}
                placeholder="Note for the log (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="actions">
                <button className="btn primary" disabled={busy} onClick={() => act("accept")}>
                  Approve
                </button>
                <button className="btn" disabled={busy} onClick={loadCandidates}>
                  Override
                </button>
                <button className="btn ghost danger" disabled={busy} onClick={() => act("reject")}>
                  Reject
                </button>
              </div>
            </>
          ) : (
            <div className="actions">
              <span className={`badge ${decision.human_action === "accepted" ? "ok" : "human"}`}>
                {decision.human_action.toUpperCase()}
              </span>
            </div>
          )}

          {showOverride && (
            <div className="alts">
              <div className="eyebrow" style={{ marginBottom: 5 }}>
                Every unit the agent scored
              </div>
              {!candidates && <div className="hint">Scoring candidates…</div>}
              {candidates?.length === 0 && <div className="hint">No available unit is in range.</div>}
              {(candidates || []).map((c) => (
                <div className="alt" key={c.resource_id}>
                  <span className="alt-name">
                    {c.resource_name}
                    <div className="res-caps">{(c.capabilities || []).join(", ") || "no special kit"}</div>
                  </span>
                  <span className="num" style={{ color: "var(--muted)" }}>{eta(c.eta_seconds)}</span>
                  <button
                    className="btn sm"
                    disabled={busy}
                    onClick={() => act("override", c.resource_id)}
                  >
                    Send
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: "0 12px" }}>
        <button className="btn ghost" onClick={resolve} disabled={busy}>
          Mark incident resolved
        </button>
      </div>
    </div>
  );
}
