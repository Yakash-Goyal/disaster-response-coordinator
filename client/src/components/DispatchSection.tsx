import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Candidate, DispatchDecision, Incident, Resource } from '../api/types';
import { clockTime, km, minutes } from '../lib/format';
import { CAPABILITY_LABELS, RESOURCE_TYPE_LABELS } from '../lib/labels';

interface Props {
  incident: Incident;
  decisions: DispatchDecision[];
  resources: Resource[];
  canDispatch: boolean;
  onShowRoute: (resourceId: number | null) => void;
}

/**
 * Everything about sending a unit to the incident:
 *   open        -> ask the Dispatch Agent, then Send / Choose another unit
 *   dispatched  -> "Mark as arrived"
 *   on_scene    -> "Mark as resolved"
 * Nothing is ever dispatched without the commander clicking (human in the loop).
 */
export function DispatchSection({ incident, decisions, resources, canDispatch, onShowRoute }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  const pending = decisions.find((d) => d.humanAction === 'pending') ?? null;
  const lastDecided = decisions.find((d) => d.humanAction === 'accepted' || d.humanAction === 'overridden') ?? null;
  const assigned = incident.assignedUnits;

  // Show the route of the suggested unit, or of the unit already on its way.
  const routeUnitId =
    incident.status === 'open' ? (pending?.recommendedResourceId ?? null)
    : incident.status === 'dispatched' ? (assigned[0]?.id ?? null)
    : null;
  useEffect(() => {
    if (!choosing) onShowRoute(routeUnitId);
  }, [routeUnitId, choosing, onShowRoute]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const askAgent = () =>
    run(async () => {
      const result = await api.post<{ decision: DispatchDecision | null; message: string | null }>(
        `/dispatch/incidents/${incident.id}/recommend`,
      );
      if (!result.decision && result.message) setNotice(result.message);
    });

  const accept = () => run(async () => void (await api.post(`/dispatch/decisions/${pending!.id}/accept`)));

  const setStatus = (status: 'on_scene' | 'resolved') => {
    if (status === 'resolved') {
      const question =
        incident.status === 'open'
          ? 'Close this incident without sending a unit? Use this for false alarms or reports that need no action.'
          : 'Mark this incident as resolved? Assigned units will become available again.';
      if (!window.confirm(question)) return;
    }
    void run(async () => void (await api.post(`/incidents/${incident.id}/status`, { status })));
  };

  return (
    <section className="panel-section">
      <div className="section-title">Response</div>

      {error && <div className="alert alert-error small">{error}</div>}
      {notice && <div className="alert alert-warning small">{notice}</div>}

      {incident.status === 'open' && !pending && (
        <div>
          <p className="small muted">No unit has been suggested yet.</p>
          {canDispatch && (
            <button className="btn btn-primary" onClick={askAgent} disabled={busy}>
              {busy ? 'Finding the best unit...' : 'Find the best unit'}
            </button>
          )}
        </div>
      )}

      {incident.status === 'open' && pending && !choosing && (
        <Recommendation
          decision={pending}
          canDispatch={canDispatch}
          busy={busy}
          onAccept={accept}
          onChooseOther={() => setChoosing(true)}
          onAskAgain={askAgent}
        />
      )}

      {incident.status === 'open' && pending && choosing && (
        <ChooseUnit
          decision={pending}
          resources={resources}
          onShowRoute={onShowRoute}
          onCancel={() => setChoosing(false)}
          onSend={(resourceId, reason) =>
            run(async () => {
              await api.post(`/dispatch/decisions/${pending.id}/override`, { resourceId, reason: reason || undefined });
              setChoosing(false);
            })
          }
          busy={busy}
        />
      )}

      {(incident.status === 'dispatched' || incident.status === 'on_scene') && (
        <div>
          <p>
            <strong>{assigned.map((u) => u.code).join(', ') || 'The unit'}</strong>{' '}
            {incident.status === 'dispatched' ? 'is on the way.' : 'has arrived on scene.'}
          </p>
          {lastDecided && (
            <p className="small muted">
              Sent by {lastDecided.decidedByName ?? 'a commander'}
              {lastDecided.decidedAt && ` at ${clockTime(lastDecided.decidedAt)}`}
              {lastDecided.humanAction === 'accepted' ? ', as suggested by the agent.' : ', instead of the agent’s suggestion.'}
              {lastDecided.overrideReason && ` Reason: "${lastDecided.overrideReason}"`}
            </p>
          )}
          {canDispatch && (
            <div className="action-row">
              {incident.status === 'dispatched' && (
                <button className="btn btn-primary" onClick={() => setStatus('on_scene')} disabled={busy}>
                  Mark as arrived
                </button>
              )}
              <button
                className={`btn ${incident.status === 'on_scene' ? 'btn-primary' : ''}`}
                onClick={() => setStatus('resolved')}
                disabled={busy}
              >
                Mark as resolved
              </button>
            </div>
          )}
        </div>
      )}

      {incident.status === 'open' && canDispatch && !choosing && (
        <p className="small close-without-unit">
          No unit needed?{' '}
          <button className="btn-link" onClick={() => setStatus('resolved')} disabled={busy}>
            Close this incident
          </button>
        </p>
      )}

      {incident.status === 'resolved' && (
        <p className="small">
          Resolved{incident.resolvedAt && ` at ${clockTime(incident.resolvedAt)}`}.
        </p>
      )}
    </section>
  );
}

function capabilityText(caps: string[]) {
  return caps.map((c) => CAPABILITY_LABELS[c] ?? c).join(', ');
}

function Recommendation(props: {
  decision: DispatchDecision;
  canDispatch: boolean;
  busy: boolean;
  onAccept: () => void;
  onChooseOther: () => void;
  onAskAgain: () => void;
}) {
  const { decision, canDispatch, busy } = props;
  const [best, ...others] = decision.recommendation.candidates;

  return (
    <div className="recommendation">
      <div className="recommendation-head">
        <span className="small muted">Suggested by the dispatch agent</span>
        <div className="recommendation-unit">
          <strong>{best.code}</strong> {best.name}
        </div>
        <div className="recommendation-eta">
          {minutes(best.etaSeconds)} by road · {km(best.roadMeters)}
          {best.etaSource === 'estimate' && <span className="faint"> (estimate)</span>}
        </div>
      </div>

      <p className="recommendation-why">{decision.rationale}</p>

      {canDispatch && (
        <div className="action-row">
          <button className="btn btn-primary" onClick={props.onAccept} disabled={busy}>
            Send {best.code}
          </button>
          <button className="btn" onClick={props.onChooseOther} disabled={busy}>
            Choose another unit
          </button>
        </div>
      )}

      {others.length > 0 && (
        <details className="other-options">
          <summary>Other units considered ({others.length})</summary>
          <ul>
            {others.map((c) => (
              <li key={c.resourceId}>
                <strong>{c.code}</strong> · {minutes(c.etaSeconds)} · {km(c.roadMeters)}
                {c.missingCapabilities.length > 0 && (
                  <span className="muted"> · no {capabilityText(c.missingCapabilities)}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {canDispatch && (
        <button className="btn-link small" onClick={props.onAskAgain} disabled={busy}>
          Ask for a fresh suggestion
        </button>
      )}
    </div>
  );
}

function ChooseUnit(props: {
  decision: DispatchDecision;
  resources: Resource[];
  busy: boolean;
  onShowRoute: (resourceId: number | null) => void;
  onCancel: () => void;
  onSend: (resourceId: number, reason: string) => void;
}) {
  const { decision, resources, busy } = props;
  const candidates = decision.recommendation.candidates;
  const recommendedId = decision.recommendedResourceId;

  // Units the agent compared (with real ETAs) first, then every other free unit.
  const candidateIds = new Set(candidates.map((c) => c.resourceId));
  const otherFree = resources.filter(
    (r) => r.status === 'available' && r.type !== 'shelter' && !candidateIds.has(r.id),
  );

  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const select = (id: number) => {
    setSelected(id);
    props.onShowRoute(id);
  };

  const candidateRow = (c: Candidate) => (
    <label key={c.resourceId} className={`unit-option ${selected === c.resourceId ? 'is-selected' : ''}`}>
      <input
        type="radio"
        name="unit"
        checked={selected === c.resourceId}
        disabled={c.resourceId === recommendedId}
        onChange={() => select(c.resourceId)}
      />
      <span>
        <strong>{c.code}</strong> {c.name}
        <span className="small muted">
          {' '}
          · {minutes(c.etaSeconds)} · {km(c.roadMeters)}
          {c.resourceId === recommendedId && ' · suggested'}
          {c.missingCapabilities.length > 0 && ` · no ${capabilityText(c.missingCapabilities)}`}
        </span>
      </span>
    </label>
  );

  return (
    <div className="choose-unit">
      <p className="small muted">Pick the unit you want to send instead.</p>
      <div className="unit-options">
        {candidates.map(candidateRow)}
        {otherFree.length > 0 && <div className="unit-options-divider small muted">Other available units</div>}
        {otherFree.map((r) => (
          <label key={r.id} className={`unit-option ${selected === r.id ? 'is-selected' : ''}`}>
            <input type="radio" name="unit" checked={selected === r.id} onChange={() => select(r.id)} />
            <span>
              <strong>{r.code}</strong> {r.name}
              <span className="small muted"> · {RESOURCE_TYPE_LABELS[r.type]}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="field">
        <label htmlFor="override-reason">Reason (optional)</label>
        <input
          id="override-reason"
          className="input"
          placeholder="e.g. crew already knows the area"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <div className="action-row">
        <button
          className="btn btn-primary"
          disabled={busy || selected === null}
          onClick={() => selected !== null && props.onSend(selected, reason.trim())}
        >
          Send selected unit
        </button>
        <button className="btn" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
