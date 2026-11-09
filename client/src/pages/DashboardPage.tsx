import { useCallback, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Route } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { FeedControl } from '../components/FeedControl';
import { IncidentList } from '../components/IncidentList';
import { IncidentPanel } from '../components/IncidentPanel';
import { MapView } from '../components/MapView';
import { ResourcePanel } from '../components/ResourcePanel';
import { useLiveData } from '../hooks/useLiveData';
import './DashboardPage.css';

/**
 * COMMAND DASHBOARD (SRS 4.8)
 *   left:   incident queue, most urgent first
 *   middle: live map of incidents and units
 *   right:  details of the selected incident, or the unit status panel
 */
export function DashboardPage() {
  const { user } = useAuth();
  const canDispatch = user?.role === 'commander';
  const { incidents, resources, feed, triageMode, loading, error } = useLiveData();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [showShelters, setShowShelters] = useState(true);

  const selectedIncident = incidents.find((i) => i.id === selectedId) ?? null;

  // Draw the road route of a unit to the selected incident.
  const routeRequest = useRef(0);
  const showRoute = useCallback(
    (resourceId: number | null) => {
      const requestId = ++routeRequest.current;
      if (!resourceId || !selectedId) {
        setRoutePath(null);
        return;
      }
      api
        .get<{ route: Route }>(`/dispatch/route?resourceId=${resourceId}&incidentId=${selectedId}`)
        .then(({ route }) => requestId === routeRequest.current && setRoutePath(route.path))
        .catch(() => requestId === routeRequest.current && setRoutePath(null));
    },
    [selectedId],
  );

  // No incident selected = no route to draw.
  const visibleRoute = selectedId === null ? null : routePath;

  if (loading) return <div className="page-message">Loading the control room...</div>;

  return (
    <div className="dashboard">
      <aside className="dashboard-queue">
        {error && <div className="alert alert-error dashboard-alert">{error}</div>}
        <div className="dashboard-tools">
          <FeedControl status={feed} canControl={canDispatch || user?.role === 'admin'} />
          {triageMode === 'rules' && (
            <p className="small muted triage-note">
              Automatic classification is in basic mode (keyword rules), so every new incident is marked for
              checking.
            </p>
          )}
        </div>
        <IncidentList incidents={incidents} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>

      <section className="dashboard-map">
        <MapView
          incidents={incidents}
          resources={resources}
          selectedIncident={selectedIncident}
          onSelectIncident={setSelectedId}
          routePath={visibleRoute}
          showShelters={showShelters}
        />
        <label className="map-toggle">
          <input type="checkbox" checked={showShelters} onChange={(e) => setShowShelters(e.target.checked)} />
          Show shelters
        </label>
      </section>

      <aside className="dashboard-side">
        {selectedId !== null ? (
          <IncidentPanel
            key={selectedId}
            incidentId={selectedId}
            liveIncident={selectedIncident ?? undefined}
            resources={resources}
            canDispatch={canDispatch}
            onClose={() => setSelectedId(null)}
            onShowRoute={showRoute}
          />
        ) : (
          <ResourcePanel resources={resources} />
        )}
      </aside>
    </div>
  );
}
