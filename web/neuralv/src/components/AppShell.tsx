import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

type ThemePreference = 'light' | 'dark';

const THEME_STORAGE_KEY = 'neuralv-site-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const navItems = [
  { to: '/', label: 'Главная' },
  { to: '/android', label: 'Android' },
  { to: '/windows', label: 'Windows' },
  { to: '/linux', label: 'Linux' }
];

function readStoredPreference(): ThemePreference | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function getSystemTheme(): ThemePreference {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <path
        d="M12 1.75v3M12 19.25v3M4.75 4.75l2.1 2.1M17.15 17.15l2.1 2.1M1.75 12h3M19.25 12h3M4.75 19.25l2.1-2.1M17.15 6.85l2.1-2.1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M15.6 2.55a8.95 8.95 0 1 0 5.85 15.7 8.35 8.35 0 0 1-3.95 1 8.95 8.95 0 0 1-8.95-8.95 8.37 8.37 0 0 1 7.05-8.25Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AppShell() {
  const [themePreference, setThemePreference] = useState<ThemePreference | null>(() => readStoredPreference());
  const [systemTheme, setSystemTheme] = useState<ThemePreference>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const media = window.matchMedia(MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    setSystemTheme(media.matches ? 'dark' : 'light');

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }

    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  const resolvedTheme = useMemo(() => themePreference ?? systemTheme, [systemTheme, themePreference]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = themePreference ?? 'system';
    root.style.colorScheme = resolvedTheme;

    if (typeof window !== 'undefined') {
      if (themePreference) {
        window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
      } else {
        window.localStorage.removeItem(THEME_STORAGE_KEY);
      }
    }
  }, [resolvedTheme, themePreference]);

  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const themeLabel = resolvedTheme === 'dark' ? 'Тёмная тема' : 'Светлая тема';
  const currentYear = new Date().getFullYear();

  return (
    <div className="app-shell">
      <header className="shell-header">
        <div className="shell-header-inner">
          <a className="brand-link" href="/neuralv/" aria-label="NeuralV home">
            <span className="brand-badge" aria-hidden="true">
              <span className="brand-badge-core" />
            </span>
            <span className="brand-text">
              <span className="brand-name">NeuralV</span>
            </span>
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

          <button
            type="button"
            className="theme-toggle"
            data-mode={resolvedTheme}
            aria-pressed={resolvedTheme === 'dark'}
            aria-label={`${themeLabel}. Переключить на ${nextTheme === 'dark' ? 'тёмную' : 'светлую'}.`}
            title={`${themeLabel}. Переключить.`}
            onClick={() => setThemePreference(nextTheme)}
          >
            <span className="theme-toggle-icons" aria-hidden="true">
              <span className={`theme-icon theme-icon-sun${resolvedTheme === 'light' ? ' is-active' : ''}`}>
                <SunIcon />
              </span>
              <span className={`theme-icon theme-icon-moon${resolvedTheme === 'dark' ? ' is-active' : ''}`}>
                <MoonIcon />
              </span>
            </span>
          </button>
        </div>
      </header>

      <main className="page-frame">
        <Outlet />
      </main>

      <footer className="site-footer">
        <nav className="site-footer-links" aria-label="Навигация внизу сайта">
          {navItems.map((item) => (
            <a key={item.to} className="shell-link footer-link" href={`/neuralv${item.to === '/' ? '/' : item.to}`}>
              {item.label}
            </a>
          ))}
        </nav>
        <p className="site-footer-copy">NeuralV © {currentYear}</p>
      </footer>
    </div>
  );
}
