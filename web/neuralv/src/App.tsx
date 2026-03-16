import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AndroidPage } from './pages/AndroidPage';
import { HomePage } from './pages/HomePage';
import { LinuxPage } from './pages/LinuxPage';
import { WindowsPage } from './pages/WindowsPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="android" element={<AndroidPage />} />
        <Route path="windows" element={<WindowsPage />} />
        <Route path="linux" element={<LinuxPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
