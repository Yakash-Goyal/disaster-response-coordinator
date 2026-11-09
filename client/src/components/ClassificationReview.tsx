import { useState } from 'react';
import { api } from '../api/client';
import type { Incident, IncidentType } from '../api/types';
import { INCIDENT_TYPES, INCIDENT_TYPE_LABELS, SEVERITY_LABELS } from '../lib/labels';

const METHOD_LABELS: Record<Incident['classifiedBy'], string> = {
  ai: 'Classified by the AI triage agent',
  rules: 'Classified by keyword rules (AI not used)',
  commander: 'Checked by a commander',
};

/**
 * Shows how the incident was classified and lets the commander confirm or
 * correct it. Uncertain results are highlighted (SRS 4.2: low-confidence
 * classifications go to a human instead of being silently accepted).
 */
export function ClassificationReview({ incident, canEdit }: { incident: Incident; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<IncidentType>(incident.type);
  const [severity, setSeverity] = useState(incident.severity);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (values: { type: IncidentType; severity: number }) => {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/incidents/${incident.id}/classification`, values);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    setType(incident.type);
    setSeverity(incident.severity);
    setEditing(true);
  };

  const confidence =
    incident.classifiedBy === 'commander' ? null : `${Math.round(incident.confidence * 100)}% sure`;
  const isResolved = incident.status === 'resolved';

  return (
    <section className={`panel-section ${incident.needsReview ? 'needs-review' : ''}`}>
      <div className="section-title">Classification</div>
      <p className="small">
        <strong>{METHOD_LABELS[incident.classifiedBy]}</strong>
        {confidence && <span className="muted"> · {confidence}</span>}
      </p>
      {incident.classifiedBy !== 'commander' && <p className="small muted reason-text">{incident.triageReason}</p>}

      {error && <div className="alert alert-error small">{error}</div>}

      {canEdit && !isResolved && !editing && (
        <div className="review-actions">
          {incident.needsReview && <p className="small review-question">Is this classification correct?</p>}
          {incident.needsReview && (
            <button
              className="btn btn-small"
              disabled={saving}
              onClick={() => save({ type: incident.type, severity: incident.severity })}
            >
              Yes, looks right
            </button>
          )}
          <button className="btn btn-small" onClick={startEditing} disabled={saving}>
            {incident.needsReview ? 'No, change it' : 'Change'}
          </button>
        </div>
      )}

      {editing && (
        <div className="review-form">
          <div className="row">
            <div className="field">
              <label htmlFor="rev-type">Type</label>
              <select
                id="rev-type"
                className="select"
                value={type}
                onChange={(e) => setType(e.target.value as IncidentType)}
              >
                {INCIDENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {INCIDENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rev-sev">Severity</label>
              <select
                id="rev-sev"
                className="select"
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
              >
                {[5, 4, 3, 2, 1].map((s) => (
                  <option key={s} value={s}>
                    {s} - {SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="review-actions">
            <button className="btn btn-primary btn-small" disabled={saving} onClick={() => save({ type, severity })}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button className="btn btn-small" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
