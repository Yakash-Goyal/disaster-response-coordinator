import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Resource, ResourceStatus, ResourceType } from '../api/types';
import { StatusBadge } from '../components/Badges';
import { ResourceForm } from '../components/ResourceForm';
import { useSocket } from '../hooks/SocketContext';
import {
  CAPABILITY_LABELS,
  RESOURCE_STATUSES,
  RESOURCE_STATUS_LABELS,
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
} from '../lib/labels';
import './ResourcesPage.css';

/** RESOURCE INVENTORY (SRS 4.4): admins add, edit and retire resources. */
export function ResourcesPage() {
  const { socket } = useSocket();
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<ResourceType | ''>('');
  const [statusFilter, setStatusFilter] = useState<ResourceStatus | ''>('');
  const [search, setSearch] = useState('');
  const [showRetired, setShowRetired] = useState(false);

  // null = closed, 'new' = add form, Resource = edit form
  const [editing, setEditing] = useState<Resource | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ resources: Resource[] }>('/resources?includeRetired=true');
      setResources(data.resources);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the table current when units change elsewhere (e.g. a dispatch).
  useEffect(() => {
    if (!socket) return;
    const onUpdate = (updated: Resource) =>
      setResources((list) =>
        list.some((r) => r.id === updated.id) ? list.map((r) => (r.id === updated.id ? updated : r)) : [...list, updated],
      );
    socket.on('resource:updated', onUpdate);
    return () => {
      socket.off('resource:updated', onUpdate);
    };
  }, [socket]);

  const toggleRetired = async (resource: Resource) => {
    const retiring = !resource.retiredAt;
    if (retiring && !window.confirm(`Retire ${resource.code}? It will no longer be suggested for dispatch.`)) return;
    setActionError(null);
    try {
      await api.post(`/resources/${resource.id}/${retiring ? 'retire' : 'restore'}`);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const query = search.trim().toLowerCase();
  const shown = resources
    .filter((r) => showRetired || !r.retiredAt)
    .filter((r) => !typeFilter || r.type === typeFilter)
    .filter((r) => !statusFilter || r.status === statusFilter)
    .filter(
      (r) =>
        !query ||
        r.code.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query) ||
        r.homeBase.toLowerCase().includes(query),
    )
    .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code));

  if (loading) return <div className="page-message">Loading resources...</div>;

  return (
    <div className="resources-page">
      <div className="resources-header">
        <div>
          <h1>Resources</h1>
          <p className="muted">Ambulances, response teams, supply trucks and shelters available to the control room.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          Add resource
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {actionError && <div className="alert alert-error">{actionError}</div>}

      <div className="resources-filters">
        <input
          className="input"
          placeholder="Search by code, name or area"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ResourceType | '')}>
          <option value="">All types</option>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {RESOURCE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ResourceStatus | '')}
        >
          <option value="">All statuses</option>
          {RESOURCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {RESOURCE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <label className="checkbox-label">
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired
        </label>
      </div>

      <div className="card resources-table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Status</th>
              <th>In use</th>
              <th>Equipment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No resources match these filters.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className={r.retiredAt ? 'is-retired' : ''}>
                <td>
                  <strong>{r.code}</strong>
                </td>
                <td>
                  {r.name}
                  {r.homeBase && <div className="small muted">{r.homeBase}</div>}
                </td>
                <td>{RESOURCE_TYPE_LABELS[r.type]}</td>
                <td>
                  {r.retiredAt ? <span className="badge badge-neutral">Retired</span> : <StatusBadge status={r.status} />}
                  {r.assignedIncidentId && <div className="small muted">Incident #{r.assignedIncidentId}</div>}
                </td>
                <td>
                  {r.currentLoad} / {r.capacity}
                </td>
                <td className="small">
                  {r.capabilities.length ? r.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(', ') : '-'}
                </td>
                <td className="table-actions">
                  {!r.retiredAt && (
                    <button className="btn btn-small" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                  )}
                  <button className={`btn btn-small ${r.retiredAt ? '' : 'btn-danger'}`} onClick={() => toggleRetired(r)}>
                    {r.retiredAt ? 'Bring back' : 'Retire'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="drawer-backdrop">
          <div className="drawer" role="dialog" aria-modal="true">
            <ResourceForm
              key={editing === 'new' ? 'new' : editing.id}
              resource={editing === 'new' ? null : editing}
              onDone={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
