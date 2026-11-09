import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { homePathFor } from '../lib/labels';
import './LoginPage.css';

// Accounts created by the seed script. Shown only while developing / demoing.
const DEMO_ACCOUNTS = [
  { label: 'Commander', email: 'commander@drrc.local', password: 'Commander@123' },
  { label: 'Admin', email: 'admin@drrc.local', password: 'Admin@123' },
  { label: 'Field responder', email: 'responder1@drrc.local', password: 'Responder@123' },
];

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to={homePathFor(user.role)} replace />;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login(email, password);
      navigate(homePathFor(loggedIn.role), { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-heading">
          <img src="/favicon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Disaster Response Coordinator</h1>
            <p className="muted">Sign in to the control room</p>
          </div>
        </div>

        <form className="card card-body" onSubmit={handleSubmit} noValidate>
          {error && <div className="alert alert-error login-error">{error}</div>}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button className="btn btn-primary btn-block" type="submit" disabled={submitting || !email || !password}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        {import.meta.env.DEV && (
          <div className="demo-accounts">
            <p className="small muted">Demo accounts (click to fill in):</p>
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="btn-link small"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                }}
              >
                {account.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
