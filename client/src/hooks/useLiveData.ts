import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { FeedStatus, Incident, Resource } from '../api/types';
import { useSocket } from './SocketContext';

/** Same order as the server: most urgent first, then oldest first. */
function sortQueue(list: Incident[]): Incident[] {
  return [...list].sort(
    (a, b) => b.urgencyScore - a.urgencyScore || a.createdAt.localeCompare(b.createdAt),
  );
}

function upsert<T extends { id: number }>(list: T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) return [...list, item];
  const copy = [...list];
  copy[index] = item;
  return copy;
}

/**
 * Loads the active incidents, resources and feed status once, then keeps
 * them up to date from live socket events. After a reconnect it reloads
 * everything, in case updates were missed while offline.
 */
export function useLiveData() {
  const { socket, connected } = useSocket();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [feed, setFeed] = useState<FeedStatus | null>(null);
  const [triageMode, setTriageMode] = useState<'ai' | 'rules' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [inc, res, fd, sys] = await Promise.all([
        api.get<{ incidents: Incident[] }>('/incidents'),
        api.get<{ resources: Resource[] }>('/resources'),
        api.get<{ status: FeedStatus }>('/feeds/social'),
        api.get<{ triageMode: 'ai' | 'rules' }>('/system'),
      ]);
      setIncidents(sortQueue(inc.incidents));
      setResources(res.resources);
      setFeed(fd.status);
      setTriageMode(sys.triageMode);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load once when the screen opens...
  useEffect(() => {
    void reload();
  }, [reload]);

  // ...and again whenever the live connection comes back after a drop.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (connected && wasConnected.current) void reload();
    if (connected) wasConnected.current = true;
  }, [connected, reload]);

  useEffect(() => {
    if (!socket) return;
    const onIncident = (incident: Incident) =>
      setIncidents((list) =>
        incident.status === 'resolved'
          ? list.filter((i) => i.id !== incident.id)
          : sortQueue(upsert(list, incident)),
      );
    const onResource = (resource: Resource) =>
      setResources((list) =>
        resource.retiredAt ? list.filter((r) => r.id !== resource.id) : upsert(list, resource),
      );
    socket.on('incident:updated', onIncident);
    socket.on('resource:updated', onResource);
    socket.on('feed:status', setFeed);
    return () => {
      socket.off('incident:updated', onIncident);
      socket.off('resource:updated', onResource);
      socket.off('feed:status', setFeed);
    };
  }, [socket]);

  return { incidents, resources, feed, triageMode, loading, error, reload };
}
