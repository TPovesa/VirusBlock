const SITE_AUTH_STORAGE_KEY = 'neuralv-site-auth-session';
const SITE_AUTH_DEVICE_KEY = 'neuralv-site-auth-device-id';
const SITE_AUTH_EVENT = 'neuralv-site-auth-changed';
const ACCESS_REFRESH_SKEW_MS = 60_000;

const AUTH_BASE_URL = String(import.meta.env.VITE_SITE_AUTH_BASE_URL || '/basedata/api/auth').replace(/\/+$/, '');
const VERIFIED_APPS_BASE_URL = String(import.meta.env.VITE_SITE_VERIFIED_APPS_BASE_URL || '/basedata/api').replace(/\/+$/, '');

export type SiteAuthUser = {
  id: string;
  name: string;
  email: string;
  is_premium?: boolean;
  premium_expires_at?: string | number | null;
  is_developer_mode?: boolean;
  is_verified_developer?: boolean;
  verified_developer_at?: string | number | null;
  created_at?: string | number | null;
};

export type SiteUser = SiteAuthUser;

export type SiteAuthSession = {
  token: string;
  refreshToken: string;
  sessionId: string;
  deviceId: string;
  accessTokenExpiresAt?: string | number | null;
  refreshTokenExpiresAt?: string | number | null;
  user: SiteAuthUser;
  savedAt: number;
};

export type SiteSession = SiteAuthSession;

export type SiteAuthChallenge = {
  challengeId: string;
  email: string;
  expiresAt?: string | number | null;
  message?: string;
};

export type SiteAuthPasswordResetRequest = {
  email: string;
};

export type SiteAuthPasswordResetCodeRequest = {
  email: string;
};

export type SiteAuthPasswordResetConfirm = {
  email: string;
  token: string;
  password: string;
};

export type SiteAuthPasswordResetCodeConfirm = {
  email: string;
  code: string;
  password: string;
};

export type SiteAuthResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  status?: number;
  retryAfterMs?: number;
};

export type PasswordStrength = {
  score: number;
  label: 'weak' | 'fair' | 'good' | 'strong';
  tone: 'weak' | 'medium' | 'strong' | 'excellent';
  percent: number;
  hints: string[];
  rules: Array<{
    id: 'length' | 'uppercase' | 'digit' | 'special';
    label: string;
    passed: boolean;
  }>;
};

export type SiteProfileActionPreview = {
  kind: 'profile_name_change' | 'profile_email_change' | 'profile_password_change';
  title: string;
  email: string;
  expiresAt?: string | number | null;
  pendingName?: string;
  currentEmail?: string;
  nextEmail?: string;
  maskedEmail?: string;
};

export type SitePasswordResetPreview = {
  action: 'password_reset';
  title: string;
  email: string;
  expiresAt?: string | number | null;
};

export type SiteDeveloperApplication = {
  id?: string;
  status?: string;
  message?: string;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  mailedAt?: string | number | null;
  reviewedAt?: string | number | null;
  reviewNote?: string | null;
};

export type SiteDeveloperPortalState = {
  verifiedDeveloper: boolean;
  verifiedDeveloperAt?: string | number | null;
  user?: SiteAuthUser | null;
  latestApplication?: SiteDeveloperApplication | null;
  developerMode?: {
    enabled: boolean;
    source?: string | null;
  };
  stats?: {
    total: number;
    safe: number;
    running: number;
    queued: number;
    failed: number;
  };
};

export type SiteDeveloperApplicationState = 'none' | 'pending' | 'rejected' | 'approved';

export type SiteVerifiedAppPlatform = 'android' | 'windows' | 'linux' | 'plugins' | 'heroku';
export type SiteVerifiedAppFilter = 'all' | SiteVerifiedAppPlatform;

export type SiteVerifiedAppGroup = {
  id: string;
  label: string;
  items: Array<{
    value: SiteVerifiedAppFilter;
    label: string;
  }>;
};

export type SiteVerifiedApp = {
  id?: string;
  platform: SiteVerifiedAppPlatform | string;
  appName: string;
  authorName?: string;
  repositoryUrl?: string;
  releaseArtifactUrl?: string;
  officialSiteUrl?: string;
  avatarUrl?: string;
  sha256?: string;
  status?: string;
  publicSummary?: string;
  errorMessage?: string;
  artifactFileName?: string;
  artifactSizeBytes?: number;
  riskScore?: number;
  verifiedAt?: string | number | null;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
};

export const VERIFIED_APP_PLATFORM_OPTIONS: Array<{
  value: SiteVerifiedAppPlatform;
  label: string;
}> = [
  { value: 'windows', label: 'Windows' },
  { value: 'android', label: 'Android' },
  { value: 'linux', label: 'Linux' },
  { value: 'plugins', label: 'Plugins' },
  { value: 'heroku', label: 'Heroku' }
];

export const VERIFIED_APP_GROUPS: SiteVerifiedAppGroup[] = [
  {
    id: 'catalog',
    label: 'Каталог',
    items: [{ value: 'all', label: 'Все' }]
  },
  {
    id: 'apps',
    label: 'Приложения',
    items: VERIFIED_APP_PLATFORM_OPTIONS.filter((item) => item.value === 'windows' || item.value === 'android' || item.value === 'linux')
  },
  {
    id: 'integrations',
    label: 'Интеграции',
    items: VERIFIED_APP_PLATFORM_OPTIONS.filter((item) => item.value === 'plugins' || item.value === 'heroku')
  }
];

export type SiteVerifiedAppReviewRequest = {
  appName: string;
  platform: SiteVerifiedAppPlatform;
  repositoryUrl: string;
  releaseArtifactUrl: string;
  officialSiteUrl?: string;
};

export type SiteProfileSystem = {
  platform: string;
  clientKey: string;
  clientName: string;
  clientGlyph: string;
  clientAccent: string;
  active: boolean;
  available: boolean;
  statusLabel: string;
  blockedAds: number;
  blockedThreats: number;
  lastSeenAt?: string | number | null;
  lastEventAt?: string | number | null;
};

export type SiteProfileScan = {
  id: string;
  source: string;
  platform: string;
  clientKey: string;
  clientName: string;
  clientGlyph: string;
  clientAccent: string;
  mode: string;
  status: string;
  verdict?: string | null;
  riskScore?: number | null;
  threatsFound: number;
  totalScanned?: number | null;
  label: string;
  message: string;
  createdAt?: string | number | null;
  startedAt?: string | number | null;
  completedAt?: string | number | null;
  updatedAt?: string | number | null;
};

export type SiteProfileOverview = {
  systems: SiteProfileSystem[];
  scans: SiteProfileScan[];
  totalScans: number;
  scanSources: {
    legacy?: number;
    deep?: number;
    desktop?: number;
  };
};

export type SiteSupportChatEnvelope = {
  id: string;
  ticketNumber: number;
  status: string;
  lastMessageFrom?: 'client' | 'support' | 'system' | null;
  lastMessageAt?: string | number | null;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
};

