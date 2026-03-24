import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useSiteAuth } from './components/SiteAuthProvider';
import { AndroidPage } from './pages/AndroidPage';
import { HomePage } from './pages/HomePage';
import { LinuxPage } from './pages/LinuxPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { WindowsPage } from './pages/WindowsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProfilePage } from './pages/ProfilePage';
import { AccountActionPage } from './pages/AccountActionPage';
import { VerifiedAppsPage } from './pages/VerifiedAppsPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, session } = useSiteAuth();
  const location = useLocation();

  if (!ready) {
    return <div className="route-skeleton">Загружаем аккаунт...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/android" element={<AndroidPage />} />
        <Route path="/windows" element={<WindowsPage />} />
        <Route path="/linux" element={<LinuxPage />} />
        <Route path="/verified-apps" element={<VerifiedAppsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/account-action" element={<AccountActionPage />} />
        <Route path="/profile/action" element={<AccountActionPage />} />
        <Route path="/profile/name" element={<AccountActionPage />} />
        <Route path="/profile/email" element={<AccountActionPage />} />
        <Route path="/profile/password" element={<AccountActionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
