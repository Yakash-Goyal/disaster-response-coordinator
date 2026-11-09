import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Resource } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { StatusBadge } from '../components/Badges';
import { RESOURCE_TYPE_LABELS } from '../lib/labels';
import './ResponderPage.css';

/**
 * FIELD RESPONDER VIEW (SRS 4.9)
 * Mid-term version: shows the responder's unit and whether it has a task.
 * The full mobile view (incident details, route, status buttons) is
 * planned for the end-term phase.
 */
export function ResponderPage() {
  const { user } = useAuth();
  const resourceId = user?.resourceId ?? null;
  const [unit, setUnit] = useState<Resource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(resourceId !== null);

  const load = useCallback(async () => {
    if (resourceId === null) return;
    try {
      const data = await api.get<{ resource: Resource }>(`/resources/${resourceId}`);
      setUnit(data.resource);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="page-message">Loading...</div>;

  return (
    <div className="responder-page">
      <h1>Hello, {user?.name.split(' ')[0]}</h1>

      {error && <div className="alert alert-error">{error}</div>}

      {resourceId === null && (
        <div className="alert alert-info">You are not linked to a unit yet. Please contact the administrator.</div>
      )}

      {unit && (
        <div className="card card-body responder-unit">
          <div className="small muted">Your unit</div>
          <div className="responder-unit-name">
            <strong>{unit.code}</strong> {unit.name}
          </div>
          <div className="small muted">{RESOURCE_TYPE_LABELS[unit.type]}</div>
          <div className="responder-status">
            <StatusBadge status={unit.status} />
          </div>
          <p>
            {unit.assignedIncidentId
              ? `Your unit has been sent to incident #${unit.assignedIncidentId}. Follow the control room's instructions.`
              : 'No task assigned at the moment.'}
          </p>
          <button className="btn" onClick={load}>
            Refresh
          </button>
        </div>
      )}

      <p className="small muted responder-note">
        Coming next: incident details, the road route, and buttons to report "arrived" and "resolved" from your phone.
      </p>
    </div>
  );
}
