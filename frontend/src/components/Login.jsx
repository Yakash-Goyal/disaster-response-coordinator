import { useState } from "react";
import { api, setSession } from "../lib/api";

const DEMO_ACCOUNTS = [
  ["commander", "commander123", "Commander", "Full dashboard, approves dispatch"],
  ["responder1", "responder123", "Field responder", "Ambulance 01 — mobile view"],
  ["admin", "admin123", "Admin", "Resource inventory and accounts"],
];

export default function Login({ onSignedIn }) {
  const [username, setUsername] = useState("commander");
  const [password, setPassword] = useState("commander123");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(user = username, pass = password) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(user, pass);
      setSession(res.access_token, res.user);
      onSignedIn(res.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>
          Resource
          <span>Coordinator</span>
        </h1>
        <p className="login-sub">
          Disaster response command and control. Agents triage and recommend; you decide.
        </p>

        <div className="login-form">
          {error && <div className="error" style={{ margin: "0 0 10px" }}>{error}</div>}
          <div className="field">
            <label className="eyebrow">Username</label>
            <input
              className="input"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="field">
            <label className="eyebrow">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <button className="btn primary" onClick={() => submit()} disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </div>

        <div className="accounts">
          <div className="eyebrow">Demo accounts</div>
          {DEMO_ACCOUNTS.map(([user, pass, role, note]) => (
            <button key={user} className="account-btn" onClick={() => submit(user, pass)}>
              <span style={{ flex: 1 }}>
                <b>{role}</b>
                <div className="hint" style={{ marginTop: 1 }}>{note}</div>
              </span>
              <span className="badge">{user}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