export type SiteSupportChatMessage = {
  id: string;
  senderRole: 'client' | 'support' | 'system';
  senderName?: string | null;
  text: string;
  messageKind?: 'TEXT' | 'PHOTO' | 'VIDEO';
  deliveryStatus?: 'QUEUED' | 'SENT' | 'FAILED';
  deliveryError?: string | null;
  source?: string | null;
  createdAt?: string | number | null;
  updatedAt?: string | number | null;
  attachments?: SiteSupportChatAttachment[];
};

export type SiteSupportChatState = {
  availability: boolean;
  message?: string;
  pollAfterMs?: number;
  chat?: SiteSupportChatEnvelope | null;
  messages: SiteSupportChatMessage[];
};

export type SiteSupportChatAttachmentKind = 'photo' | 'video';

export type SiteSupportChatAttachment = {
  id: string;
  kind: SiteSupportChatAttachmentKind;
  url: string;
  thumbnailUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

export type SiteSupportChatDraftAttachment = {
  kind: SiteSupportChatAttachmentKind;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  dataUrl: string;
  previewUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

export type SiteSupportChatSendPayload = {
  text: string;
  attachment?: SiteSupportChatDraftAttachment | null;
};

type AuthResponsePayload = {
  token: string;
  refresh_token: string;
  session_id: string;
  access_token_expires_at?: string | number | null;
  refresh_token_expires_at?: string | number | null;
  user: SiteAuthUser;
};

type RequestOptions = RequestInit & {
  allowRefresh?: boolean;
  baseUrl?: string;
};

function hasWindow() {
  return typeof window !== 'undefined';
}

function now() {
  return Date.now();
}

function parseTimestamp(value: string | number | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function translateKnownMessage(value: string): string {
  const normalized = value.trim();
  const map: Record<string, string> = {
    'All fields are required': 'Заполните все обязательные поля.',
    'Email and password required': 'Введите e-mail и пароль.',
    'Invalid email address': 'Введите корректный e-mail.',
    'Email already registered': 'Этот e-mail уже занят.',
    'Email not found': 'Аккаунт с таким e-mail не найден.',
    'Challenge not found': 'Код подтверждения не найден.',
    'Challenge already used': 'Этот код подтверждения уже использован.',
    'Code expired': 'Срок действия кода истёк.',
    'Invalid code': 'Код подтверждения неверный.',
    'Invalid email or password': 'Неверный e-mail или пароль.',
    'Too many login attempts. Try again later.': 'Слишком много попыток входа. Попробуйте позже.',
    'Mail service is not configured': 'Почтовый сервис временно недоступен.',
    'Server error': 'Сервер временно не ответил. Попробуйте позже.',
    'Verification code sent to email': 'Код подтверждения отправлен на почту.',
    'If the email exists, a reset link has been sent': 'Если аккаунт существует, ссылка для сброса уже отправлена.',
    'Reset link sent to email': 'Ссылка для сброса пароля отправлена на почту.',
    'Reset code sent to email': 'Код для сброса пароля отправлен на почту.',
    'Password updated successfully': 'Пароль успешно обновлён.',
    'token and email required': 'Нужны token и e-mail.',
    'code, email and password required': 'Нужны код, e-mail и новый пароль.',
    'token, email and password required': 'Нужны token, e-mail и новый пароль.',
    'Reset token is invalid': 'Ссылка для сброса недействительна.',
    'Reset token already used': 'Эта ссылка для сброса уже использована.',
    'Reset token expired': 'Срок действия ссылки для сброса истёк.',
    'Reset code is invalid': 'Код для сброса недействителен.',
    'Reset code already used': 'Этот код для сброса уже использован.',
    'Reset code expired': 'Срок действия кода для сброса истёк.',
    'Session not found': 'Сессия не найдена.',
    'Session revoked': 'Сессия уже завершена.',
    'Device mismatch': 'Эта сессия привязана к другому устройству.',
    'Refresh token expired': 'Срок действия сессии истёк.',
    'Refresh token invalid': 'Сессия больше недействительна.',
    'Name required': 'Укажите имя.',
    'User not found': 'Аккаунт не найден.',
    'Developer key required': 'Нужен ключ разработчика.',
    'Developer mode is not configured': 'Режим разработчика сейчас недоступен.',
    'Invalid developer key': 'Ключ разработчика неверный.',
    'Developer mode enabled': 'Режим разработчика включён.',
    'Developer mode disabled': 'Режим разработчика выключен.',
    'Account deleted': 'Аккаунт удалён.',
    'Developer application email is not configured': 'Заявки разработчиков временно недоступны.',
    'Developer verification required': 'Нужен подтверждённый статус разработчика.',
    'developer_applications table is missing': 'Раздел заявок разработчиков временно недоступен.',
    'verified_apps table is missing': 'Каталог проверенных приложений временно недоступен.',
    'Developer application already pending': 'Заявка уже отправлена и ждёт подтверждения.',
    'Developer application cooldown active': 'Новая заявка пока недоступна. Подождите немного.',
    'Developer status already granted': 'Статус разработчика уже подтверждён.',
    'Too many active verification jobs': 'Сначала дождитесь завершения уже запущенных проверок.',
    'Verification submit cooldown active': 'Слишком частые заявки на проверку. Подождите немного.',
    'Verification already exists for this artifact': 'Для этого релиза проверка уже есть.',
    'Application name is required': 'Укажите название приложения.',
    'Unsupported platform': 'Платформа указана неверно.',
    'Public GitHub repository URL required': 'Нужна ссылка на публичный GitHub-репозиторий.',
    'GitHub release artifact URL required': 'Нужна ссылка на точный release artifact.',
    'Artifact must belong to the same repository': 'Релизный файл должен принадлежать этому же репозиторию.',
    'Invalid official site URL': 'Укажите корректный адрес сайта.',
    'Сообщение пустое.': 'Введите сообщение.',
    'Чат поддержки временно не настроен. Напишите позже или дождитесь, пока администратор добавит Telegram chat id и bot token.': 'Чат поддержки скоро появится здесь.',
    'Не удалось открыть диалог поддержки. Проверьте Telegram forum chat и настройки бота.': 'Не удалось открыть поддержку. Попробуйте позже.',
    'Не удалось открыть диалог поддержки. Проверьте forum chat, права бота и SUPPORT_TELEGRAM_CHAT_ID.': 'Не удалось открыть поддержку. Попробуйте позже.',
    'Не удалось открыть тему поддержки. Проверьте forum chat, права бота и SUPPORT_TELEGRAM_CHAT_ID.': 'Поддержка ещё не готова. Попробуйте позже.',
    'Не удалось восстановить тему поддержки. Проверьте forum chat, права бота и SUPPORT_TELEGRAM_CHAT_ID.': 'Поддержка ещё не готова. Попробуйте позже.',
    'У Telegram-чата нет forum topic. Проверьте SUPPORT_TELEGRAM_CHAT_ID и права бота.': 'Поддержка ещё не готова. Попробуйте позже.'
  };
  return map[normalized] || normalized;
}

function normalizeError(error: unknown, fallback = 'Не удалось выполнить запрос.'): string {
  if (error instanceof Error && error.message.trim()) {
    return translateKnownMessage(error.message.trim());
  }
  if (typeof error === 'string' && error.trim()) {
    return translateKnownMessage(error.trim());
  }
  return fallback;
}

function readMessage(payload: Record<string, unknown> | null | undefined): string | undefined {
  return typeof payload?.message === 'string' ? translateKnownMessage(payload.message) : undefined;
}

export function humanizeError(error: unknown, fallback = 'Не удалось выполнить действие.'): string {
  return normalizeError(error, fallback);
}

function createDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `site-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function notifyAuthSessionChanged() {
  if (!hasWindow()) {
    return;
  }
  window.dispatchEvent(new Event(SITE_AUTH_EVENT));
}

export function getSiteAuthDeviceId(): string {
  if (!hasWindow()) {
    return 'site-server';
  }

  const existing = window.localStorage.getItem(SITE_AUTH_DEVICE_KEY)?.trim();
  if (existing) {
    return existing;
  }

  const generated = createDeviceId();
  window.localStorage.setItem(SITE_AUTH_DEVICE_KEY, generated);
  return generated;
}

export function readStoredSiteSession(): SiteAuthSession | null {
  if (!hasWindow()) {
    return null;
  }

  const raw = window.localStorage.getItem(SITE_AUTH_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SiteAuthSession>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (!parsed.token || !parsed.refreshToken || !parsed.sessionId || !parsed.user || !parsed.deviceId) {
      return null;
    }

    return {
      token: String(parsed.token),
      refreshToken: String(parsed.refreshToken),
      sessionId: String(parsed.sessionId),
      deviceId: String(parsed.deviceId),
      accessTokenExpiresAt: parsed.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: parsed.refreshTokenExpiresAt ?? null,
      user: parsed.user as SiteAuthUser,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : now()
    };
  } catch {
    return null;
  }
}

export function readStoredSession(): SiteSession | null {
  return readStoredSiteSession();
}

export function storeSiteSession(session: SiteAuthSession): SiteAuthSession {
  if (hasWindow()) {
    window.localStorage.setItem(SITE_AUTH_STORAGE_KEY, JSON.stringify(session));
    notifyAuthSessionChanged();
  }
  return session;
}

export function storeSession(session: SiteSession | null): SiteSession | null {
  if (!session) {
    clearStoredSiteSession();
    return null;
  }
  return storeSiteSession(session);
}

export function clearStoredSiteSession() {
  if (hasWindow()) {
    window.localStorage.removeItem(SITE_AUTH_STORAGE_KEY);
    notifyAuthSessionChanged();
  }
}

export function isAccessTokenExpired(session: SiteAuthSession | null | undefined): boolean {
  if (!session) {
    return true;
  }
  const expiresAt = parseTimestamp(session.accessTokenExpiresAt);
  if (!expiresAt) {
    return false;
  }
  return expiresAt <= now() + ACCESS_REFRESH_SKEW_MS;
}

export function isRefreshTokenExpired(session: SiteAuthSession | null | undefined): boolean {
  if (!session) {
    return true;
  }
  const expiresAt = parseTimestamp(session.refreshTokenExpiresAt);
  if (!expiresAt) {
    return false;
  }
  return expiresAt <= now();
}

export function getStoredAccessToken(): string | null {
  return readStoredSiteSession()?.token ?? null;
}

export function subscribeToSiteAuthSession(listener: (session: SiteAuthSession | null) => void): () => void {
  if (!hasWindow()) {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== SITE_AUTH_STORAGE_KEY) {
      return;
    }
    listener(readStoredSiteSession());
  };

  const handleInternalChange = () => {
    listener(readStoredSiteSession());
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(SITE_AUTH_EVENT, handleInternalChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(SITE_AUTH_EVENT, handleInternalChange);
  };
}

function mapAuthResponse(payload: AuthResponsePayload): SiteAuthSession {
  return {
    token: payload.token,
    refreshToken: payload.refresh_token,
    sessionId: payload.session_id,
    deviceId: getSiteAuthDeviceId(),
    accessTokenExpiresAt: payload.access_token_expires_at ?? null,
    refreshTokenExpiresAt: payload.refresh_token_expires_at ?? null,
    user: payload.user,
    savedAt: now()
  };
}

async function parseResponse<T>(response: Response): Promise<SiteAuthResult<T>> {
  let payload: Record<string, unknown> | null = null;

  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        typeof payload?.error === 'string'
          ? translateKnownMessage(payload.error)
          : typeof payload?.message === 'string'
            ? translateKnownMessage(payload.message)
            : `HTTP ${response.status}`,
      retryAfterMs:
        typeof payload?.retry_after_ms === 'number'
          ? payload.retry_after_ms
          : typeof payload?.retry_after_ms === 'string'
            ? Number(payload.retry_after_ms)
            : undefined
    };
  }

  return { ok: true, status: response.status, data: payload as T };
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<SiteAuthResult<T>> {
  const {
    allowRefresh = true,
    baseUrl = AUTH_BASE_URL,
    headers,
    body,
    ...fetchOptions
  } = options;

  const isFormDataBody = typeof FormData !== 'undefined' && body instanceof FormData;

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      body,
      headers: {
        Accept: 'application/json',
        ...(!body || isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
        ...(headers || {})
      }
    });

    const parsed = await parseResponse<T>(response);

    if (
      parsed.status === 401 &&
      allowRefresh !== false &&
      !path.endsWith('/refresh') &&
      !path.endsWith('/login') &&
      !path.endsWith('/login/start') &&
      !path.endsWith('/login/verify')
    ) {
      const refreshed = await refreshStoredSiteSession();
      if (refreshed.ok && refreshed.data) {
        const retryHeaders = new Headers(headers || {});
        retryHeaders.set('Authorization', `Bearer ${refreshed.data.token}`);
        const retryResponse = await fetch(`${baseUrl}${path}`, {
          ...fetchOptions,
          body,
          headers: retryHeaders
        });
        return parseResponse<T>(retryResponse);
      }
    }

    return parsed;
  } catch (error) {
    return {
      ok: false,
      error: normalizeError(error, 'Сеть не ответила. Проверь соединение.')
    };
  }
}

function challengeFromPayload(payload: Record<string, unknown> | undefined): SiteAuthChallenge {
  return {
    challengeId: String(payload?.challenge_id || ''),
    email: String(payload?.email || ''),
    expiresAt: payload?.expires_at as string | number | null | undefined,
    message: readMessage(payload)
  };
}

function forwardFailure<T>(result: SiteAuthResult<unknown>, fallback: string): SiteAuthResult<T> {
  return {
    ok: false,
    status: result.status,
    error: result.error || fallback,
    retryAfterMs: result.retryAfterMs
  };
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  const rules = [
    { id: 'length', label: 'Минимум 8 символов', passed: password.length >= 8 },
    { id: 'uppercase', label: 'Хотя бы одна заглавная буква', passed: /[A-ZА-ЯЁ]/.test(password) },
    { id: 'digit', label: 'Хотя бы одна цифра', passed: /\d/.test(password) },
    { id: 'special', label: 'Хотя бы один спецсимвол', passed: /[^A-Za-zА-Яа-яЁё\d]/.test(password) }
  ] as const;

  let score = rules.filter((rule) => rule.passed).length;
  const hints = rules.filter((rule) => !rule.passed).map((rule) => rule.label.toLowerCase());

  if (/[a-zа-яё]/.test(password)) {
    score += 1;
  } else {
    hints.push('добавь строчную букву');
  }

  const label: PasswordStrength['label'] =
    score <= 1 ? 'weak' : score === 2 ? 'fair' : score <= 4 ? 'good' : 'strong';
  const tone: PasswordStrength['tone'] =
    label === 'weak' ? 'weak' : label === 'fair' ? 'medium' : label === 'good' ? 'strong' : 'excellent';

  return {
    score,
    label,
    tone,
    percent: Math.max(8, Math.min(100, Math.round((score / 5) * 100))),
    hints,
    rules: [...rules]
  };
}

export function validatePasswordStrength(password: string): string | null {
  const strength = evaluatePasswordStrength(password);
  const firstFailed = strength.rules.find((rule) => !rule.passed);
  return firstFailed ? firstFailed.label : null;
}

export async function startLogin(email: string, password: string): Promise<SiteAuthResult<SiteAuthChallenge>> {
  const result = await requestJson<Record<string, unknown>>('/login/start', {
    method: 'POST',
    body: JSON.stringify({ email, password, device_id: getSiteAuthDeviceId() }),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteAuthChallenge>;
  }

  return { ok: true, data: challengeFromPayload(result.data) };
}

export async function resendLoginCode(challengeId: string): Promise<SiteAuthResult<SiteAuthChallenge>> {
  const result = await requestJson<Record<string, unknown>>('/login/resend', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId }),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteAuthChallenge>;
  }

  return { ok: true, data: challengeFromPayload(result.data) };
}

export async function verifyLoginCode(challengeId: string, code: string): Promise<SiteAuthResult<SiteAuthSession>> {
  const result = await requestJson<AuthResponsePayload>('/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, code, device_id: getSiteAuthDeviceId() }),
    allowRefresh: false
  });

  if (!result.ok || !result.data) {
    return forwardFailure<SiteAuthSession>(result, 'Не удалось завершить вход.');
  }

  const session = storeSiteSession(mapAuthResponse(result.data));
  return { ok: true, data: session };
}

export async function startRegister(name: string, email: string, password: string): Promise<SiteAuthResult<SiteAuthChallenge>> {
  const result = await requestJson<Record<string, unknown>>('/register/start', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, device_id: getSiteAuthDeviceId() }),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteAuthChallenge>;
  }

  return { ok: true, data: challengeFromPayload(result.data) };
}

export async function resendRegisterCode(challengeId: string): Promise<SiteAuthResult<SiteAuthChallenge>> {
  const result = await requestJson<Record<string, unknown>>('/register/resend', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId }),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteAuthChallenge>;
  }

  return { ok: true, data: challengeFromPayload(result.data) };
}

export async function verifyRegisterCode(challengeId: string, code: string): Promise<SiteAuthResult<SiteAuthSession>> {
  const result = await requestJson<AuthResponsePayload>('/register/verify', {
    method: 'POST',
    body: JSON.stringify({ challenge_id: challengeId, code, device_id: getSiteAuthDeviceId() }),
    allowRefresh: false
  });

  if (!result.ok || !result.data) {
    return forwardFailure<SiteAuthSession>(result, 'Не удалось завершить регистрацию.');
  }

  const session = storeSiteSession(mapAuthResponse(result.data));
  return { ok: true, data: session };
}

export async function refreshStoredSiteSession(): Promise<SiteAuthResult<SiteAuthSession>> {
  const current = readStoredSiteSession();
  if (!current) {
    return { ok: false, error: 'Сессия не найдена.' };
  }
  if (isRefreshTokenExpired(current)) {
    clearStoredSiteSession();
    return { ok: false, error: 'Сессия истекла.' };
  }

  const result = await requestJson<AuthResponsePayload>('/refresh', {
    method: 'POST',
    body: JSON.stringify({
      refresh_token: current.refreshToken,
      session_id: current.sessionId,
      device_id: current.deviceId || getSiteAuthDeviceId()
    }),
    allowRefresh: false
  });

  if (!result.ok || !result.data) {
    clearStoredSiteSession();
    return forwardFailure<SiteAuthSession>(result, 'Не удалось обновить сессию.');
  }

  const session = storeSiteSession({
    ...mapAuthResponse(result.data),
    deviceId: current.deviceId || getSiteAuthDeviceId()
  });
  return { ok: true, data: session };
}

export async function refreshSession(current?: SiteSession | null): Promise<SiteSession> {
  if (current) {
    storeSiteSession(current);
  }
  const result = await refreshStoredSiteSession();
  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Не удалось обновить сессию.');
  }
  return result.data;
}

export async function ensureActiveSiteSession(): Promise<SiteAuthResult<SiteAuthSession>> {
  const current = readStoredSiteSession();
  if (!current) {
    return { ok: false, error: 'Сессия не найдена.' };
  }

  if (isAccessTokenExpired(current)) {
    return refreshStoredSiteSession();
  }

  return { ok: true, data: current };
}

export async function fetchCurrentSiteUser(): Promise<SiteAuthResult<SiteAuthSession>> {
  const sessionResult = await ensureActiveSiteSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult;
  }

  const result = await requestJson<{ user: SiteAuthUser }>('/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok || !result.data) {
    return forwardFailure<SiteAuthSession>(result, 'Не удалось получить профиль.');
  }

  const merged = storeSiteSession({
    ...sessionResult.data,
    user: result.data.user,
    savedAt: now()
  });

  return { ok: true, data: merged };
}

export async function fetchCurrentUser(token?: string): Promise<SiteUser> {
  if (token) {
    const result = await requestJson<{ user: SiteAuthUser }>('/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!result.ok || !result.data) {
      throw new Error(result.error || 'Не удалось загрузить профиль.');
    }
    return result.data.user;
  }

  const result = await fetchCurrentSiteUser();
  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Не удалось загрузить профиль.');
  }
  return result.data.user;
}

export async function logoutSiteSession(): Promise<SiteAuthResult<{ success: true }>> {
  const session = readStoredSiteSession();
  if (!session) {
    clearStoredSiteSession();
    return { ok: true, data: { success: true } };
  }

  const result = await requestJson<{ success: true }>('/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
    allowRefresh: false
  });

  clearStoredSiteSession();
  return result.ok ? result : { ok: true, data: { success: true } };
}

export async function logout(session?: SiteSession | null): Promise<void> {
  if (session) {
    storeSiteSession(session);
  }
  await logoutSiteSession();
}

export async function login(email: string, password: string): Promise<SiteSession> {
  const result = await requestJson<AuthResponsePayload>('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, device_id: getSiteAuthDeviceId() }),
    allowRefresh: false
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Не удалось выполнить вход.');
  }

  return storeSiteSession(mapAuthResponse(result.data));
}

export async function register(name: string, email: string, password: string): Promise<SiteSession> {
  const result = await requestJson<AuthResponsePayload>('/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, device_id: getSiteAuthDeviceId() }),
    allowRefresh: false
  });

  if (!result.ok || !result.data) {
    throw new Error(result.error || 'Не удалось создать аккаунт.');
  }

  return storeSiteSession(mapAuthResponse(result.data));
}

export async function requestPasswordResetLink(
  payload: SiteAuthPasswordResetRequest
): Promise<SiteAuthResult<{ message?: string; openUrl?: string }>> {
  const result = await requestJson<Record<string, unknown>>('/password-reset/request', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      openUrl: typeof result.data?.open_url === 'string' ? result.data.open_url : undefined
    }
  };
}

export async function requestPasswordReset(email: string): Promise<SiteAuthResult<{ message?: string; openUrl?: string }>> {
  return requestPasswordResetLink({ email });
}

export async function inspectPasswordResetLink(
  token: string,
  email: string
): Promise<SiteAuthResult<SitePasswordResetPreview>> {
  const result = await requestJson<Record<string, unknown>>(
    `/password-reset/inspect?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    {
      method: 'GET',
      allowRefresh: false
    }
  );

  if (!result.ok) {
    return result as SiteAuthResult<SitePasswordResetPreview>;
  }

  return {
    ok: true,
    data: {
      action: 'password_reset',
      title: typeof result.data?.title === 'string' ? result.data.title : 'Сброс пароля',
      email: typeof result.data?.email === 'string' ? result.data.email : email,
      expiresAt: result.data?.expires_at as string | number | null | undefined
    }
  };
}

export async function requestPasswordResetCode(
  payload: SiteAuthPasswordResetCodeRequest
): Promise<SiteAuthResult<{ message?: string; email?: string; expiresAt?: string | number | null }>> {
  const result = await requestJson<Record<string, unknown>>('/password-reset/code/request', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; email?: string; expiresAt?: string | number | null }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      email: typeof result.data?.email === 'string' ? result.data.email : undefined,
      expiresAt: result.data?.expires_at as string | number | null | undefined
    }
  };
}

