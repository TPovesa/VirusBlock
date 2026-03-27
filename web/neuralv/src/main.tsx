import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SiteAuthProvider } from './components/SiteAuthProvider';
import './styles/theme.css';

if (typeof document !== 'undefined') {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.colorScheme = 'dark';
}

if (typeof window === 'undefined' || window.location.pathname.replace(/\/+$/, '') !== '/nv') {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <SiteAuthProvider>
          <App />
        </SiteAuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}
