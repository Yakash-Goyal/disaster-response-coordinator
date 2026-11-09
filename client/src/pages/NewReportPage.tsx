import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { Incident } from '../api/types';
import { LocationPicker, type Point } from '../components/LocationPicker';
import { INCIDENT_TYPE_LABELS, SEVERITY_LABELS } from '../lib/labels';
import './NewReportPage.css';

interface SearchResult {
  label: string;
  lat: number;
  lng: number;
}

interface IngestResult {
  reportId: number;
  merged: boolean;
  incident: Incident;
  triage: { method: 'ai' | 'rules'; confidence: number; needsReview: boolean };
}

/**
 * LOG A REPORT (SRS 4.1 - manual form entry)
 * For control-room staff writing down a phone call or walk-in report.
 */
export function NewReportPage() {
  const [text, setText] = useState('');
  const [reporter, setReporter] = useState('');
  const [point, setPoint] = useState<Point | null>(null);
  const [address, setAddress] = useState('');

  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  const search = async () => {
    if (searchText.trim().length < 3) return;
    setSearching(true);
    setSearchError(null);
    try {
      const data = await api.get<{ results: SearchResult[] }>(
        `/geocode/search?q=${encodeURIComponent(searchText.trim())}`,
      );
      setResults(data.results);
      if (data.results.length === 0) setSearchError('No places found. Try another spelling, or click on the map.');
    } catch (e) {
      setSearchError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const chooseResult = (r: SearchResult) => {
    setPoint({ lat: r.lat, lng: r.lng });
    setAddress(r.label);
    setResults([]);
  };

  const lookupId = useRef(0);
  const pickOnMap = async (p: Point) => {
    const id = ++lookupId.current; // ignore answers to older clicks
    setPoint(p);
    setAddress('Looking up address...');
    try {
      const data = await api.get<{ label: string | null }>(`/geocode/reverse?lat=${p.lat}&lng=${p.lng}`);
      if (id === lookupId.current) setAddress(data.label ?? '');
    } catch {
      if (id === lookupId.current) setAddress(''); // the pin still works without an address
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!point) {
      setError('Please choose where it happened: search for a place or click on the map.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await api.post<IngestResult>('/reports', {
        text: text.trim(),
        lat: point.lat,
        lng: point.lng,
        address: address && address !== 'Looking up address...' ? address : undefined,
        reporter: reporter.trim() || undefined,
      });
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setText('');
    setReporter('');
    setPoint(null);
    setAddress('');
    setSearchText('');
    setResult(null);
  };

  if (result) {
    const { incident, merged, triage } = result;
    return (
      <div className="report-page">
        <div className="card card-body report-result">
          <h1>Report saved</h1>
          <div className={`alert ${triage.needsReview ? 'alert-warning' : 'alert-success'}`}>
            {merged ? (
              <>
                This looks like the same event as incident <strong>#{incident.id}</strong>, so it was added to it. That
                incident now has <strong>{incident.reportCount} reports</strong>.
              </>
            ) : (
              <>
                A new incident <strong>#{incident.id}</strong> was created.
              </>
            )}
          </div>
          <dl className="result-list">
            <dt>Type</dt>
            <dd>{INCIDENT_TYPE_LABELS[incident.type]}</dd>
            <dt>Severity</dt>
            <dd>
              {incident.severity} - {SEVERITY_LABELS[incident.severity]}
            </dd>
            <dt>Priority score</dt>
            <dd>{Math.round(incident.urgencyScore)} out of 100</dd>
            <dt>Classified by</dt>
            <dd>
              {triage.method === 'ai' ? 'AI triage agent' : 'Keyword rules'} ({Math.round(triage.confidence * 100)}%
              sure)
              {triage.needsReview && ' - marked for checking on the dashboard'}
            </dd>
          </dl>
          <div className="action-row">
            <Link className="btn btn-primary" to="/">
              Go to dashboard
            </Link>
            <button className="btn" onClick={startOver}>
              Log another report
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="report-page">
      <h1>Log a report</h1>
      <p className="muted report-intro">
        Write down what the caller tells you. The system will classify it, check whether it is already known, and
        add it to the incident queue.
      </p>

      <form className="report-grid" onSubmit={handleSubmit} noValidate>
        <div className="card card-body">
          {error && <div className="alert alert-error report-error">{error}</div>}

          <div className="field">
            <label htmlFor="text">What happened?</label>
            <textarea
              id="text"
              className="textarea"
              rows={6}
              maxLength={2000}
              placeholder="e.g. Water has entered houses on 3rd Street, about knee deep. An elderly couple cannot get out."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <span className="hint">Include who is affected, how many people, and anything dangerous.</span>
          </div>

          <div className="field">
            <label htmlFor="reporter">Reported by (optional)</label>
            <input
              id="reporter"
              className="input"
              placeholder="Caller name or phone number"
              maxLength={100}
              value={reporter}
              onChange={(e) => setReporter(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Location</label>
            {point ? (
              <p className="chosen-location">{address || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}</p>
            ) : (
              <p className="hint">Not chosen yet. Search for a place or click on the map.</p>
            )}
          </div>

          <button className="btn btn-primary" type="submit" disabled={submitting || text.trim().length < 10}>
            {submitting ? 'Saving and classifying...' : 'Save report'}
          </button>
        </div>

        <div className="card card-body">
          <div className="field">
            <label htmlFor="search">Find a place</label>
            <div className="search-row">
              <input
                id="search"
                className="input"
                placeholder="Street, area or landmark in Chennai"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void search();
                  }
                }}
              />
              <button type="button" className="btn" onClick={search} disabled={searching || searchText.trim().length < 3}>
                {searching ? 'Searching...' : 'Search'}
              </button>
            </div>
            {searchError && <span className="hint">{searchError}</span>}
            {results.length > 0 && (
              <ul className="search-results">
                {results.map((r) => (
                  <li key={`${r.lat},${r.lng}`}>
                    <button type="button" onClick={() => chooseResult(r)}>
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <LocationPicker value={point} onPick={pickOnMap} height={380} />
          <p className="hint map-hint">Click on the map to place or move the pin.</p>
        </div>
      </form>
    </div>
  );
}
