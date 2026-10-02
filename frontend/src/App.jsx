import { useCallback, useEffect, useMemo, useState } from "react";
import { api, clearSession, getStoredUser } from "./lib/api";
import { useLiveState } from "./lib/useLiveState";
import AdminPanel from "./components/AdminPanel";
import Analytics from "./components/Analytics";
import DecisionPanel from "./components/DecisionPanel";
import IncidentQueue from "./components/IncidentQueue";
import Login from "./components/Login";
import LogPanel from "./components/LogPanel";
import MapView from "./components/MapView";
import ReportForm from "./components/ReportForm";
import ResourcePanel from "./components/ResourcePanel";
import ResponderView from "./components/ResponderView";

const CENTER = [30.7333, 76.7794];

export default function App() {
  const [user, setUser] = useState(getStoredUser);
  const [tab, setTab] = useState("command");
  const [sideTab, setSideTab] = useState("units");
  const [selectedId, setSelectedId] = useState(null);
  const [logFilter, setLogFilter] = useState(null);
  const [placingClosure, setPlacingClosure] = useState(false);
  const [banner, setBanner] = useState(null);

  const live = useLiveState(Boolean(user));

  useEffect(() => {
    const signOut = () => setUser(null);
    window.addEventListener("drc:signed-out", signOut);
    return () => window.removeEventListener("drc:signed-out", signOut);
  }, []);

  const showError = useCallback((message) => {
    setBanner(message);
    setTimeout(() => setBanner(null), 6000);
  }, []);

  const selected = useMemo(
    () => live.incidents.find((i) => i.id === selectedId) || null,
    [live.incidents, selectedId]
  );

  const activeDecision = useMemo(() => {
    if (!selectedId) return null;
    const forIncident = live.decisions
      .filter((d) => d.incident_id === selectedId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return forIncident.find((d) => d.human_action === "pending") || forIncident[0] || null;
  }, [live.decisions, selectedId]);

  const pendingCount = live.decisions.filter((d) => d.human_action === "pending").length;

  // Nothing is selected on load; jump to whatever most needs a human.
  useEffect(() => {
    if (selectedId || !live.incidents.length) return;
    const awaiting = live.decisions.find((d) => d.human_action === "pending");
    setSelectedId(awaiting ? awaiting.incident_id : live.incidents[0].id);
  }, [live.incidents, live.decisions, selectedId]);

  if (!user) return <Login onSignedIn={setUser} />;

  function signOut() {
    clearSession();
    setUser(null);
  }

  async function placeClosure(lat, lng) {
    setPlacingClosure(false);
    try {
      const res = await api.createClosure({ lat, lng, radius_m: 300, note: "Reported blocked" });
      live.pushToast({
        level: "warning",
        title: "Road closure recorded",
        message: `Routes crossing it are being replanned. Closure #${res.id}.`,
      });
    } catch (err) {
      showError(err.message);
    }
  }

  const isResponder = user.role === "responder";
  const isAdmin = user.role === "admin";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Resource<span>Coordinator</span>
        </div>

        {!isResponder && (
          <nav className="tabs">
            <button
              className={`tab${tab === "command" ? " active" : ""}`}
              onClick={() => setTab("command")}
            >
              Command
              {pendingCount > 0 && <span className="badge agent">{pendingCount}</span>}
            </button>
            <button
              className={`tab${tab === "analytics" ? " active" : ""}`}
              onClick={() => setTab("analytics")}
            >
              After action
            </button>
            {isAdmin && (
              <button
                className={`tab${tab === "admin" ? " active" : ""}`}
                onClick={() => setTab("admin")}
              >
                Inventory
              </button>
            )}
          </nav>
        )}

        <div className="spacer" />

        <div className="status-strip">
          <span>
            <span className={`dot ${live.connected ? "live" : "dead"}`} />
            {live.connected ? "Live" : "Reconnecting"}
          </span>
          {live.status && (
            <>
              <span>
                Agents <b>{live.status.llm_provider}</b>
              </span>
              <span>
                Routing <b>{live.status.routing_provider}</b>
              </span>
              <span>
                Index <b>{live.status.spatial_backend}</b>
              </span>
            </>
          )}
          <span>
            {user.name} <span className="badge">{user.role}</span>
          </span>
          <button className="btn sm ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      {banner && <div className="error">{banner}</div>}
      {live.error && <div className="error">{live.error}</div>}

      {isResponder ? (
        <div className="main" style={{ overflowY: "auto" }}>
          <ResponderView resources={live.resources} />
        </div>
      ) : tab === "analytics" ? (
        <div className="main">
          <Analytics />
        </div>
      ) : tab === "admin" ? (
        <div className="main">
          <AdminPanel
            resources={live.resources}
            center={CENTER}
            onChanged={live.refresh}
            onError={showError}
          />
        </div>
      ) : (
        <div className="main">
          {/* --- queue ---------------------------------------------------- */}
          <section className="col col-queue">
            <div className="panel-head">
              <span className="eyebrow">Incident queue</span>
              <span className="badge">{live.incidents.length} OPEN</span>
              {pendingCount > 0 && <span className="badge agent">{pendingCount} TO RULE ON</span>}
            </div>
            <div className="panel-body">
              <IncidentQueue
                incidents={live.incidents}
                decisions={live.decisions}
                selectedId={selectedId}
                onSelect={(id) => {
                  setSelectedId(id);
                  setLogFilter(null);
                }}
              />
            </div>
          </section>

          {/* --- map ------------------------------------------------------ */}
          <section className="col col-map">
            <div className="panel-head">
              <span className="eyebrow">Live map</span>
              <button
                className={`btn sm ${placingClosure ? "danger" : "ghost"}`}
                onClick={() => setPlacingClosure((v) => !v)}
              >
                {placingClosure ? "Cancel" : "Block a road"}
              </button>
              <button
                className="btn sm ghost"
                onClick={() => api.triggerSocialPost().catch((e) => showError(e.message))}
              >
                Inject report
              </button>
              <button
                className="btn sm ghost"
                onClick={() => api.runCycle().catch((e) => showError(e.message))}
              >
                Run agents
              </button>
              <button
                className="btn sm ghost"
                onClick={() =>
                  api
                    .resetScenario()
                    .then(live.refresh)
                    .catch((e) => showError(e.message))
                }
              >
                Reset
              </button>
            </div>
            <MapView
              incidents={live.incidents}
              resources={live.resources}
              closures={live.closures}
              selectedId={selectedId}
              onSelectIncident={setSelectedId}
              center={CENTER}
              placingClosure={placingClosure}
              onPlaceClosure={placeClosure}
            />
          </section>

          {/* --- side ----------------------------------------------------- */}
          <section className="col col-side">
            <div className="panel" style={{ flex: "1 1 52%" }}>
              <div className="panel-head">
                <button
                  className={`tab${sideTab === "units" ? " active" : ""}`}
                  onClick={() => setSideTab("units")}
                  style={{ padding: "2px 8px" }}
                >
                  Decision
                </button>
                <button
                  className={`tab${sideTab === "intake" ? " active" : ""}`}
                  onClick={() => setSideTab("intake")}
                  style={{ padding: "2px 8px" }}
                >
                  File report
                </button>
                <button
                  className={`tab${sideTab === "fleet" ? " active" : ""}`}
                  onClick={() => setSideTab("fleet")}
                  style={{ padding: "2px 8px" }}
                >
                  Units
                </button>
              </div>
              <div className="panel-body">
                {sideTab === "units" && (
                  <DecisionPanel
                    incident={selected}
                    decision={activeDecision}
                    resources={live.resources}
                    onDone={live.refresh}
                    onError={showError}
                  />
                )}
                {sideTab === "intake" && (
                  <ReportForm center={CENTER} onSubmitted={live.refresh} onError={showError} />
                )}
                {sideTab === "fleet" && (
                  <ResourcePanel resources={live.resources} onFocus={() => {}} />
                )}
              </div>
            </div>

            <div className="panel" style={{ flex: "1 1 48%" }}>
              <LogPanel
                logs={live.logs}
                filterIncident={logFilter}
                onClearFilter={() => setLogFilter(null)}
              />
            </div>
          </section>
        </div>
      )}

      <div className="toasts">
        {live.toasts.map((t) => (
          <div className={`toast ${t.level || ""}`} key={t.id}>
            <b>{t.title}</b>
            <p>{t.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
