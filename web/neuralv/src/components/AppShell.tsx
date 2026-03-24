import { NavLink, Outlet } from 'react-router-dom';
import { useSiteAuth } from './SiteAuthProvider';

const navItems = [
  { to: '/', label: 'Главная' },
  { to: '/android', label: 'Android' },
  { to: '/windows', label: 'Windows' },
  { to: '/linux', label: 'Linux' },
  { to: '/verified-apps', label: 'Проверенные' }
];

export function AppShell() {
  const { ready, session, user } = useSiteAuth();
  const currentYear = new Date().getFullYear();

  return (
    <div className="app-shell">
      <div className="site-noise site-noise-a" aria-hidden="true" />
      <div className="site-noise site-noise-b" aria-hidden="true" />

      <header className="shell-header">
        <div className="shell-header-inner">
          <a className="brand-link" href="/neuralv/" aria-label="NeuralV home">
            <span className="brand-badge" aria-hidden="true">
              <span className="brand-badge-core" />
            </span>
            <span className="brand-name">NeuralV</span>
          </a>

          <nav className="shell-nav" aria-label="Навигация NeuralV">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `shell-link shell-nav-link${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="shell-actions">
            {ready && session ? (
              <NavLink className={({ isActive }) => `shell-link shell-auth-link${isActive ? ' is-active' : ''}`} to="/profile">
                {user?.name || 'Профиль'}
              </NavLink>
            ) : (
              <>
                <NavLink className={({ isActive }) => `shell-link shell-auth-link${isActive ? ' is-active' : ''}`} to="/login">
                  Войти
                </NavLink>
                <NavLink className="nv-button shell-button" to="/register">
                  Регистрация
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="page-frame">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="site-footer-grid">
          <div className="footer-title">NeuralV</div>
          <nav className="site-footer-links" aria-label="Навигация внизу сайта">
            {navItems.map((item) => (
              <a key={item.to} className="footer-link" href={`/neuralv${item.to === '/' ? '/' : item.to}`}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="footer-meta">NeuralV © {currentYear}</div>
        </div>
      </footer>
    </div>
  );
}
