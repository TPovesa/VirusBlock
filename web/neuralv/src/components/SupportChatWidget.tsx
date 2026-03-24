import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import '../styles/support-chat.css';

export type SupportChatRole = 'user' | 'agent' | 'system';
export type SupportChatAttachmentKind = 'photo' | 'video';

export type SupportChatAttachment = {
  id: string;
  kind: SupportChatAttachmentKind;
  url: string;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  pending?: boolean;
};

export type SupportChatDraftAttachment = {
  kind: SupportChatAttachmentKind;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  dataUrl: string;
  previewUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

export type SupportChatMessage = {
  id: string;
  role: SupportChatRole;
  text: string;
  author?: string;
  createdAt?: string | number | Date | null;
  pending?: boolean;
  failed?: boolean;
  meta?: string;
  attachments?: SupportChatAttachment[];
  clientPayload?: SupportChatSendPayload;
};

export type SupportChatUnavailableState = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type SupportChatSendPayload = {
  text: string;
  attachment?: SupportChatDraftAttachment | null;
};

export type SupportChatWidgetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  launcherLabel?: string;
  launcherUnreadCount?: number;
  messages?: SupportChatMessage[];
  sending?: boolean;
  unavailable?: SupportChatUnavailableState | null;
  placeholder?: string;
  canSend?: boolean;
  inputDisabled?: boolean;
  onSend?: (payload: SupportChatSendPayload) => void | Promise<void>;
  onRetryMessage?: (message: SupportChatMessage) => void | Promise<void>;
  emptyTitle?: string;
  emptyDescription?: string;
  helperText?: string;
  sendLabel?: string;
};

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

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Не удалось прочитать файл.'));
    reader.readAsDataURL(file);
  });
}

async function readVideoMeta(file: File) {
  const previewUrl = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const meta = await new Promise<{ width: number; height: number; durationSeconds: number }>((resolve, reject) => {
      video.onloadedmetadata = () => {
        resolve({
          width: video.videoWidth || 0,
          height: video.videoHeight || 0,
          durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : 0
        });
      };
      video.onerror = () => reject(new Error('Не удалось прочитать параметры видео.'));
      video.src = previewUrl;
    });
    return { ...meta, previewUrl };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    throw error;
  }
}

