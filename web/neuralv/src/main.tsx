import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/theme.css';

type ThemePreference = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'neuralv-site-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

function resolveInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
  if (stored === 'light' || stored === 'dark') {
    return stored;
  }

  return window.matchMedia?.(MEDIA_QUERY).matches ? 'dark' : 'light';
}

if (typeof document !== 'undefined') {
  const currentPath = window.location.pathname.replace(/\/+$/, '');
  if (currentPath === '/neuralv/nv') {
    window.location.replace('/nv');
  }

  const initialTheme = resolveInitialTheme();
  document.documentElement.dataset.theme = initialTheme;
  document.documentElement.style.colorScheme = initialTheme;
}
if (typeof window === 'undefined' || window.location.pathname.replace(/\/+$/, '') !== '/neuralv/nv') {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
}
