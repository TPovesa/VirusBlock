import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import '../styles/support-chat.css';

export type SupportChatRole = 'user' | 'agent' | 'system';

export type SupportChatMessage = {
  id: string;
  role: SupportChatRole;
  text: string;
  author?: string;
  createdAt?: string | number | Date | null;
  pending?: boolean;
  failed?: boolean;
  meta?: string;
};

export type SupportChatUnavailableState = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type SupportChatWidgetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  subtitle?: string;
  launcherLabel?: string;
  launcherUnreadCount?: number;
  launcherPending?: boolean;
  statusLabel?: string;
  nextPollLabel?: string;
  messages?: SupportChatMessage[];
  loading?: boolean;
  refreshing?: boolean;
  sending?: boolean;
  unavailable?: SupportChatUnavailableState | null;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  canSend?: boolean;
  inputDisabled?: boolean;
  onValueChange?: (value: string) => void;
  onSend?: (text: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onRetryMessage?: (message: SupportChatMessage) => void | Promise<void>;
  emptyTitle?: string;
  emptyDescription?: string;
  closeLabel?: string;
  sendLabel?: string;
  refreshLabel?: string;
};

const DEFAULT_EMPTY_TITLE = 'Поддержка на связи';
const DEFAULT_EMPTY_DESCRIPTION = 'История переписки появится здесь, как только начнётся диалог.';

function formatTimestamp(value?: string | number | Date | null) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function useControllableState<T>(controlled: T | undefined, defaultValue: T, onChange?: (value: T) => void) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : uncontrolled;

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) {
        setUncontrolled(next);
      }
      onChange?.(next);
    },
    [isControlled, onChange]
  );

  return [value, setValue] as const;
}

function SupportChatSkeleton() {
  return (
    <div className="support-chat__skeleton" aria-hidden="true">
      <span className="support-chat__skeleton-line support-chat__skeleton-line-short" />
      <span className="support-chat__skeleton-line" />
      <span className="support-chat__skeleton-line support-chat__skeleton-line-medium" />
    </div>
  );
}

