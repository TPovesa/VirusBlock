import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

type ThemePreference = 'system' | 'light' | 'dark';

type ThemeOption = {
  value: ThemePreference;
  label: string;
};

const THEME_STORAGE_KEY = 'neuralv-site-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

const navItems = [
  { to: '/', label: 'Главная' },
  { to: '/android', label: 'Android' },
  { to: '/windows', label: 'Windows' },
  { to: '/linux', label: 'Linux' }
];

const themeOptions: ThemeOption[] = [
  { value: 'system', label: 'Система' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' }
];

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function AppShell() {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readStoredPreference());
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => getSystemTheme());

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

  const resolvedTheme = useMemo(
    () => (themePreference === 'system' ? systemTheme : themePreference),
    [systemTheme, themePreference]
  );

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = themePreference;
    root.style.colorScheme = resolvedTheme;

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    }
  }, [resolvedTheme, themePreference]);

  return (
    <div className="app-shell">
      <header className="topbar surface-card">
        <div className="topbar-main">
          <a className="topbar-brand" href="/neuralv/" aria-label="NeuralV home">
            <span className="brand-mark" aria-hidden="true">
              <span className="brand-core" />
            </span>
            <span className="brand-copy">
              <span className="brand-kicker">NeuralV</span>
              <strong className="brand-title">Защита для Android, Windows и Linux</strong>
              <span className="brand-summary">Скачать, установить и войти тем же аккаунтом.</span>
            </span>
          </a>

          <a className="topbar-action" href="/neuralv/linux#linux-install">
            Linux через nv
          </a>
        </div>

        <div className="topbar-tray">
          <nav className="tab-nav" aria-label="Навигация NeuralV">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `nav-pill${isActive ? ' is-active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="theme-toggle" role="group" aria-label="Тема сайта">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`theme-option${themePreference === option.value ? ' is-active' : ''}`}
                aria-pressed={themePreference === option.value}
                onClick={() => setThemePreference(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="page-frame">
        <Outlet />
      </main>

      <footer className="footer-shell surface-card">
        <div className="footer-copy">
          <div className="eyebrow">NeuralV</div>
          <strong>Скачать, поставить и начать проверку без лишнего шума.</strong>
        </div>

        <div className="footer-links">
          <a href="/neuralv/android">Android</a>
          <a href="/neuralv/windows">Windows</a>
          <a href="/neuralv/linux">Linux</a>
          <a href="/basedata/api/releases/manifest" target="_blank" rel="noreferrer">
            Manifest
          </a>
        </div>
      </footer>
    </div>
  );
}
