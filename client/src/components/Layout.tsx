import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useSocket } from '../hooks/SocketContext';
import { ROLE_LABELS } from '../lib/labels';
import './Layout.css';

/** Top bar shown on every page after login. */
export function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>Disaster Response Coordinator</span>
        </div>

        {user && (
          <nav className="topbar-nav">
            {(user.role === 'commander' || user.role === 'admin') && (
              <>
                <NavLink to="/" end>
                  Dashboard
                </NavLink>
                <NavLink to="/reports/new">Log a report</NavLink>
              </>
            )}
            {user.role === 'admin' && <NavLink to="/resources">Resources</NavLink>}
            {user.role === 'responder' && <NavLink to="/responder">My unit</NavLink>}
          </nav>
        )}

        {user && (
          <div className="topbar-user">
            <span className={`live-status ${connected ? 'is-live' : ''}`}>
              {connected ? 'Live' : 'Reconnecting...'}
            </span>
            <span className="topbar-name">
              {user.name}
              <span className="faint"> · {ROLE_LABELS[user.role]}</span>
            </span>
            <button className="btn btn-small" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </header>

      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
}