export async function confirmPasswordReset(
  payload: SiteAuthPasswordResetConfirm
): Promise<SiteAuthResult<{ message?: string }>> {
  const result = await requestJson<Record<string, unknown>>('/password-reset/confirm', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data)
    }
  };
}

export async function confirmPasswordResetCode(
  payload: SiteAuthPasswordResetCodeConfirm
): Promise<SiteAuthResult<{ message?: string }>> {
  const result = await requestJson<Record<string, unknown>>('/password-reset/code/confirm', {
    method: 'POST',
    body: JSON.stringify(payload),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data)
    }
  };
}

async function getAuthorizedSession(): Promise<SiteAuthResult<SiteAuthSession>> {
  return ensureActiveSiteSession();
}

export async function requestProfileNameChange(
  name: string
): Promise<SiteAuthResult<{ message?: string; openUrl?: string }>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/name-change/request', {
    method: 'POST',
    body: JSON.stringify({ name }),
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      openUrl: typeof result.data?.open_url === 'string' ? result.data.open_url : undefined
    }
  };
}

export async function requestProfileEmailChange(
  email: string
): Promise<SiteAuthResult<{ message?: string; openUrl?: string }>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/email-change/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      openUrl: typeof result.data?.open_url === 'string' ? result.data.open_url : undefined
    }
  };
}

