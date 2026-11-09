import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DispatchDecision, HistoryEntry, Incident, Report, Resource } from '../api/types';
import { clockTime, shortAddress, timeAgo } from '../lib/format';
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, REPORT_SOURCE_LABELS } from '../lib/labels';
import { ReviewBadge, SeverityBadge } from './Badges';
import { ClassificationReview } from './ClassificationReview';
import { DispatchSection } from './DispatchSection';
import './IncidentPanel.css';

interface Props {
  incidentId: number;
  /** Latest version from the live queue (undefined once the incident is resolved). */
  liveIncident: Incident | undefined;
  resources: Resource[];
  canDispatch: boolean;
  onClose: () => void;
  onShowRoute: (resourceId: number | null) => void;
}

interface Details {
  incident: Incident;
  reports: Report[];
  history: HistoryEntry[];
}

/** Right-hand panel with everything about one incident. */
export function IncidentPanel({ incidentId, liveIncident, resources, canDispatch, onClose, onShowRoute }: Props) {
  const [details, setDetails] = useState<Details | null>(null);
  const [decisions, setDecisions] = useState<DispatchDecision[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reload whenever the live version of this incident changes in a way that matters.
  const refreshKey = liveIncident
    ? `${liveIncident.updatedAt}|${liveIncident.reportCount}|${liveIncident.status}|${liveIncident.pendingDecisionId}`
    : 'resolved';

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get<Details>(`/incidents/${incidentId}`),
      api.get<{ decisions: DispatchDecision[] }>(`/dispatch/incidents/${incidentId}/decisions`),
    ])
      .then(([d, dec]) => {
        if (cancelled) return;
        setDetails(d);
        setDecisions(dec.decisions);
        setError(null);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [incidentId, refreshKey]);

  if (error) {
    return (
      <div className="incident-panel">
        <PanelHeader onClose={onClose} />
        <div className="panel-section alert alert-error">{error}</div>
      </div>
    );
  }
  if (!details) {
    return (
      <div className="incident-panel">
        <PanelHeader onClose={onClose} />
        <div className="page-message">Loading...</div>
      </div>
    );
  }

  const incident = liveIncident ?? details.incident;

  return (
    <div className="incident-panel">
      <PanelHeader onClose={onClose} />

      <section className="panel-section">
        <div className="incident-panel-badges">
          <SeverityBadge severity={incident.severity} />
          <span className="incident-panel-type">{INCIDENT_TYPE_LABELS[incident.type]}</span>
          {incident.needsReview && <ReviewBadge />}
        </div>
        <h2 className="incident-panel-title">{incident.title}</h2>
        <p className="small muted">
          #{incident.id} · {shortAddress(incident.address, 4)}
        </p>
        <p className="small muted">
          First reported {timeAgo(incident.createdAt)} ({clockTime(incident.createdAt)}) ·{' '}
          {incident.reportCount} report{incident.reportCount > 1 ? 's' : ''}
        </p>
        <p className={`incident-panel-status status-${incident.status}`}>{INCIDENT_STATUS_LABELS[incident.status]}</p>
      </section>

      <section className="panel-section">
        <div className="section-title">Priority</div>
        <p>
          <strong>Score {Math.round(incident.urgencyScore)}</strong>
          <span className="muted"> out of 100</span>
        </p>
        <p className="small muted">{incident.urgencyReason}</p>
      </section>

      <ClassificationReview key={`${incident.id}-${incident.updatedAt}`} incident={incident} canEdit={canDispatch} />

      <DispatchSection
        incident={incident}
        decisions={decisions}
        resources={resources}
        canDispatch={canDispatch}
        onShowRoute={onShowRoute}
      />

      <section className="panel-section">
        <div className="section-title">Reports ({details.reports.length})</div>
        <ul className="report-list">
          {details.reports.map((report) => (
            <li key={report.id}>
              <p>{report.text}</p>
              <p className="small muted">
                {REPORT_SOURCE_LABELS[report.source]}
                {report.reporter && ` · ${report.reporter}`} · {clockTime(report.reportedAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <div className="section-title">History</div>
        <ol className="history-list">
          {details.history.map((entry) => (
            <li key={entry.id} className={`history-${entry.actorType}`}>
              <div className="small">
                <strong>{entry.actorName}</strong>
                <span className="faint"> · {clockTime(entry.createdAt)}</span>
              </div>
              <p className="small">{entry.summary}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="incident-panel-header">
      <span className="section-title flush">Incident details</span>
      <button className="btn btn-small" onClick={onClose} aria-label="Close incident details">
        Close
      </button>
    </div>
  );
}
