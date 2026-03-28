import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSiteAuth } from './SiteAuthProvider';
import {
  SupportChatWidget,
  type SupportChatAttachment as WidgetSupportChatAttachment,
  type SupportChatDraftAttachment as WidgetSupportChatDraftAttachment,
  type SupportChatMessage as WidgetSupportChatMessage,
  type SupportChatSendPayload as WidgetSupportChatSendPayload
} from './SupportChatWidget';
import {
  fetchSupportChatState,
  humanizeError,
  openSupportChat,
  sendSupportChatMessage,
  type SiteSupportChatAttachment,
  type SiteSupportChatDraftAttachment,
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

type OptimisticSupportMessage = WidgetSupportChatMessage & {
  clientPayload?: WidgetSupportChatSendPayload;
};

function parseTimestamp(value: string | number | Date | null | undefined) {
  if (!value) {
    return 0;
  }
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSupportAttachment(attachment: SiteSupportChatAttachment): WidgetSupportChatAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    url: attachment.url,
    thumbnailUrl: attachment.thumbnailUrl || undefined,
    mimeType: attachment.mimeType || undefined,
    fileName: attachment.fileName || undefined,
    fileSizeBytes: attachment.fileSizeBytes || undefined,
    width: attachment.width || undefined,
    height: attachment.height || undefined,
    durationSeconds: attachment.durationSeconds || undefined
  };
}

function mapDraftAttachment(attachment: WidgetSupportChatDraftAttachment | undefined | null): WidgetSupportChatAttachment[] {
  if (!attachment) {
    return [];
  }
  return [
    {
      id: `draft-${Math.random().toString(36).slice(2)}`,
      kind: attachment.kind,
      url: attachment.dataUrl,
      thumbnailUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      fileSizeBytes: attachment.fileSizeBytes,
      width: attachment.width || undefined,
      height: attachment.height || undefined,
      durationSeconds: attachment.durationSeconds || undefined
    }
  ];
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
    pending: message.deliveryStatus === 'QUEUED',
    failed: message.deliveryStatus === 'FAILED',
    attachments: (message.attachments || []).map((attachment) => mapSupportAttachment(attachment)),
    meta:
      message.deliveryStatus === 'FAILED'
        ? (message.deliveryError || 'Не удалось отправить сообщение.')
        : message.senderRole === 'support'
          ? 'Поддержка'
          : message.senderRole === 'system'
            ? 'Система'
            : undefined
  }));
}

function mapOutgoingAttachment(attachment: WidgetSupportChatDraftAttachment | null | undefined): SiteSupportChatDraftAttachment | undefined {
  if (!attachment) {
    return undefined;
  }
  return {
    kind: attachment.kind,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSizeBytes: attachment.fileSizeBytes,
    dataUrl: attachment.dataUrl,
    previewUrl: attachment.previewUrl,
    width: attachment.width,
    height: attachment.height,
    durationSeconds: attachment.durationSeconds
  };
}

