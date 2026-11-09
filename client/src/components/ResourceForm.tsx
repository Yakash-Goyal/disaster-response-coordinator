import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Resource, ResourceStatus, ResourceType } from '../api/types';
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  RESOURCE_STATUSES,
  RESOURCE_STATUS_LABELS,
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
} from '../lib/labels';
import { LocationPicker, type Point } from './LocationPicker';

interface Props {
  resource: Resource | null; // null = adding a new one
  onDone: () => void;
  onCancel: () => void;
}

/** Add or edit a resource (admin, SRS 4.4). */
export function ResourceForm({ resource, onDone, onCancel }: Props) {
  const [code, setCode] = useState(resource?.code ?? '');
  const [name, setName] = useState(resource?.name ?? '');
  const [type, setType] = useState<ResourceType>(resource?.type ?? 'ambulance');
  const [status, setStatus] = useState<ResourceStatus>(resource?.status ?? 'available');
  const [homeBase, setHomeBase] = useState(resource?.homeBase ?? '');
  const [capacity, setCapacity] = useState(String(resource?.capacity ?? 1));
  const [currentLoad, setCurrentLoad] = useState(String(resource?.currentLoad ?? 0));
  const [capabilities, setCapabilities] = useState<string[]>(resource?.capabilities ?? []);
  const [point, setPoint] = useState<Point | null>(resource ? { lat: resource.lat, lng: resource.lng } : null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBusy = Boolean(resource?.assignedIncidentId);

  const toggleCapability = (cap: string) =>
    setCapabilities((list) => (list.includes(cap) ? list.filter((c) => c !== cap) : [...list, cap]));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!point) {
      setError('Please click on the map to set the location.');
      return;
    }
    const body = {
      code: code.trim(),
      name: name.trim(),
      type,
      status,
      homeBase: homeBase.trim(),
      capacity: Number(capacity),
      currentLoad: Number(currentLoad),
      capabilities: type === 'shelter' ? [] : capabilities,
      lat: point.lat,
      lng: point.lng,
    };
    if (!Number.isInteger(body.capacity) || !Number.isInteger(body.currentLoad)) {
      setError('Capacity and current load must be whole numbers.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (resource) await api.put(`/resources/${resource.id}`, body);
      else await api.post('/resources', body);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const capacityHint: Record<ResourceType, string> = {
    ambulance: 'Patients it can carry',
    personnel: 'People in the team',
    supply_truck: 'Relief kits it can carry',
    shelter: 'People it can house',
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className="drawer-title">{resource ? `Edit ${resource.code}` : 'Add a resource'}</h2>
      {error && <div className="alert alert-error drawer-error">{error}</div>}

      <div className="row">
        <div className="field">
          <label htmlFor="rf-code">Code</label>
          <input id="rf-code" className="input" placeholder="AMB-10" value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rf-type">Type</label>
          <select id="rf-type" className="select" value={type} onChange={(e) => setType(e.target.value as ResourceType)}>
            {RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RESOURCE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="rf-name">Name</label>
        <input id="rf-name" className="input" placeholder="Ambulance 10" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="rf-base">Home base / area</label>
          <input id="rf-base" className="input" placeholder="Egmore" value={homeBase} onChange={(e) => setHomeBase(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rf-status">Status</label>
          <select
            id="rf-status"
            className="select"
            value={status}
            disabled={isBusy}
            onChange={(e) => setStatus(e.target.value as ResourceStatus)}
          >
            {RESOURCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RESOURCE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {isBusy && <span className="hint">Locked while assigned to incident #{resource!.assignedIncidentId}.</span>}
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="rf-cap">Capacity</label>
          <input id="rf-cap" className="input" type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          <span className="hint">{capacityHint[type]}</span>
        </div>
        <div className="field">
          <label htmlFor="rf-load">Currently in use</label>
          <input id="rf-load" className="input" type="number" min={0} value={currentLoad} onChange={(e) => setCurrentLoad(e.target.value)} />
          <span className="hint">How much of the capacity is taken</span>
        </div>
      </div>

      {type !== 'shelter' && (
        <div className="field">
          <label>Equipment / capabilities</label>
          <div className="capability-grid">
            {CAPABILITIES.map((cap) => (
              <label key={cap} className="checkbox-label">
                <input type="checkbox" checked={capabilities.includes(cap)} onChange={() => toggleCapability(cap)} />
                {CAPABILITY_LABELS[cap]}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>Location</label>
        <LocationPicker value={point} onPick={setPoint} height={220} />
        <span className="hint">Click on the map to set where the resource is.</span>
      </div>

      <div className="action-row">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving...' : resource ? 'Save changes' : 'Add resource'}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