export async function requestProfilePasswordChange(): Promise<SiteAuthResult<{ message?: string; openUrl?: string }>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/password-change/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; openUrl?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      openUrl: typeof result.data?.open_url === 'string' ? result.data.open_url : undefined
    }
  };
}

export async function inspectProfileAction(token: string): Promise<SiteAuthResult<SiteProfileActionPreview>> {
  const result = await requestJson<Record<string, unknown>>(
    `/profile/action/inspect?token=${encodeURIComponent(token)}`,
    {
      method: 'GET',
      allowRefresh: false
    }
  );

  if (!result.ok) {
    return result as SiteAuthResult<SiteProfileActionPreview>;
  }

  const payload = result.data?.action as Record<string, unknown> | undefined;

  return {
    ok: true,
    data: {
      kind: String(payload?.kind || 'profile_name_change') as SiteProfileActionPreview['kind'],
      title: typeof payload?.title === 'string' ? payload.title : 'Подтверждение действия',
      email: typeof payload?.email === 'string' ? payload.email : '',
      expiresAt: payload?.expires_at as string | number | null | undefined,
      pendingName: typeof payload?.pending_name === 'string' ? payload.pending_name : undefined,
      currentEmail: typeof payload?.current_email === 'string' ? payload.current_email : undefined,
      nextEmail: typeof payload?.next_email === 'string' ? payload.next_email : undefined,
      maskedEmail: typeof payload?.masked_email === 'string' ? payload.masked_email : undefined
    }
  };
}