export function SupportChatWidget({
  open,
  defaultOpen = false,
  onOpenChange,
  title = 'Поддержка',
  subtitle = '',
  launcherLabel = 'Поддержка',
  launcherUnreadCount = 0,
  launcherPending = false,
  statusLabel,
  nextPollLabel,
  messages = [],
  loading = false,
  refreshing = false,
  sending = false,
  unavailable,
  placeholder = 'Опиши вопрос…',
  value,
  defaultValue = '',
  canSend = true,
  inputDisabled = false,
  onValueChange,
  onSend,
  onRefresh,
  onRetryMessage,
  emptyTitle = DEFAULT_EMPTY_TITLE,
  emptyDescription = DEFAULT_EMPTY_DESCRIPTION,
  closeLabel = 'Закрыть',
  sendLabel = 'Отправить',
  refreshLabel = 'Обновить'
}: SupportChatWidgetProps) {
  const [isOpen, setIsOpen] = useControllableState(open, defaultOpen, onOpenChange);
  const [draft, setDraft] = useControllableState(value, defaultValue, onValueChange);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  const unreadBadge = launcherUnreadCount > 99 ? '99+' : launcherUnreadCount > 0 ? String(launcherUnreadCount) : null;
  const unavailableState = unavailable ?? null;
  const isUnavailable = Boolean(unavailableState);
  const sendDisabled = inputDisabled || !canSend || !onSend || !draft.trim() || isSubmitting || sending || isUnavailable;
  const surfaceStatus = useMemo(() => {
    if (isUnavailable) {
      return 'Недоступно';
    }
    if (sending || isSubmitting) {
      return 'Отправка';
    }
    if (refreshing) {
      return statusLabel || 'Обновляется';
    }
    return statusLabel || 'Онлайн';
  }, [isSubmitting, isUnavailable, refreshing, sending, statusLabel]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const node = listRef.current;
    if (!node) {
      return;
    }

    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [isOpen, lastMessageId]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    node.style.height = '0px';
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft, isOpen]);

  useEffect(() => {
    if (!isOpen || isUnavailable) {
      return;
    }

    const node = textareaRef.current;
    if (!node) {
      return;
    }

    const frame = window.requestAnimationFrame(() => node.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, isUnavailable]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, setIsOpen]);

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);
  const handleClose = useCallback(() => setIsOpen(false), [setIsOpen]);

  const handleSubmit = useCallback(async () => {
    const message = draft.trim();
    if (!message || sendDisabled || !onSend) {
      return;
    }

    try {
      setIsSubmitting(true);
      await onSend(message);
      if (value === undefined) {
        setDraft('');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, onSend, sendDisabled, setDraft, value]);

  const handleKeyDown = useCallback(
    async (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey) {
        return;
      }

      event.preventDefault();
      await handleSubmit();
    },
    [handleSubmit]
  );

  return (
    <div className={`support-chat${isOpen ? ' is-open' : ''}`} data-state={isUnavailable ? 'unavailable' : 'active'}>
      <button
        className={`support-chat__launcher${launcherPending ? ' is-pending' : ''}`}
        type="button"
        onClick={handleOpen}
        aria-expanded={isOpen}
        aria-controls="support-chat-panel"
      >
        <span className="support-chat__launcher-core" aria-hidden="true">
          <span className="support-chat__launcher-ripple" />
          <svg viewBox="0 0 24 24" className="support-chat__launcher-icon" fill="none">
            <path d="M5 7.5C5 5.567 6.567 4 8.5 4h7C17.433 4 19 5.567 19 7.5v4.75C19 14.183 17.433 15.75 15.5 15.75H11.9L8.25 19v-3.25h-.75C5.567 15.75 4 14.183 4 12.25V7.5Z" />
            <path d="M8 9.25h8M8 12h5.5" />
          </svg>
        </span>
        <span className="support-chat__launcher-copy">
          <strong>{launcherLabel}</strong>
          <span>{surfaceStatus}</span>
        </span>
        {unreadBadge ? <span className="support-chat__badge">{unreadBadge}</span> : null}
      </button>

      <div className={`support-chat__shell${isOpen ? ' is-open' : ''}`} aria-hidden={!isOpen}>
        <button className="support-chat__scrim" type="button" onClick={handleClose} tabIndex={isOpen ? 0 : -1} />

        <section className="support-chat__panel" id="support-chat-panel" aria-label={title}>
          <header className="support-chat__header">
            <div className="support-chat__title-block">
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>

            <div className="support-chat__header-actions">
              <div className={`support-chat__status${refreshing ? ' is-refreshing' : ''}`}>
                <span className="support-chat__status-dot" />
                <span>{surfaceStatus}</span>
              </div>
              {nextPollLabel ? <div className="support-chat__meta">{nextPollLabel}</div> : null}
              {onRefresh ? (
                <button className="support-chat__ghost" type="button" onClick={() => void onRefresh()} disabled={refreshing}>
                  {refreshLabel}
                </button>
              ) : null}
              <button className="support-chat__ghost" type="button" onClick={handleClose}>
                {closeLabel}
              </button>
            </div>
          </header>

          <div className="support-chat__body">
            {isUnavailable ? (
              <div className="support-chat__unavailable">
                <div className="support-chat__unavailable-icon" aria-hidden="true">!</div>
                <strong>{unavailableState?.title || 'Чат сейчас недоступен'}</strong>
                <p>{unavailableState?.description || 'Панель уже готова, но соединение с поддержкой пока не открыто.'}</p>
                {unavailableState?.actionLabel && unavailableState.onAction ? (
                  <button className="nv-button" type="button" onClick={unavailableState.onAction}>
                    {unavailableState.actionLabel}
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="support-chat__timeline" ref={listRef}>
                  {loading ? (
                    <>
                      <SupportChatSkeleton />
                      <SupportChatSkeleton />
                    </>
                  ) : messages.length ? (
                    messages.map((message) => {
                      const timestamp = formatTimestamp(message.createdAt);
                      return (
                        <article
                          key={message.id}
                          className={`support-chat__message support-chat__message--${message.role}${message.pending ? ' is-pending' : ''}${message.failed ? ' is-failed' : ''}`}
                        >
                          <div className="support-chat__message-head">
                            <strong>{message.author || (message.role === 'user' ? 'Ты' : message.role === 'agent' ? 'Поддержка' : 'Система')}</strong>
                            {timestamp ? <span>{timestamp}</span> : null}
                          </div>
                          <div className="support-chat__message-body">{message.text}</div>
                          {message.meta || message.pending || message.failed ? (
                            <div className="support-chat__message-meta-row">
                              <span className="support-chat__message-meta">
                                {message.failed ? 'Не отправилось' : message.pending ? 'Отправляется…' : message.meta}
                              </span>
                              {message.failed && onRetryMessage ? (
                                <button className="support-chat__text-button" type="button" onClick={() => void onRetryMessage(message)}>
                                  Повторить
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      );
                    })
                  ) : (
                    <div className="support-chat__empty">
                      <strong>{emptyTitle}</strong>
                      <p>{emptyDescription}</p>
                    </div>
                  )}
                </div>

                <div className="support-chat__composer-shell">
                  <label className="support-chat__composer">
                    <textarea
                      ref={textareaRef}
                      className="support-chat__input"
                      rows={1}
                      placeholder={placeholder}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => void handleKeyDown(event)}
                      disabled={inputDisabled || isSubmitting || sending}
                    />
                  </label>

                  <div className="support-chat__composer-actions">
                    <div className="support-chat__hint">Enter отправляет, Shift+Enter переносит строку.</div>
                    <button className="nv-button" type="button" onClick={() => void handleSubmit()} disabled={sendDisabled}>
                      {isSubmitting || sending ? 'Отправка…' : sendLabel}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
