import { useState } from 'react';
import type { Incident } from '../api/types';
import { useNow } from '../hooks/useNow';
import { shortAddress, timeAgo } from '../lib/format';
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS } from '../lib/labels';
import { ReviewBadge, SeverityBadge } from './Badges';
import './IncidentList.css';

interface Props {
  incidents: Incident[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

/** The incident queue: every active incident, most urgent at the top (SRS 4.3). */
export function IncidentList({ incidents, selectedId, onSelect }: Props) {
  const now = useNow();
  const [onlyReview, setOnlyReview] = useState(false);
  const [onlyWaiting, setOnlyWaiting] = useState(false);

  const reviewCount = incidents.filter((i) => i.needsReview).length;
  const waitingCount = incidents.filter((i) => i.status === 'open').length;
  const shown = incidents.filter(
    (i) => (!onlyReview || i.needsReview) && (!onlyWaiting || i.status === 'open'),
  );

  return (
    <div className="incident-list">
      <div className="incident-list-header">
        <h2>
          Active incidents <span className="faint">({incidents.length})</span>
        </h2>
        <div className="incident-filters">
          <label>
            <input type="checkbox" checked={onlyWaiting} onChange={(e) => setOnlyWaiting(e.target.checked)} />
            Waiting for a unit ({waitingCount})
          </label>
          <label>
            <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
            Needs checking ({reviewCount})
          </label>
        </div>
      </div>

      <ul className="incident-items">
        {shown.length === 0 && (
          <li className="incident-empty">
            {incidents.length === 0
              ? 'No active incidents. New reports will appear here automatically.'
              : 'No incidents match these filters.'}
          </li>
        )}

        {shown.map((incident, index) => (
          <li key={incident.id}>
            <button
              className={`incident-item ${incident.id === selectedId ? 'is-selected' : ''} sev-${incident.severity}`}
              onClick={() => onSelect(incident.id)}
            >
              <div className="incident-item-top">
                <span className="incident-rank" title="Position in the queue">
                  {index + 1}
                </span>
                <SeverityBadge severity={incident.severity} />
                <span className="incident-type">{INCIDENT_TYPE_LABELS[incident.type]}</span>
                <span className="incident-score" title={incident.urgencyReason}>
                  {Math.round(incident.urgencyScore)}
                </span>
              </div>

              <div className="incident-title">{incident.title}</div>

              <div className="incident-meta">
                <span>{shortAddress(incident.address, 2)}</span>
                <span>·</span>
                <span>{timeAgo(incident.createdAt, now)}</span>
                {incident.reportCount > 1 && (
                  <>
                    <span>·</span>
                    <span>{incident.reportCount} reports</span>
                  </>
                )}
              </div>

              <div className="incident-item-bottom">
                <span className={`incident-status status-${incident.status}`}>
                  {INCIDENT_STATUS_LABELS[incident.status]}
                  {incident.assignedUnits.length > 0 && `: ${incident.assignedUnits.map((u) => u.code).join(', ')}`}
                </span>
                {incident.needsReview && <ReviewBadge />}
                {incident.status === 'open' && incident.pendingDecisionId && (
                  <span className="badge badge-neutral">Unit suggested</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