export async function confirmProfileAction(
  token: string,
  payload?: { password?: string }
): Promise<SiteAuthResult<{ message?: string; requiresRelogin?: boolean; user?: SiteAuthUser | null }>> {
  const result = await requestJson<Record<string, unknown>>('/profile/action/confirm', {
    method: 'POST',
    body: JSON.stringify({ token, ...(payload || {}) }),
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; requiresRelogin?: boolean; user?: SiteAuthUser | null }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      requiresRelogin: Boolean(result.data?.requires_relogin),
      user: (result.data?.user as SiteAuthUser | null | undefined) ?? undefined
    }
  };
}

function mapDeveloperApplication(value: Record<string, unknown> | null | undefined): SiteDeveloperApplication | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    status: typeof value.status === 'string' ? value.status : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
    createdAt: value.created_at as string | number | null | undefined,
    updatedAt: value.updated_at as string | number | null | undefined,
    mailedAt: value.mailed_at as string | number | null | undefined,
    reviewedAt: value.reviewed_at as string | number | null | undefined,
    reviewNote: typeof value.review_note === 'string' ? value.review_note : null
  };
}

export function resolveDeveloperApplicationState(
  application: SiteDeveloperApplication | null | undefined,
  verifiedDeveloper = false
): SiteDeveloperApplicationState {
  if (verifiedDeveloper) {
    return 'approved';
  }

  const status = String(application?.status || '').trim().toUpperCase();
  if (!status) {
    return 'none';
  }

  if (['APPROVED', 'VERIFIED', 'GRANTED', 'ACTIVE'].includes(status)) {
    return 'approved';
  }

  if (['REJECTED', 'DECLINED', 'DENIED'].includes(status)) {
    return 'rejected';
  }

  return 'pending';
}