export function SupportChatWidget({
  open,
  defaultOpen = false,
  onOpenChange,
  title = 'Чат поддержки',
  launcherLabel = 'Чат поддержки',
  launcherUnreadCount = 0,
  messages = [],
  sending = false,
  unavailable,
  placeholder = 'Напишите в поддержку…',
  canSend = true,
  inputDisabled = false,
  onSend,
  onRetryMessage,
  emptyTitle = 'Напишите в поддержку',
  emptyDescription = '',
  helperText = '',
  sendLabel = 'Отправить'
}: SupportChatWidgetProps) {
  const [isOpen, setIsOpen] = useControllableState(open, defaultOpen, onOpenChange);
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftAttachment, setDraftAttachment] = useState<SupportChatDraftAttachment | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<SupportChatAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState<string>('');
  const [localPreviewUrls, setLocalPreviewUrls] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  const unreadBadge = launcherUnreadCount > 99 ? '99+' : launcherUnreadCount > 0 ? String(launcherUnreadCount) : null;
  const unavailableState = unavailable ?? null;
  const isUnavailable = Boolean(unavailableState);
  const sendDisabled = inputDisabled || !canSend || !onSend || (!draft.trim() && !draftAttachment) || isSubmitting || sending || isUnavailable;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const node = listRef.current;
    if (node) {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
    }
  }, [isOpen, lastMessageId]);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) {
      return;
    }
    node.style.height = '0px';
    node.style.height = `${Math.min(node.scrollHeight, 192)}px`;
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
        setPreviewAttachment(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, setIsOpen]);

  useEffect(() => {
    return () => {
      localPreviewUrls.forEach((url) => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [localPreviewUrls]);

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);
  const handleClose = useCallback(() => {
    setPreviewAttachment(null);
    setIsOpen(false);
  }, [setIsOpen]);

  const clearAttachment = useCallback(() => {
    if (draftAttachment?.previewUrl) {
      URL.revokeObjectURL(draftAttachment.previewUrl);
      setLocalPreviewUrls((current) => current.filter((entry) => entry !== draftAttachment.previewUrl));
    }
    setDraftAttachment(null);
    setAttachmentError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [draftAttachment]);

  const handleSubmit = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !draftAttachment) || sendDisabled || !onSend) {
      return;
    }

    const payload: SupportChatSendPayload = {
      text,
      attachment: draftAttachment
    };

    if (draftAttachment?.previewUrl) {
      setLocalPreviewUrls((current) => current.filter((entry) => entry !== draftAttachment.previewUrl));
    }

    setDraft('');
    setDraftAttachment(null);
    setAttachmentError('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    try {
      setIsSubmitting(true);
      await onSend(payload);
    } catch (error) {
      setDraft(text);
      setDraftAttachment(payload.attachment || null);
      setAttachmentError(error instanceof Error ? error.message : 'Не удалось отправить сообщение.');
    } finally {
      setIsSubmitting(false);
    }
  }, [draft, draftAttachment, onSend, sendDisabled]);

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

  const handleAttachmentChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      setAttachmentError('');
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        throw new Error('Поддерживаются только фото и видео.');
      }
      const dataUrl = await readFileAsDataUrl(file);
      let nextAttachment: SupportChatDraftAttachment;
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        setLocalPreviewUrls((current) => current.concat(previewUrl));
        nextAttachment = {
          kind: 'photo',
          fileName: file.name,
          mimeType: file.type || 'image/jpeg',
          fileSizeBytes: file.size,
          dataUrl,
          previewUrl
        };
      } else {
        const meta = await readVideoMeta(file);
        setLocalPreviewUrls((current) => current.concat(meta.previewUrl));
        nextAttachment = {
          kind: 'video',
          fileName: file.name,
          mimeType: file.type || 'video/mp4',
          fileSizeBytes: file.size,
          dataUrl,
          previewUrl: meta.previewUrl,
          width: meta.width,
          height: meta.height,
          durationSeconds: meta.durationSeconds
        };
      }
      if (draftAttachment?.previewUrl) {
        URL.revokeObjectURL(draftAttachment.previewUrl);
      }
      setDraftAttachment(nextAttachment);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Не удалось подготовить вложение.');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [draftAttachment]);

  const renderedMessages = useMemo(() => messages, [messages]);

  return (
    <>
      <div className="support-chat__dock" data-state={isUnavailable ? 'unavailable' : 'active'}>
        <button
          className="support-chat__launcher"
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
          <span className="support-chat__launcher-copy support-chat__launcher-copy--single">
            <strong>{launcherLabel}</strong>
          </span>
          {unreadBadge ? <span className="support-chat__badge">{unreadBadge}</span> : null}
        </button>
      </div>

      {isOpen ? (
        <div className="support-chat__shell is-open" aria-hidden={false}>
          <button className="support-chat__scrim" type="button" onClick={handleClose} aria-label="Закрыть чат" />

          <section className="support-chat__panel" id="support-chat-panel" aria-label={title} role="dialog" aria-modal="true">
            <header className="support-chat__header">
              <div className="support-chat__title-block">
                <h2>{title}</h2>
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
                    {renderedMessages.length ? (
                      renderedMessages.map((message) => {
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
                            {message.text ? <div className="support-chat__message-body">{message.text}</div> : null}
                            {message.attachments?.length ? (
                              <div className="support-chat__media-grid">
                                {message.attachments.map((attachment) => (
                                  <button
                                    key={attachment.id}
                                    type="button"
                                    className={`support-chat__media-card support-chat__media-card--${attachment.kind}`}
                                    onClick={() => setPreviewAttachment(attachment)}
                                  >
                                    {attachment.kind === 'video' ? (
                                      <>
                                        <video className="support-chat__media-card-video" src={attachment.thumbnailUrl || attachment.url} muted playsInline preload="metadata" />
                                        <span className="support-chat__media-play">▶</span>
                                      </>
                                    ) : (
                                      <img className="support-chat__media-card-image" src={attachment.thumbnailUrl || attachment.url} alt={attachment.fileName || 'Вложение'} loading="lazy" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            ) : null}
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
                        {emptyDescription ? <p>{emptyDescription}</p> : null}
                      </div>
                    )}
                  </div>

                  <div className="support-chat__composer-shell">
                    <label className="support-chat__composer">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        className="support-chat__file-input"
                        onChange={handleAttachmentChange}
                      />
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
                      <button
                        className="support-chat__attach"
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={inputDisabled || isSubmitting || sending}
                        aria-label="Добавить фото или видео"
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        className="support-chat__send"
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={sendDisabled}
                        aria-label={isSubmitting || sending ? 'Отправка сообщения' : sendLabel}
                      >
                        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M4 11.75 19.5 4.5l-3.55 15-4.95-5.1L4 11.75Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
                          <path d="M10.8 14.3 19.5 4.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                        </svg>
                      </button>
                    </label>
                    {draftAttachment ? (
                      <div className="support-chat__draft-media">
                        <div className={`support-chat__draft-chip support-chat__draft-chip--${draftAttachment.kind}`}>
                          {draftAttachment.previewUrl ? (
                            draftAttachment.kind === 'video' ? (
                              <video src={draftAttachment.previewUrl} muted playsInline preload="metadata" className="support-chat__draft-thumb" />
                            ) : (
                              <img src={draftAttachment.previewUrl} alt={draftAttachment.fileName} className="support-chat__draft-thumb" loading="lazy" />
                            )
                          ) : null}
                          <div className="support-chat__draft-copy">
                            <strong>{draftAttachment.fileName}</strong>
                            <span>{draftAttachment.kind === 'video' ? 'Видео' : 'Фото'}</span>
                          </div>
                          <button type="button" className="support-chat__draft-remove" onClick={clearAttachment} aria-label="Убрать вложение">×</button>
                        </div>
                      </div>
                    ) : null}
                    {attachmentError ? <div className="support-chat__composer-note support-chat__composer-note--error">{attachmentError}</div> : null}
                    {!attachmentError && helperText ? <div className="support-chat__composer-note">{helperText}</div> : null}
                  </div>
                </>
              )}
            </div>
          </section>

          {previewAttachment ? (
            <div className="support-chat__preview-shell" role="dialog" aria-modal="true" aria-label="Просмотр вложения">
              <button type="button" className="support-chat__preview-scrim" onClick={() => setPreviewAttachment(null)} aria-label="Закрыть просмотр" />
              <div className="support-chat__preview-card">
                <button type="button" className="support-chat__preview-close" onClick={() => setPreviewAttachment(null)} aria-label="Закрыть просмотр">×</button>
                {previewAttachment.kind === 'video' ? (
                  <video className="support-chat__preview-video" src={previewAttachment.url} controls autoPlay playsInline preload="metadata" />
                ) : (
                  <img className="support-chat__preview-image" src={previewAttachment.url} alt={previewAttachment.fileName || 'Вложение'} loading="eager" />
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
