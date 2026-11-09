import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { RequireRole } from './auth/RequireRole';
import { Layout } from './components/Layout';
import { SocketProvider } from './hooks/SocketContext';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NewReportPage } from './pages/NewReportPage';
import { ResourcesPage } from './pages/ResourcesPage';
import { ResponderPage } from './pages/ResponderPage';

/**
 * Screens and who may open them:
 *   /login        everyone
 *   /             commander, admin   (command dashboard)
 *   /reports/new  commander, admin   (log a report)
 *   /resources    admin              (resource inventory)
 *   /responder    responder          (field responder view)
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Layout />}>
              <Route
                path="/"
                element={
                  <RequireRole roles={['commander', 'admin']}>
                    <DashboardPage />
                  </RequireRole>
                }
              />
              <Route
                path="/reports/new"
                element={
                  <RequireRole roles={['commander', 'admin']}>
                    <NewReportPage />
                  </RequireRole>
                }
              />
              <Route
                path="/resources"
                element={
                  <RequireRole roles={['admin']}>
                    <ResourcesPage />
                  </RequireRole>
                }
              />
              <Route
                path="/responder"
                element={
                  <RequireRole roles={['responder']}>
                    <ResponderPage />
                  </RequireRole>
                }
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