function mapDeveloperPortalState(value: Record<string, unknown> | null | undefined): SiteDeveloperPortalState {
  const developer = value?.developer as Record<string, unknown> | undefined;
  const stats = value?.stats as Record<string, unknown> | undefined;
  const user = value?.user as Record<string, unknown> | undefined;
  return {
    verifiedDeveloper: Boolean(developer?.is_verified_developer),
    verifiedDeveloperAt: developer?.verified_developer_at as string | number | null | undefined,
    user: user ? user as unknown as SiteAuthUser : null,
    latestApplication: mapDeveloperApplication(developer?.last_application as Record<string, unknown> | null | undefined),
    developerMode: {
      enabled: Boolean((value?.developer_mode as Record<string, unknown> | undefined)?.enabled),
      source: typeof (value?.developer_mode as Record<string, unknown> | undefined)?.source === 'string'
        ? String((value?.developer_mode as Record<string, unknown>).source)
        : null
    },
    stats: {
      total: Number(stats?.total || 0),
      safe: Number(stats?.safe || 0),
      running: Number(stats?.running || 0),
      queued: Number(stats?.queued || 0),
      failed: Number(stats?.failed || 0)
    }
  };
}

function mapVerifiedApp(value: Record<string, unknown> | null | undefined): SiteVerifiedApp | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    platform: normalizeVerifiedAppPlatform(typeof value.platform === 'string' ? value.platform : 'windows'),
    appName: typeof value.app_name === 'string'
      ? value.app_name
      : (typeof value.name === 'string' ? value.name : 'Без названия'),
    authorName: typeof value.author_name === 'string' ? value.author_name : undefined,
    repositoryUrl: typeof value.repository_url === 'string' ? value.repository_url : undefined,
    releaseArtifactUrl: typeof value.release_artifact_url === 'string' ? value.release_artifact_url : undefined,
    officialSiteUrl: typeof value.official_site_url === 'string' ? value.official_site_url : undefined,
    avatarUrl: typeof value.avatar_url === 'string' ? value.avatar_url : undefined,
    sha256: typeof value.sha256 === 'string' ? value.sha256 : undefined,
    status: typeof value.status === 'string' ? value.status : undefined,
    publicSummary: typeof value.public_summary === 'string' ? value.public_summary : undefined,
    errorMessage: typeof value.error_message === 'string' ? value.error_message : undefined,
    artifactFileName: typeof value.artifact_file_name === 'string' ? value.artifact_file_name : undefined,
    artifactSizeBytes: typeof value.artifact_size_bytes === 'number'
      ? value.artifact_size_bytes
      : Number(value.artifact_size_bytes || 0) || undefined,
    riskScore: typeof value.risk_score === 'number' ? value.risk_score : Number(value.risk_score || 0) || undefined,
    verifiedAt: value.verified_at as string | number | null | undefined,
    createdAt: value.created_at as string | number | null | undefined,
    updatedAt: value.updated_at as string | number | null | undefined
  };
}

export function formatVerifiedAppPlatform(platform: string): string {
  switch (normalizeVerifiedAppPlatform(platform)) {
    case 'android':
      return 'Android';
    case 'linux':
      return 'Linux';
    case 'plugins':
      return 'Plugins';
    case 'heroku':
      return 'Heroku';
    case 'windows':
      return 'Windows';
    default:
      return String(platform || '').trim() || 'Неизвестно';
  }
}

export function normalizeVerifiedAppPlatform(platform: string): SiteVerifiedAppPlatform | string {
  const normalized = String(platform || '').trim().toLowerCase();
  switch (normalized) {
    case 'android':
    case 'apk':
      return 'android';
    case 'linux':
    case 'shell':
      return 'linux';
    case 'plugin':
    case 'plugins':
    case 'extension':
    case 'extensions':
    case 'telegram-plugin':
      return 'plugins';
    case 'heroku':
    case 'heroku-app':
    case 'heroku-addon':
      return 'heroku';
    case 'windows':
    case 'win':
      return 'windows';
    default:
      return normalized || 'windows';
  }
}

function getClientMeta(platform: string) {
  switch (String(platform || '').trim().toLowerCase()) {
    case 'android':
      return {
        key: 'android',
        name: 'NeuralV Android',
        glyph: 'A',
        accent: '#54d18d'
      };
    case 'linux':
      return {
        key: 'linux',
        name: 'NeuralV Linux',
        glyph: 'L',
        accent: '#ff9e57'
      };
    case 'windows':
    default:
      return {
        key: 'windows',
        name: 'NeuralV Windows',
        glyph: 'W',
        accent: '#6aa8ff'
      };
  }
}

function mapProfileSystem(platform: string, value: Record<string, unknown> | null | undefined): SiteProfileSystem {
  const meta = getClientMeta(platform);
  return {
    platform,
    clientKey: meta.key,
    clientName: meta.name,
    clientGlyph: meta.glyph,
    clientAccent: meta.accent,
    active: String(value?.state || '').toUpperCase() === 'ACTIVE',
    available: Boolean(
      Number(value?.last_seen_at || 0) ||
      Number(value?.last_event_at || 0) ||
      Number(value?.blocked_ads || 0) ||
      Number(value?.blocked_threats || 0)
    ),
    statusLabel: typeof value?.label === 'string' && value.label.trim() ? value.label : 'Не активна',
    blockedAds: Number(value?.blocked_ads || 0),
    blockedThreats: Number(value?.blocked_threats || 0),
    lastSeenAt: value?.last_seen_at as string | number | null | undefined,
    lastEventAt: value?.last_event_at as string | number | null | undefined
  };
}

function mapProfileScan(value: Record<string, unknown> | null | undefined): SiteProfileScan | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const platform = typeof value.platform === 'string' ? value.platform.toLowerCase() : 'windows';
  const meta = getClientMeta(platform);
  return {
    id: typeof value.id === 'string' ? value.id : `${platform}-${Math.random().toString(36).slice(2)}`,
    source: typeof value.source === 'string' ? value.source : 'unknown',
    platform,
    clientKey: meta.key,
    clientName: meta.name,
    clientGlyph: meta.glyph,
    clientAccent: meta.accent,
    mode: typeof value.mode === 'string' ? value.mode : 'unknown',
    status: typeof value.status === 'string' ? value.status : 'UNKNOWN',
    verdict: typeof value.verdict === 'string' ? value.verdict : null,
    riskScore: typeof value.risk_score === 'number' ? value.risk_score : Number(value.risk_score || 0) || null,
    threatsFound: Number(value.threats_found || 0) || 0,
    totalScanned: typeof value.total_scanned === 'number' ? value.total_scanned : Number(value.total_scanned || 0) || null,
    label: typeof value.label === 'string' && value.label.trim() ? value.label : 'Проверка',
    message: typeof value.message === 'string' && value.message.trim() ? value.message : 'Проверка завершена',
    createdAt: value.created_at as string | number | null | undefined,
    startedAt: value.started_at as string | number | null | undefined,
    completedAt: value.completed_at as string | number | null | undefined,
    updatedAt: value.updated_at as string | number | null | undefined
  };
}

