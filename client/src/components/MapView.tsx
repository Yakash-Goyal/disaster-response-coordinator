import { useEffect } from 'react';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Incident, Resource } from '../api/types';
import { INCIDENT_TYPE_LABELS, RESOURCE_STATUS_LABELS, RESOURCE_TYPE_LABELS, SEVERITY_LABELS } from '../lib/labels';
import { CHENNAI_CENTER, SEVERITY_COLORS, STATUS_COLORS, unitIcon } from '../lib/mapStyle';
import './MapView.css';

interface Props {
  incidents: Incident[];
  resources: Resource[];
  selectedIncident: Incident | null;
  onSelectIncident: (id: number) => void;
  routePath: [number, number][] | null;
  showShelters: boolean;
}

/** Moves the map to the selected incident. */
function FocusOnIncident({ incident }: { incident: Incident | null }) {
  const map = useMap();
  const lat = incident?.lat;
  const lng = incident?.lng;
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.panTo([lat, lng]);
  }, [map, lat, lng]);
  return null;
}

export function MapView({ incidents, resources, selectedIncident, onSelectIncident, routePath, showShelters }: Props) {
  const visibleResources = showShelters ? resources : resources.filter((r) => r.type !== 'shelter');

  return (
    <div className="map-wrap">
      <MapContainer center={CHENNAI_CENTER} zoom={12} className="map" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {routePath && (
          <Polyline positions={routePath} pathOptions={{ color: '#1f4fa8', weight: 4, opacity: 0.75, dashArray: '8 6' }} />
        )}

        {visibleResources.map((resource) => (
          <Marker key={`r${resource.id}`} position={[resource.lat, resource.lng]} icon={unitIcon(resource)}>
            <Tooltip direction="top" offset={[0, -10]}>
              <strong>{resource.code}</strong> · {RESOURCE_TYPE_LABELS[resource.type]}
              <br />
              {RESOURCE_STATUS_LABELS[resource.status]}
            </Tooltip>
          </Marker>
        ))}

        {incidents.map((incident) => {
          const selected = incident.id === selectedIncident?.id;
          return (
            <CircleMarker
              key={`i${incident.id}`}
              center={[incident.lat, incident.lng]}
              radius={8 + Math.min(incident.reportCount, 6) * 1.5}
              pathOptions={{
                color: selected ? '#111827' : '#ffffff',
                weight: selected ? 3 : 2,
                fillColor: SEVERITY_COLORS[incident.severity],
                fillOpacity: 0.9,
              }}
              eventHandlers={{ click: () => onSelectIncident(incident.id) }}
            >
              <Tooltip direction="top" offset={[0, -8]}>
                <strong>{INCIDENT_TYPE_LABELS[incident.type]}</strong>
                {incident.reportCount > 1 && ` · ${incident.reportCount} reports`}
                <br />
                {incident.title}
              </Tooltip>
            </CircleMarker>
          );
        })}

        <FocusOnIncident incident={selectedIncident} />
      </MapContainer>

      <div className="map-legend">
        <div className="legend-group">
          <span className="legend-title">Incidents</span>
          {[5, 4, 3, 2].map((s) => (
            <span key={s} className="legend-item">
              <span className="legend-circle" style={{ background: SEVERITY_COLORS[s] }} />
              {SEVERITY_LABELS[s]}
            </span>
          ))}
        </div>
        <div className="legend-group">
          <span className="legend-title">Units</span>
          {(['available', 'en_route', 'on_scene', 'out_of_service'] as const).map((s) => (
            <span key={s} className="legend-item">
              <span className="legend-square" style={{ background: STATUS_COLORS[s] }} />
              {RESOURCE_STATUS_LABELS[s]}
            </span>
          ))}
        </div>
        <div className="legend-group faint">A ambulance · T team · S supply truck · H shelter</div>
      </div>
    </div>
  );
}
