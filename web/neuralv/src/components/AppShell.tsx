import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSiteAuth } from './SiteAuthProvider';
import { SupportChatWidget, type SupportChatMessage as WidgetSupportChatMessage } from './SupportChatWidget';
import {
  fetchSupportChatState,
  humanizeError,
  openSupportChat,
  sendSupportChatMessage,
  type SiteSupportChatState
} from '../lib/siteAuth';

const productLinks = [
  { to: '/', label: 'Главная' },
  { to: '/verified-apps', label: 'Проверенные' },
  { to: '/telegram', label: 'Telegram' }
];

const clientLinks = [
  { to: '/android', label: 'Android' },
  { to: '/windows', label: 'Windows' },
  { to: '/linux', label: 'Linux' }
];

function parseTimestamp(value: string | number | Date | null | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSupportMessages(state: SiteSupportChatState | null): WidgetSupportChatMessage[] {
  if (!state?.messages?.length) {
    return [];
  }

  return state.messages.map((message) => ({
    id: message.id,
    role:
      message.senderRole === 'support'
        ? 'agent'
        : message.senderRole === 'system'
          ? 'system'
          : 'user',
    text: message.text,
    author: message.senderName || undefined,
    createdAt: message.createdAt,
    meta:
      message.senderRole === 'support'
        ? 'Поддержка'
        : message.senderRole === 'system'
          ? 'Система'
          : undefined
  }));
}

export function AppShell() {
  const { ready, session, user, logout } = useSiteAuth();
  const currentYear = new Date().getFullYear();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportState, setSupportState] = useState<SiteSupportChatState | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportSending, setSupportSending] = useState(false);
  const [supportSeenAt, setSupportSeenAt] = useState(0);
  const [supportRefreshNonce, setSupportRefreshNonce] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !('scrollRestoration' in window.history)) {
      return;
    }

    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useLayoutEffect(() => {
    setMenuOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname, location.search]);

  useEffect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    if (menuOpen || supportOpen) {
      body.style.overflow = 'hidden';
    }
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [menuOpen, supportOpen]);

  const accountLinks = useMemo(() => {
    if (ready && session) {
      return [{ to: '/profile', label: user?.name || 'Профиль' }];
    }
    return [
      { to: '/login', label: 'Войти' },
      { to: '/register', label: 'Регистрация' }
    ];
  }, [ready, session, user?.name]);

  const latestSupportReplyAt = useMemo(() => {
    return (supportState?.messages || []).reduce((latest, message) => {
      if (message.senderRole !== 'support') {
        return latest;
      }
      return Math.max(latest, parseTimestamp(message.createdAt));
    }, 0);
  }, [supportState]);

  const launcherUnreadCount = latestSupportReplyAt > supportSeenAt ? 1 : 0;

  const loadSupportState = useCallback(async () => {
    if (!session) {
      setSupportState(null);
      return;
    }

    setSupportLoading(true);
    const result = await fetchSupportChatState({ limit: 80 });
    if (result.ok && result.data) {
      if (result.data.availability && !result.data.chat) {
        const opened = await openSupportChat();
        if (opened.ok && opened.data) {
          setSupportState(opened.data);
        } else {
          setSupportState(result.data);
        }
      } else {
        setSupportState(result.data);
      }
    } else {
      setSupportState({
        availability: false,
        message: result.error || 'Поддержка временно недоступна.',
        messages: []
      });
    }
    setSupportLoading(false);
  }, [session]);

  useEffect(() => {
    if (!supportOpen || !session) {
      return;
    }
    void loadSupportState();
  }, [loadSupportState, session, supportOpen, supportRefreshNonce]);

  useEffect(() => {
    if (!supportOpen || !session) {
      return;
    }
    const pollAfterMs = Math.max(1500, Number(supportState?.pollAfterMs || 0) || 4000);
    const timer = window.setTimeout(() => {
      void loadSupportState();
    }, pollAfterMs);
    return () => window.clearTimeout(timer);
  }, [loadSupportState, session, supportOpen, supportState?.pollAfterMs, supportState?.messages]);

  useEffect(() => {
    if (!supportOpen) {
      return;
    }
    setSupportSeenAt((current) => Math.max(current, latestSupportReplyAt));
  }, [latestSupportReplyAt, supportOpen]);

  async function handleLogout() {
    await logout();
    setMenuOpen(false);
    setSupportOpen(false);
    setSupportState(null);
  }

  async function handleSupportSend(text: string) {
    if (!session) {
      navigate('/login');
      return;
    }

    setSupportSending(true);
    const result = await sendSupportChatMessage(text, supportState?.chat?.id);
    if (result.ok && result.data) {
      setSupportState(result.data);
      setSupportSeenAt((current) => Math.max(current, latestSupportReplyAt));
    } else {
      setSupportState((current) => ({
        availability: false,
        message: result.error || 'Не удалось отправить сообщение.',
        chat: current?.chat || null,
        messages: current?.messages || []
      }));
    }
    setSupportSending(false);
  }

  const widgetUnavailable = useMemo(() => {
    if (!ready) {
      return {
        title: 'Поддержка загружается',
        description: 'Подождите немного.'
      };
    }

    if (!session) {
      return {
        title: 'Войдите в аккаунт',
        description: 'Чат поддержки открывается после входа.',
        actionLabel: 'Войти',
        onAction: () => {
          setSupportOpen(false);
          navigate('/login');
        }
      };
    }

    if (supportState && supportState.availability === false) {
      return {
        title: 'Поддержка пока не активна',
        description: humanizeError(supportState.message || 'Поддержка скоро появится здесь.'),
        actionLabel: 'Обновить',
        onAction: () => setSupportRefreshNonce((value) => value + 1)
      };
    }

    return null;
  }, [navigate, ready, session, supportState]);

  return (
    <div className="app-shell">
      <div className="site-noise site-noise-a" aria-hidden="true" />
      <div className="site-noise site-noise-b" aria-hidden="true" />

      <header className="shell-header">
        <div className="shell-header-inner">
          <NavLink className="brand-link" to="/" end aria-label="NeuralV home">
            <span className="brand-badge" aria-hidden="true">
              <span className="brand-badge-core" />
            </span>
            <span className="brand-name">NeuralV</span>
          </NavLink>

          <button
            className={`shell-burger${menuOpen ? ' is-open' : ''}`}
            type="button"
            aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span className="shell-burger-line" />
            <span className="shell-burger-line" />
            <span className="shell-burger-line" />
          </button>
        </div>
      </header>

      <div
        className={`shell-overlay-scrim${menuOpen ? ' is-open' : ''}`}
        aria-hidden={!menuOpen}
        onClick={() => setMenuOpen(false)}
      />

      <aside className={`shell-drawer${menuOpen ? ' is-open' : ''}`} aria-hidden={!menuOpen}>
        <div className="shell-drawer-panel">
          <div className="shell-drawer-head">
            <strong>Меню</strong>
          </div>

          <div className="shell-drawer-section">
            <span>Сайт</span>
            <div className="shell-drawer-list">
              {productLinks.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `shell-drawer-link${isActive ? ' is-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="shell-drawer-section">
            <span>Клиенты</span>
            <div className="shell-drawer-list">
              {clientLinks.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `shell-drawer-link${isActive ? ' is-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="shell-drawer-section">
            <span>Аккаунт</span>
            <div className="shell-drawer-list">
              {accountLinks.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `shell-drawer-link${isActive ? ' is-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>

          <div className="shell-drawer-section">
            <span>Поддержка</span>
            <button
              className="shell-drawer-link shell-drawer-link-button"
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setSupportOpen(true);
              }}
            >
              Открыть чат
            </button>
          </div>

          {ready && session ? (
            <button className="shell-chip shell-chip-danger shell-drawer-logout" type="button" onClick={handleLogout}>
              Выйти
            </button>
          ) : null}
        </div>
      </aside>

      <main className="page-frame">
        <Outlet />
      </main>

      <SupportChatWidget
        open={supportOpen}
        onOpenChange={setSupportOpen}
        title="Чат поддержки"
        launcherLabel="Нужна помощь?"
        launcherUnreadCount={launcherUnreadCount}
        launcherPending={supportLoading || supportSending}
        messages={mapSupportMessages(supportState)}
        loading={supportLoading}
        refreshing={supportLoading && Boolean(supportState)}
        sending={supportSending}
        unavailable={widgetUnavailable}
        emptyTitle="Напишите в поддержку"
        emptyDescription=""
        onSend={handleSupportSend}
      />

      <footer className="site-footer">
        <div className="site-footer-grid">
          <div className="footer-title">NeuralV</div>
          <nav className="site-footer-links" aria-label="Навигация внизу сайта">
            {productLinks.concat(clientLinks).map((item) => (
              <NavLink
                key={item.to}
                className="footer-link"
                to={item.to}
                end={item.to === '/'}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="footer-meta">NeuralV © {currentYear}</div>
        </div>
      </footer>
    </div>
  );
}