function mapSupportChatMessage(value: Record<string, unknown> | null | undefined): SiteSupportChatMessage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const attachments: SiteSupportChatAttachment[] = [];
  if (Array.isArray(value.attachments)) {
    value.attachments.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const record = entry as Record<string, unknown>;
      const kind = String(record.kind || '').trim().toLowerCase();
      const fallbackKind = String(record.type || '').trim().toLowerCase();
      const resolvedKind = kind === 'photo' || kind === 'video'
        ? kind
        : fallbackKind === 'photo' || fallbackKind === 'video'
          ? fallbackKind
          : '';
      if (resolvedKind !== 'photo' && resolvedKind !== 'video') {
        return;
      }
      const url = typeof record.url === 'string'
        ? record.url
        : typeof record.media_url === 'string'
          ? record.media_url
          : typeof record.mediaUrl === 'string'
            ? record.mediaUrl
            : '';
      if (!url) {
        return;
      }
      attachments.push({
        id: typeof record.id === 'string' ? record.id : `${resolvedKind}-${Math.random().toString(36).slice(2)}`,
        kind: resolvedKind as SiteSupportChatAttachmentKind,
        url,
        thumbnailUrl: typeof record.thumbnail_url === 'string'
          ? record.thumbnail_url
          : typeof record.thumbnailUrl === 'string'
            ? record.thumbnailUrl
            : null,
        mimeType: typeof record.mime_type === 'string'
          ? record.mime_type
          : typeof record.mimeType === 'string'
            ? record.mimeType
            : null,
        fileName: typeof record.file_name === 'string'
          ? record.file_name
          : typeof record.fileName === 'string'
            ? record.fileName
            : null,
        fileSizeBytes: typeof record.file_size_bytes === 'number'
          ? record.file_size_bytes
          : Number(record.file_size_bytes || record.fileSizeBytes || record.size_bytes || 0) || null,
        width: typeof record.width === 'number' ? record.width : Number(record.width || 0) || null,
        height: typeof record.height === 'number' ? record.height : Number(record.height || 0) || null,
        durationSeconds: typeof record.duration_seconds === 'number'
          ? record.duration_seconds
          : Number(record.duration_seconds || record.durationSeconds || 0) || null
      });
    });
  }
  return {
    id: typeof value.id === 'string' ? value.id : `msg-${Math.random().toString(36).slice(2)}`,
    senderRole:
      String(value.sender_role || '').trim().toLowerCase() === 'support'
        ? 'support'
        : String(value.sender_role || '').trim().toLowerCase() === 'system'
          ? 'system'
          : 'client',
    senderName: typeof value.sender_name === 'string' ? value.sender_name : null,
    text: typeof value.message_text === 'string' ? value.message_text : '',
    messageKind: typeof value.message_kind === 'string'
      ? (String(value.message_kind).toUpperCase() as 'TEXT' | 'PHOTO' | 'VIDEO')
      : undefined,
    deliveryStatus: typeof value.delivery_status === 'string'
      ? (String(value.delivery_status).toUpperCase() as 'QUEUED' | 'SENT' | 'FAILED')
      : undefined,
    deliveryError: typeof value.delivery_error === 'string' ? value.delivery_error : null,
    source: typeof value.source === 'string' ? value.source : null,
    createdAt: value.created_at as string | number | null | undefined,
    updatedAt: value.updated_at as string | number | null | undefined,
    attachments
  };
}

function withSupportChatAccessToken(url: string, token: string) {
  if (!url) {
    return url;
  }
  try {
    const resolved = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://sosiskibot.ru');
    resolved.searchParams.set('access_token', token);
    if (resolved.origin === (typeof window !== 'undefined' ? window.location.origin : resolved.origin)) {
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }
    return resolved.toString();
  } catch {
    return url;
  }
}

function mapSupportChatStatePayload(result: Record<string, unknown> | undefined, accessToken: string): SiteSupportChatState {
  return {
    availability: Boolean(result?.availability),
    message: typeof result?.message === 'string' ? result.message : undefined,
    pollAfterMs: typeof result?.poll_after_ms === 'number' ? result.poll_after_ms : Number(result?.poll_after_ms || 0) || undefined,
    chat: result?.chat && typeof result.chat === 'object'
      ? {
          id: typeof (result.chat as Record<string, unknown>).id === 'string' ? String((result.chat as Record<string, unknown>).id) : '',
          ticketNumber: Number((result.chat as Record<string, unknown>).ticket_number || 0) || 0,
          status: typeof (result.chat as Record<string, unknown>).status === 'string'
            ? String((result.chat as Record<string, unknown>).status)
            : 'OPEN',
          lastMessageFrom: ((result.chat as Record<string, unknown>).last_message_from as 'client' | 'support' | 'system' | null | undefined) ?? null,
          lastMessageAt: (result.chat as Record<string, unknown>).last_message_at as string | number | null | undefined,
          createdAt: (result.chat as Record<string, unknown>).created_at as string | number | null | undefined,
          updatedAt: (result.chat as Record<string, unknown>).updated_at as string | number | null | undefined
        }
      : null,
    messages: Array.isArray(result?.messages)
      ? result.messages
          .map((entry) => mapSupportChatMessage(entry as Record<string, unknown>))
          .filter((entry): entry is SiteSupportChatMessage => Boolean(entry))
          .map((message) => ({
            ...message,
            attachments: (message.attachments || []).map((attachment) => ({
              ...attachment,
              url: withSupportChatAccessToken(attachment.url, accessToken),
              thumbnailUrl: attachment.thumbnailUrl ? withSupportChatAccessToken(attachment.thumbnailUrl, accessToken) : attachment.thumbnailUrl
            }))
          }))
      : []
  };
}

export async function fetchDeveloperPortalState(): Promise<SiteAuthResult<SiteDeveloperPortalState>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<SiteDeveloperPortalState>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/developer/status', {
    method: 'GET',
    baseUrl: VERIFIED_APPS_BASE_URL,
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteDeveloperPortalState>;
  }

  return {
    ok: true,
    data: mapDeveloperPortalState((result.data?.status as Record<string, unknown> | undefined) || result.data)
  };
}

export async function submitDeveloperApplication(
  message: string
): Promise<SiteAuthResult<{ message?: string; queued?: boolean; alreadyPending?: boolean }>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<{ message?: string; queued?: boolean; alreadyPending?: boolean }>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/developer/apply', {
    method: 'POST',
    baseUrl: VERIFIED_APPS_BASE_URL,
    body: JSON.stringify({ message }),
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string; queued?: boolean; alreadyPending?: boolean }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data),
      queued: true,
      alreadyPending: false
    }
  };
}

