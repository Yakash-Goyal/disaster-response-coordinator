import { useState } from "react";
import { api } from "../lib/api";
import { statusLabel } from "../lib/format";

/* Admin: resource inventory management (spec 4.4, Admin role). */
const TYPES = ["ambulance", "fire_engine", "personnel", "supply_truck", "shelter"];
const STATUSES = ["available", "en_route", "on_scene", "returning", "out_of_service"];

export default function AdminPanel({ resources, center, onChanged, onError }) {
  const [form, setForm] = useState({
    name: "",
    type: "ambulance",
    lat: center?.[0]?.toFixed(4) ?? "30.7333",
    lng: center?.[1]?.toFixed(4) ?? "76.7794",
    capabilities: "",
    speed_kmh: 45,
  });
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function add() {
    if (!form.name.trim()) {
      onError?.("Give the unit a name before adding it.");
      return;
    }
    setBusy(true);
    try {
      await api.createResource({
        name: form.name.trim(),
        type: form.type,
        lat: parseFloat(form.lat),
        lng: parseFloat(form.lng),
        speed_kmh: parseFloat(form.speed_kmh),
        capabilities: form.capabilities
          .split(",")
          .map((c) => c.trim().toLowerCase().replace(/\s+/g, "_"))
          .filter(Boolean),
      });
      setForm((f) => ({ ...f, name: "", capabilities: "" }));
      onChanged?.();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(resource, status) {
    try {
      await api.updateResource(resource.id, { status });
      onChanged?.();
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function retire(resource) {
    try {
      await api.retireResource(resource.id);
      onChanged?.();
    } catch (err) {
      onError?.(err.message);
    }
  }

  return (
    <div className="analytics">
      <div className="chart-grid">
        <div className="chart-card">
          <h3>Add a unit</h3>
          <div className="field">
            <label className="eyebrow">Name</label>
            <input className="input" value={form.name} onChange={set("name")} placeholder="Ambulance 05" />
          </div>
          <div className="field">
            <label className="eyebrow">Type</label>
            <select className="select" value={form.type} onChange={set("type")}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {statusLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="eyebrow">Latitude</label>
              <input className="input num" value={form.lat} onChange={set("lat")} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label className="eyebrow">Longitude</label>
              <input className="input num" value={form.lng} onChange={set("lng")} />
            </div>
          </div>
          <div className="field">
            <label className="eyebrow">Capabilities</label>
            <input
              className="input"
              value={form.capabilities}
              onChange={set("capabilities")}
              placeholder="trauma kit, paramedic, oxygen"
            />
            <div className="hint">Comma separated. These are matched against what an incident needs.</div>
          </div>
          <div className="field">
            <label className="eyebrow">Speed (km/h)</label>
            <input className="input num" value={form.speed_kmh} onChange={set("speed_kmh")} />
          </div>
          <button className="btn primary" onClick={add} disabled={busy}>
            Add unit
          </button>
        </div>

        <div className="chart-card">
          <h3>Inventory · {resources.length} units</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Type</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    <div className="res-caps">{(r.capabilities || []).join(", ")}</div>
                  </td>
                  <td>{statusLabel(r.type)}</td>
                  <td>
                    <select
                      className="select"
                      style={{ padding: "3px 5px", fontSize: 11.5 }}
                      value={r.status}
                      onChange={(e) => changeStatus(r, e.target.value)}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button className="btn sm ghost danger" onClick={() => retire(r)}>
                      Retire
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