export function AppShell() {
  const { ready, session, user, logout } = useSiteAuth();
  const currentYear = new Date().getFullYear();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportState, setSupportState] = useState<SiteSupportChatState | null>(null);
  const [supportOptimisticMessages, setSupportOptimisticMessages] = useState<OptimisticSupportMessage[]>([]);
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

  const scrollWindowToTop = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.document.documentElement.scrollTop = 0;
    window.document.body.scrollTop = 0;
  }, []);

  const handleDrawerNavigate = useCallback(() => {
    setMenuOpen(false);
    scrollWindowToTop();
  }, [scrollWindowToTop]);

  useLayoutEffect(() => {
    setMenuOpen(false);
    scrollWindowToTop();

    const frame = window.requestAnimationFrame(() => {
      scrollWindowToTop();
      window.requestAnimationFrame(() => {
        scrollWindowToTop();
      });
    });
    const timer = window.setTimeout(() => {
      scrollWindowToTop();
    }, 96);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [location.hash, location.key, location.pathname, location.search, scrollWindowToTop]);

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
      return [
        { to: '/profile', label: user?.name || 'Профиль' }
      ];
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
  const latestSupportMessageStamp = useMemo(() => {
    const lastMessage = supportState?.messages?.[supportState.messages.length - 1];
    return parseTimestamp(lastMessage?.updatedAt || lastMessage?.createdAt || supportState?.chat?.updatedAt || supportState?.chat?.lastMessageAt || 0);
  }, [supportState]);

  const launcherUnreadCount = latestSupportReplyAt > supportSeenAt ? 1 : 0;
  const widgetMessages = useMemo<WidgetSupportChatMessage[]>(() => {
    return [...mapSupportMessages(supportState), ...supportOptimisticMessages];
  }, [supportOptimisticMessages, supportState]);

  const loadSupportState = useCallback(async (options?: { openIfMissing?: boolean }) => {
    if (!session) {
      setSupportState(null);
      setSupportOptimisticMessages([]);
      return;
    }

    const result = await fetchSupportChatState({ limit: 80, sync: 'poll' });
    if (result.ok && result.data) {
      let nextState = result.data;
      if (options?.openIfMissing && result.data.availability && !result.data.chat) {
        const opened = await openSupportChat();
        if (opened.ok && opened.data) {
          nextState = opened.data;
        }
      }
      setSupportState(nextState);
      return;
    }

    if (!supportState) {
      setSupportState({
        availability: false,
        message: result.error || 'Поддержка временно недоступна.',
        messages: []
      });
    }
  }, [session, supportState]);

  useEffect(() => {
    if (!supportOpen || !session) {
      return;
    }
    void loadSupportState({ openIfMissing: true });
  }, [loadSupportState, session, supportOpen, supportRefreshNonce]);

  useEffect(() => {
    if (!supportOpen || !session) {
      return;
    }
    const pollAfterMs = Math.max(1500, Number(supportState?.pollAfterMs || 0) || 3000);
    const timer = window.setTimeout(() => {
      void loadSupportState({ openIfMissing: false });
    }, pollAfterMs);
    return () => window.clearTimeout(timer);
  }, [latestSupportMessageStamp, loadSupportState, session, supportOpen, supportState?.pollAfterMs]);

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
    setSupportOptimisticMessages([]);
  }

  async function handleSupportSend(payload: WidgetSupportChatSendPayload) {
    if (!session) {
      navigate('/login');
      return;
    }

    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage: OptimisticSupportMessage = {
      id: optimisticId,
      role: 'user',
      text: payload.text,
      author: user?.name || 'Ты',
      createdAt: new Date().toISOString(),
      pending: true,
      attachments: mapDraftAttachment(payload.attachment),
      clientPayload: payload
    };

    setSupportOptimisticMessages((current) => [...current, optimisticMessage]);
    const result = await sendSupportChatMessage(
      {
        text: payload.text,
        attachment: mapOutgoingAttachment(payload.attachment)
      },
      supportState?.chat?.id
    );

    if (result.ok && result.data) {
      setSupportOptimisticMessages((current) => current.filter((message) => message.id !== optimisticId && message.failed));
      setSupportState(result.data);
      setSupportSeenAt((current) => Math.max(current, latestSupportReplyAt));
    } else {
      setSupportOptimisticMessages((current) =>
        current.map((message) =>
          message.id === optimisticId
            ? {
                ...message,
                pending: false,
                failed: true,
                meta: result.error || 'Не удалось отправить сообщение.'
              }
            : message
        )
      );
    }
  }

  const handleSupportRetry = useCallback(async (message: WidgetSupportChatMessage) => {
    const payload = (message as OptimisticSupportMessage).clientPayload;
    if (!payload) {
      return;
    }
    setSupportOptimisticMessages((current) => current.filter((entry) => entry.id !== message.id));
    await handleSupportSend(payload);
  }, [handleSupportSend]);

  const widgetUnavailable = useMemo(() => {
    if (!ready) {
      return null;
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
          <NavLink
            className="brand-link"
            to="/"
            end
            aria-label="NeuralV home"
            onClick={scrollWindowToTop}
          >
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
          <div className="shell-drawer-body">
            <div className="shell-drawer-section">
              <span>Сайт</span>
              <div className="shell-drawer-list">
                {productLinks.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) => `shell-drawer-link${isActive ? ' is-active' : ''}`}
                    onClick={handleDrawerNavigate}
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
                    onClick={handleDrawerNavigate}
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
                    onClick={handleDrawerNavigate}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
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
        messages={widgetMessages}
        unavailable={widgetUnavailable}
        emptyTitle="Напишите в поддержку"
        emptyDescription=""
        onSend={handleSupportSend}
        onRetryMessage={handleSupportRetry}
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
                onClick={scrollWindowToTop}
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