export async function submitVerifiedAppReview(
  payload: SiteVerifiedAppReviewRequest
): Promise<SiteAuthResult<{ message?: string }>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<{ message?: string }>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/developer/apps/verify', {
    method: 'POST',
    baseUrl: VERIFIED_APPS_BASE_URL,
    body: JSON.stringify({
      app_name: payload.appName,
      platform: payload.platform,
      repository_url: payload.repositoryUrl,
      release_artifact_url: payload.releaseArtifactUrl,
      official_site_url: payload.officialSiteUrl
    }),
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<{ message?: string }>;
  }

  return {
    ok: true,
    data: {
      message: readMessage(result.data)
    }
  };
}

export async function fetchOwnVerifiedApps(): Promise<SiteAuthResult<SiteVerifiedApp[]>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<SiteVerifiedApp[]>;
  }

  const result = await requestJson<{ apps?: Record<string, unknown>[] }>('/profile/developer/apps', {
    method: 'GET',
    baseUrl: VERIFIED_APPS_BASE_URL,
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteVerifiedApp[]>;
  }

  const items = Array.isArray(result.data?.apps)
    ? result.data.apps.map((entry) => mapVerifiedApp(entry)).filter((entry): entry is SiteVerifiedApp => Boolean(entry))
    : [];

  return { ok: true, data: items };
}

export async function fetchPublicVerifiedApps(
  options: { platform?: string; limit?: number } = {}
): Promise<SiteAuthResult<SiteVerifiedApp[]>> {
  const query = new URLSearchParams();
  if (options.platform) {
    query.set('platform', String(normalizeVerifiedAppPlatform(options.platform)));
  }
  if (options.limit) {
    query.set('limit', String(options.limit));
  }
  const path = `/verified-apps${query.toString() ? `?${query.toString()}` : ''}`;
  const result = await requestJson<{ apps?: Record<string, unknown>[] }>(path, {
    method: 'GET',
    baseUrl: VERIFIED_APPS_BASE_URL,
    allowRefresh: false
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteVerifiedApp[]>;
  }

  const items = Array.isArray(result.data?.apps)
    ? result.data.apps.map((entry) => mapVerifiedApp(entry)).filter((entry): entry is SiteVerifiedApp => Boolean(entry))
    : [];

  return { ok: true, data: items };
}

export async function fetchProfileOverview(
  options: { limit?: number; offset?: number } = {}
): Promise<SiteAuthResult<SiteProfileOverview>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<SiteProfileOverview>;
  }

  const query = new URLSearchParams();
  if (options.limit) {
    query.set('limit', String(options.limit));
  }
  if (options.offset) {
    query.set('offset', String(options.offset));
  }

  const result = await requestJson<{ overview?: Record<string, unknown> }>(
    `/profile/overview${query.toString() ? `?${query.toString()}` : ''}`,
    {
      method: 'GET',
      baseUrl: VERIFIED_APPS_BASE_URL,
      headers: { Authorization: `Bearer ${sessionResult.data.token}` }
    }
  );

  if (!result.ok) {
    return result as SiteAuthResult<SiteProfileOverview>;
  }

  const overview = (result.data?.overview as Record<string, unknown> | undefined) || {};
  const systemsObject = (overview.protection as Record<string, unknown> | undefined)?.platforms as Record<string, unknown> | undefined;
  const systems = ['android', 'windows', 'linux'].map((platform) => mapProfileSystem(platform, systemsObject?.[platform] as Record<string, unknown> | undefined));
  const scans = Array.isArray(overview.scans)
    ? overview.scans.map((entry) => mapProfileScan(entry as Record<string, unknown>)).filter((entry): entry is SiteProfileScan => Boolean(entry))
    : [];

  return {
    ok: true,
    data: {
      systems,
      scans,
      totalScans: Number(overview.total_scans || 0) || scans.length,
      scanSources: {
        legacy: Number((overview.scan_sources as Record<string, unknown> | undefined)?.legacy || 0) || 0,
        deep: Number((overview.scan_sources as Record<string, unknown> | undefined)?.deep || 0) || 0,
        desktop: Number((overview.scan_sources as Record<string, unknown> | undefined)?.desktop || 0) || 0
      }
    }
  };
}

export async function fetchSupportChatState(
  options: { after?: number; limit?: number; sync?: 'poll' | 'none' } = {}
): Promise<SiteAuthResult<SiteSupportChatState>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<SiteSupportChatState>;
  }

  const query = new URLSearchParams();
  if (options.after) {
    query.set('after', String(options.after));
  }
  if (options.limit) {
    query.set('limit', String(options.limit));
  }
  if (options.sync && options.sync !== 'none') {
    query.set('sync', options.sync);
  }

  const result = await requestJson<Record<string, unknown>>(
    `/profile/support-chat${query.toString() ? `?${query.toString()}` : ''}`,
    {
      method: 'GET',
      baseUrl: VERIFIED_APPS_BASE_URL,
      headers: { Authorization: `Bearer ${sessionResult.data.token}` }
    }
  );

  if (!result.ok) {
    return result as SiteAuthResult<SiteSupportChatState>;
  }

  return {
    ok: true,
    data: mapSupportChatStatePayload(result.data, sessionResult.data.token)
  };
}

export async function openSupportChat(): Promise<SiteAuthResult<SiteSupportChatState>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<SiteSupportChatState>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/support-chat/open', {
    method: 'POST',
    baseUrl: VERIFIED_APPS_BASE_URL,
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteSupportChatState>;
  }

  return {
    ok: true,
    data: mapSupportChatStatePayload(result.data, sessionResult.data.token)
  };
}

export async function sendSupportChatMessage(
  payload: SiteSupportChatSendPayload,
  chatId?: string | null
): Promise<SiteAuthResult<SiteSupportChatState>> {
  const sessionResult = await getAuthorizedSession();
  if (!sessionResult.ok || !sessionResult.data) {
    return sessionResult as unknown as SiteAuthResult<SiteSupportChatState>;
  }

  const result = await requestJson<Record<string, unknown>>('/profile/support-chat/messages', {
    method: 'POST',
    baseUrl: VERIFIED_APPS_BASE_URL,
    body: JSON.stringify({
      text: payload.text,
      attachment: payload.attachment
        ? {
            type: payload.attachment.kind,
            file_name: payload.attachment.fileName,
            mime_type: payload.attachment.mimeType,
            file_size_bytes: payload.attachment.fileSizeBytes,
            width: payload.attachment.width ?? undefined,
            height: payload.attachment.height ?? undefined,
            duration_seconds: payload.attachment.durationSeconds ?? undefined,
            content_base64: payload.attachment.dataUrl.replace(/^data:[^,]*,/, '')
          }
        : undefined,
      chat_id: chatId || undefined
    }),
    headers: { Authorization: `Bearer ${sessionResult.data.token}` }
  });

  if (!result.ok) {
    return result as SiteAuthResult<SiteSupportChatState>;
  }

  return {
    ok: true,
    data: mapSupportChatStatePayload(result.data, sessionResult.data.token)
  };
}

export function formatSessionExpiry(value: string | number | null | undefined): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    return 'не указано';
  }
  return new Date(timestamp).toLocaleString('ru-RU');
}
