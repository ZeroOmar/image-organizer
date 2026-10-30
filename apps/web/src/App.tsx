import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { keys, useJobEvents, useMe } from './api/hooks';
import { TopNav } from './components/TopNav';
import { AutomationPage } from './pages/Automation';
import { HomePage } from './pages/Home';
import { ImmichPage } from './pages/Immich';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { OrganizePage } from './pages/Organize';
import { SettingsPage } from './pages/Settings';
import { TrashPage } from './pages/Trash';

export function App() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const signedIn = !!me.data?.username;
  useJobEvents(signedIn);

  useEffect(() => {
    const onUnauthorized = () => {
      qc.setQueryData(keys.me, null);
      navigate('/login', { replace: true, state: { from: location.pathname + location.search } });
    };
    window.addEventListener('io:unauthorized', onUnauthorized);
    return () => window.removeEventListener('io:unauthorized', onUnauthorized);
  }, [qc, navigate, location]);

  if (me.isLoading) return null;
  if (!signedIn) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname + location.search }} />} />
      </Routes>
    );
  }

  return (
    <div className="shell">
      <TopNav />
      <main className="page">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/organize" element={<OrganizePage />} />
          {/* Old British spelling; keeps bookmarks working. */}
          <Route path="/organise" element={<Navigate to={{ pathname: '/organize', search: location.search }} replace />} />
          <Route path="/automation" element={<AutomationPage />} />
          <Route path="/immich" element={<ImmichPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
