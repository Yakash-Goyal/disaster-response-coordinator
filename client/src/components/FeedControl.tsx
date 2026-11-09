import { useState } from 'react';
import { api } from '../api/client';
import type { FeedStatus } from '../api/types';

/**
 * Start / stop the mock social media feed (SRS 4.1). Used in demos to
 * simulate a burst of incoming reports during a flood.
 */
export function FeedControl({ status, canControl }: { status: FeedStatus | null; canControl: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  const run = async (action: 'start' | 'stop' | 'rewind') => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/feeds/social/${action}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finished = status.posted >= status.total;

  return (
    <div className="feed-control">
      <div>
        <strong>Social media feed</strong>
        <div className="small muted">
          {status.running
            ? `Receiving posts... ${status.posted} of ${status.total}`
            : finished
              ? `All ${status.total} sample posts received`
              : status.posted > 0
                ? `Paused at ${status.posted} of ${status.total}`
                : `${status.total} sample posts from the Chennai flood scenario`}
        </div>
        {error && <div className="small text-danger">{error}</div>}
      </div>
      {canControl && (
        <div className="feed-buttons">
          {status.running ? (
            <button className="btn btn-small" onClick={() => run('stop')} disabled={busy}>
              Pause
            </button>
          ) : (
            <button className="btn btn-small" onClick={() => run('start')} disabled={busy}>
              {finished ? 'Replay' : status.posted > 0 ? 'Resume' : 'Start'}
            </button>
          )}
          {!status.running && status.posted > 0 && !finished && (
            <button className="btn btn-small" onClick={() => run('rewind')} disabled={busy}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
