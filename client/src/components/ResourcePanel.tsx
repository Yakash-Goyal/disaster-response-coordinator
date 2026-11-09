import type { Resource, ResourceStatus } from '../api/types';
import { RESOURCE_STATUSES, RESOURCE_STATUS_LABELS, RESOURCE_TYPES, RESOURCE_TYPE_PLURALS } from '../lib/labels';
import { StatusBadge } from './Badges';
import './ResourcePanel.css';

/** Resource status panel (SRS 4.8): who is free, on the way, on scene, or out of service. */
export function ResourcePanel({ resources }: { resources: Resource[] }) {
  const units = resources.filter((r) => r.type !== 'shelter');
  const shelters = resources.filter((r) => r.type === 'shelter');

  const countBy = (status: ResourceStatus) => units.filter((r) => r.status === status).length;

  return (
    <div className="resource-panel">
      <section className="panel-section">
        <h2>Units</h2>
        <div className="status-counts">
          {RESOURCE_STATUSES.map((status) => (
            <div key={status} className={`status-count st-${status}`}>
              <span className="status-count-number">{countBy(status)}</span>
              <span className="status-count-label">{RESOURCE_STATUS_LABELS[status]}</span>
            </div>
          ))}
        </div>
        <p className="small muted panel-hint">Select an incident on the left or on the map to see details.</p>
      </section>

      {RESOURCE_TYPES.filter((t) => t !== 'shelter').map((type) => {
        const ofType = units.filter((r) => r.type === type);
        if (ofType.length === 0) return null;
        return (
          <section key={type} className="panel-section">
            <div className="section-title">
              {RESOURCE_TYPE_PLURALS[type]} ({ofType.filter((r) => r.status === 'available').length} of {ofType.length}{' '}
              free)
            </div>
            <ul className="unit-list">
              {ofType.map((r) => (
                <li key={r.id}>
                  <span className="unit-code">{r.code}</span>
                  <span className="unit-name">{r.homeBase || r.name}</span>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {shelters.length > 0 && (
        <section className="panel-section">
          <div className="section-title">Shelters</div>
          <ul className="unit-list">
            {shelters.map((s) => {
              const full = s.capacity > 0 ? s.currentLoad / s.capacity : 0;
              return (
                <li key={s.id}>
                  <span className="unit-code">{s.code}</span>
                  <span className="unit-name">{s.homeBase || s.name}</span>
                  <span className={`small ${full >= 0.9 ? 'text-danger' : 'muted'}`}>
                    {s.currentLoad} / {s.capacity} people
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
