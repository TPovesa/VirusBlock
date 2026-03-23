const SITE_AUTH_STORAGE_KEY = 'neuralv-site-auth-session';
const SITE_AUTH_DEVICE_KEY = 'neuralv-site-auth-device-id';
const SITE_AUTH_EVENT = 'neuralv-site-auth-changed';
const ACCESS_REFRESH_SKEW_MS = 60_000;

const AUTH_BASE_URL = String(import.meta.env.VITE_SITE_AUTH_BASE_URL || '/basedata/api/auth').replace(/\/+$/, '');

export type SiteAuthUser = {
  id: string;
  name: string;
  email: string;
  is_premium?: boolean;
  premium_expires_at?: string | number | null;
  is_developer_mode?: boolean;
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
    'Account deleted': 'Аккаунт удалён.'
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
  try {
    const response = await fetch(`${AUTH_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });

    const parsed = await parseResponse<T>(response);

    if (
      parsed.status === 401 &&
      options.allowRefresh !== false &&
      !path.endsWith('/refresh') &&
      !path.endsWith('/login') &&
      !path.endsWith('/login/start') &&
      !path.endsWith('/login/verify')
    ) {
      const refreshed = await refreshStoredSiteSession();
      if (refreshed.ok && refreshed.data) {
        const retryHeaders = new Headers(options.headers || {});
        retryHeaders.set('Authorization', `Bearer ${refreshed.data.token}`);
        const retryResponse = await fetch(`${AUTH_BASE_URL}${path}`, {
          ...options,
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
    return result as SiteAuthResult<SiteAuthSession>;
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
    return result as SiteAuthResult<SiteAuthSession>;
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
    return result as SiteAuthResult<SiteAuthSession>;
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
    return result as SiteAuthResult<SiteAuthSession>;
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

export function formatSessionExpiry(value: string | number | null | undefined): string {
  const timestamp = parseTimestamp(value);
  if (!timestamp) {
    return 'не указано';
  }
  return new Date(timestamp).toLocaleString('ru-RU');
}
