import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { PasswordStrength } from '../components/PasswordStrength';
import { useSiteAuth } from '../components/SiteAuthProvider';
import {
  VERIFIED_APP_GROUPS,
  VERIFIED_APP_PLATFORM_OPTIONS,
  fetchDeveloperPortalState,
  fetchOwnVerifiedApps,
  fetchProfileOverview,
  formatVerifiedAppPlatform,
  humanizeError,
  normalizeVerifiedAppPlatform,
  requestProfileEmailChange,
  requestProfileNameChange,
  requestProfilePasswordChange,
  resolveDeveloperApplicationState,
  submitDeveloperApplication,
  submitVerifiedAppReview,
  type SiteDeveloperApplication,
  type SiteDeveloperPortalState,
  type SiteProfileOverview,
  type SiteProfileScan,
  type SiteProfileSystem,
  type SiteVerifiedApp,
  type SiteVerifiedAppFilter,
  type SiteVerifiedAppPlatform,
} from '../lib/siteAuth';
import '../styles/auth.css';

type ProfileTab = 'profile' | 'developer' | 'security';
type AccountPending = 'name' | 'email' | 'password' | 'logout' | null;
type DeveloperPending = 'load' | 'apply' | 'verify' | null;
type PlatformOption = '' | SiteVerifiedAppPlatform;
type DraftStatus = 'idle' | 'saved';

type ReviewFormState = {
  repositoryUrl: string;
  appName: string;
  officialSiteUrl: string;
  description: string;
  platform: PlatformOption;
  releaseTag: string;
  releaseAssetName: string;
};

type SecurityWorkspaceProps = {
  name: string;
  setName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  demoPassword: string;
  setDemoPassword: (value: string) => void;
  focused: boolean;
  setFocused: (value: boolean) => void;
  pending: AccountPending;
  onNameChange: (event: FormEvent) => Promise<void>;
  onEmailChange: (event: FormEvent) => Promise<void>;
  onPasswordChange: (event: FormEvent) => Promise<void>;
};

type VerifiedDeveloperWorkspaceProps = {
  apps: SiteVerifiedApp[];
  pending: DeveloperPending;
  reviewForm: ReviewFormState;
  reviewDraftStatus: DraftStatus;
  setReviewForm: Dispatch<SetStateAction<ReviewFormState>>;
  onVerify: (event: FormEvent) => Promise<void>;
};

type DeveloperApplicationCardProps = {
  projectName: string;
  setProjectName: (value: string) => void;
  message: string;
  setMessage: (value: string) => void;
  draftStatus: DraftStatus;
  pending: DeveloperPending;
  onApply: (event: FormEvent) => Promise<void>;
};

const navGroupLabelStyle = {
  padding: '2px 4px 0',
  color: 'var(--nv-text-soft)',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const
};

function getVerifiedAppsTitle(platform: SiteVerifiedAppFilter) {
  return platform === 'all' ? 'Все проверенные' : formatVerifiedAppPlatform(platform);
}

function formatDate(value: string | number | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

const DEVELOPER_APPLICATION_DRAFT_KEY = 'neuralv-profile-developer-application-draft';
const VERIFIED_REVIEW_DRAFT_KEY = 'neuralv-profile-verified-review-draft';

function loadDraft<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return fallback;
  }
}

function saveDraft<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore local draft failures
  }
}

function clearDraft(key: string) {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore local draft failures
  }
}

function formatScanMode(mode: string) {
  switch (String(mode || '').trim().toLowerCase()) {
    case 'quick':
      return 'Быстрая';
    case 'full':
      return 'Глубокая';
    case 'selective':
      return 'Выборочная';
    case 'apk':
      return 'APK';
    case 'filesystem':
      return 'Файлы';
    default:
      return 'Проверка';
  }
}

function formatScanVerdict(scan: SiteProfileScan) {
  const verdict = String(scan.verdict || '').trim().toUpperCase();
  const status = String(scan.status || '').trim().toUpperCase();
  if (status === 'RUNNING') {
    return 'Идёт';
  }
  if (status === 'QUEUED' || status === 'AWAITING_UPLOAD') {
    return 'Ожидает';
  }
  if (status === 'FAILED') {
    return 'Ошибка';
  }
  if (verdict === 'CLEAN' || verdict === 'SAFE') {
    return 'Чисто';
  }
  if (verdict === 'MALICIOUS') {
    return 'Опасно';
  }
  if (verdict === 'SUSPICIOUS') {
    return 'Подозрительно';
  }
  if (scan.threatsFound > 0) {
    return 'Угрозы';
  }
  return 'Готово';
}

function verdictClass(scan: SiteProfileScan) {
  const label = formatScanVerdict(scan);
  if (label === 'Чисто') {
    return 'is-safe';
  }
  if (label === 'Опасно' || label === 'Угрозы' || label === 'Ошибка') {
    return 'is-danger';
  }
  if (label === 'Подозрительно' || label === 'Ожидает' || label === 'Идёт') {
    return 'is-warn';
  }
  return '';
}

function ClientAvatar({
  glyph,
  accent,
  label
}: {
  glyph: string;
  accent: string;
  label: string;
}) {
  const style = { ['--client-accent' as '--client-accent']: accent } as CSSProperties;
  return (
    <span className="profile-client-avatar" style={style} aria-label={label}>
      {glyph}
    </span>
  );
}

function ProfileSystemCard({ system }: { system: SiteProfileSystem }) {
  const lastSeen = formatDate(system.lastSeenAt || system.lastEventAt);

  return (
    <article className={`content-card profile-system-card${system.active ? ' is-active' : ''}`}>
      <div className="profile-system-head">
        <div className="profile-system-ident">
          <ClientAvatar glyph={system.clientGlyph} accent={system.clientAccent} label={system.clientName} />
          <div className="profile-system-copy">
            <strong>{system.clientName}</strong>
          </div>
        </div>
        <span className={`profile-status-pill${system.active ? ' is-active' : ''}`}>{system.statusLabel}</span>
      </div>
      <div className="profile-system-stats">
        <div>
          <span>Угрозы</span>
          <strong>{system.blockedThreats}</strong>
        </div>
        <div>
          <span>Реклама</span>
          <strong>{system.blockedAds}</strong>
        </div>
      </div>
      {lastSeen ? <div className="profile-system-footnote">Последняя активность: {lastSeen}</div> : null}
    </article>
  );
}

function ProfileScanCard({ scan }: { scan: SiteProfileScan }) {
  const finishedAt = formatDate(scan.completedAt || scan.updatedAt || scan.createdAt);

  return (
    <article className="content-card profile-history-card">
      <div className="profile-history-head">
        <div className="profile-history-ident">
          <ClientAvatar glyph={scan.clientGlyph} accent={scan.clientAccent} label={scan.clientName} />
          <div className="profile-history-copy">
            <strong>{scan.label}</strong>
            <span>{scan.clientName}</span>
          </div>
        </div>
        <span className={`profile-status-pill ${verdictClass(scan)}`.trim()}>{formatScanVerdict(scan)}</span>
      </div>
      <div className="profile-history-body">
        <p>{scan.message}</p>
      </div>
      <div className="profile-history-meta">
        <span>{formatScanMode(scan.mode)}</span>
        {finishedAt ? <span>{finishedAt}</span> : null}
      </div>
    </article>
  );
}

function ProfileVerifiedAppCard({ app }: { app: SiteVerifiedApp }) {
  const initial = (app.appName || '?').slice(0, 1).toUpperCase();
  const verifiedAt = formatDate(app.verifiedAt || app.createdAt);
  const safe = String(app.status || '').toUpperCase() === 'SAFE';
  const platformLabel = formatVerifiedAppPlatform(String(app.platform || ''));
  const authorLabel = app.authorName || 'Ваш профиль';

  return (
    <article className="content-card developer-app-card">
      <div className="developer-app-card-head">
        <div className="developer-app-avatar" aria-hidden="true">
          {app.avatarUrl ? <img src={app.avatarUrl} alt="" loading="lazy" /> : <span>{initial}</span>}
        </div>
        <div className="developer-app-meta">
          <div className="developer-app-title-row">
            <strong>{app.appName}</strong>
            <span className={`profile-status-pill${safe ? ' is-active' : ''}`}>
              {safe ? 'Безопасно' : (app.status || 'В проверке')}
            </span>
          </div>
        </div>
      </div>
      {app.publicSummary ? <p className="developer-app-summary">{app.publicSummary}</p> : null}
      <div className="developer-app-row">
        <span>Раздел</span>
        <strong>{platformLabel}</strong>
      </div>
      <div className="developer-app-row">
        <span>Автор</span>
        <strong>{authorLabel}</strong>
      </div>
      <div className="developer-app-links">
        {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
        {app.releaseArtifactUrl ? <a className="shell-chip" href={app.releaseArtifactUrl} target="_blank" rel="noreferrer">Релиз</a> : null}
        {app.officialSiteUrl ? <a className="shell-chip" href={app.officialSiteUrl} target="_blank" rel="noreferrer">Сайт</a> : null}
      </div>
      {verifiedAt ? <div className="developer-app-footnote">Проверено: {verifiedAt}</div> : null}
      {app.errorMessage ? <div className="developer-app-footnote is-error">{app.errorMessage}</div> : null}
    </article>
  );
}

function SecurityWorkspace({
  name,
  setName,
  email,
  setEmail,
  demoPassword,
  setDemoPassword,
  focused,
  setFocused,
  pending,
  onNameChange,
  onEmailChange,
  onPasswordChange
}: SecurityWorkspaceProps) {
  return (
    <div className="profile-panel-stack">
      <div className="profile-security-grid">
        <section className="content-card profile-panel-card profile-form-card">
          <div className="profile-panel-head">
            <h2>Имя</h2>
          </div>
          <form className="auth-form" onSubmit={onNameChange}>
            <label className="auth-field">
              <span className="auth-field-label">Новое имя</span>
              <input className="auth-input" type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
          </form>
        </section>

        <section className="content-card profile-panel-card profile-form-card">
          <div className="profile-panel-head">
            <h2>Почта</h2>
          </div>
          <form className="auth-form" onSubmit={onEmailChange}>
            <label className="auth-field">
              <span className="auth-field-label">Новая почта</span>
              <input className="auth-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
          </form>
        </section>
      </div>

      <section className="content-card profile-panel-card profile-form-card">
        <div className="profile-panel-head">
          <h2>Пароль</h2>
        </div>
        <form className="auth-form" onSubmit={onPasswordChange}>
          <label className="auth-field">
            <span className="auth-field-label">Новый пароль</span>
            <input
              className="auth-input"
              type="password"
              value={demoPassword}
              onChange={(event) => setDemoPassword(event.target.value)}
              onFocus={() => setFocused(true)}
              placeholder="Введите новый пароль"
            />
          </label>
          <PasswordStrength password={demoPassword} visible={focused || demoPassword.length > 0} />
          <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
        </form>
      </section>
    </div>
  );
}

function DeveloperApplicationCard({
  projectName,
  setProjectName,
  message,
  setMessage,
  draftStatus,
  pending,
  onApply
}: DeveloperApplicationCardProps) {
  return (
    <section className="content-card profile-panel-card profile-form-card">
      <form className="auth-form" onSubmit={onApply}>
        <label className="auth-field">
          <span className="auth-field-label">Проект</span>
          <input
            className="auth-input"
            type="text"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Название проекта"
          />
        </label>
        <label className="auth-field">
          <span className="auth-field-label">Заявка</span>
          <textarea
            className="auth-input auth-textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Коротко опишите проект"
            rows={5}
          />
        </label>
        <div className="profile-draft-note" aria-live="polite">
          {draftStatus === 'saved' ? 'Черновик сохранён.' : 'Черновик сохраняется автоматически.'}
        </div>
        <button className="nv-button" type="submit" disabled={pending !== null}>
          {pending === 'apply' ? 'Отправляем...' : 'Подать заявку'}
        </button>
      </form>
    </section>
  );
}

function VerifiedDeveloperWorkspace({
  apps,
  pending,
  reviewForm,
  reviewDraftStatus,
  setReviewForm,
  onVerify
}: VerifiedDeveloperWorkspaceProps) {
  const [activePlatform, setActivePlatform] = useState<SiteVerifiedAppFilter>('all');
  const filteredApps = useMemo(
    () => (
      activePlatform === 'all'
        ? apps
        : apps.filter((app) => normalizeVerifiedAppPlatform(String(app.platform || '')) === activePlatform)
    ),
    [activePlatform, apps]
  );
  const catalogTitle = useMemo(() => getVerifiedAppsTitle(activePlatform), [activePlatform]);

  return (
    <div className="profile-panel-stack">
      <section className="content-card profile-panel-card profile-form-card profile-verify-card">
        <div className="profile-verify-layout">
          <form className="auth-form" onSubmit={onVerify}>
            <label className="auth-field">
              <span className="auth-field-label">Репозиторий</span>
              <input
                className="auth-input"
                type="url"
                value={reviewForm.repositoryUrl}
                onChange={(event) => setReviewForm((current) => ({ ...current, repositoryUrl: event.target.value }))}
                placeholder="https://github.com/owner/repo"
              />
            </label>

            <label className="auth-field">
              <span className="auth-field-label">Название</span>
              <input
                className="auth-input"
                type="text"
                value={reviewForm.appName}
                onChange={(event) => setReviewForm((current) => ({ ...current, appName: event.target.value }))}
                placeholder="Можно оставить пустым"
              />
            </label>

            <label className="auth-field">
              <span className="auth-field-label">Сайт</span>
              <input
                className="auth-input"
                type="url"
                value={reviewForm.officialSiteUrl}
                onChange={(event) => setReviewForm((current) => ({ ...current, officialSiteUrl: event.target.value }))}
                placeholder="https://example.com"
              />
            </label>

            <label className="auth-field">
              <span className="auth-field-label">Описание</span>
              <textarea
                className="auth-input auth-textarea"
                value={reviewForm.description}
                onChange={(event) => setReviewForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Необязательно"
                rows={4}
              />
            </label>

            <details className="profile-advanced-details">
              <summary className="profile-advanced-summary">Расширенные настройки</summary>
              <div className="profile-panel-stack">
                <label className="auth-field">
                  <span className="auth-field-label">Платформа</span>
                  <select
                    className="auth-input"
                    value={reviewForm.platform}
                    onChange={(event) => setReviewForm((current) => ({ ...current, platform: event.target.value as PlatformOption }))}
                  >
                    <option value="">Определить автоматически</option>
                    {VERIFIED_APP_PLATFORM_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>

                <label className="auth-field">
                  <span className="auth-field-label">Версия или тег</span>
                  <input
                    className="auth-input"
                    type="text"
                    value={reviewForm.releaseTag}
                    onChange={(event) => setReviewForm((current) => ({ ...current, releaseTag: event.target.value }))}
                    placeholder="Например, v1.5.0"
                  />
                </label>

                <label className="auth-field">
                  <span className="auth-field-label">Имя файла релиза</span>
                  <input
                    className="auth-input"
                    type="text"
                    value={reviewForm.releaseAssetName}
                    onChange={(event) => setReviewForm((current) => ({ ...current, releaseAssetName: event.target.value }))}
                    placeholder="Например, app-release.apk"
                  />
                </label>
              </div>
            </details>

            <div className="profile-draft-note" aria-live="polite">
              {reviewDraftStatus === 'saved' ? 'Черновик сохранён.' : 'Черновик сохраняется автоматически.'}
            </div>
            <button className="nv-button" type="submit" disabled={pending !== null}>
              {pending === 'verify' ? 'Отправляем...' : 'Запустить проверку'}
            </button>
          </form>
        <aside className="profile-verify-requirements" aria-label="Требования к проверке">
          <strong>Требования к проверке</strong>
          <ul className="profile-verify-requirements-list">
            <li>Нужен публичный GitHub-репозиторий с доступными исходниками.</li>
            <li>Нужен хотя бы один GitHub Release с файлом сборки.</li>
            <li>Закрытые репозитории и приватные релизы не подходят.</li>
            <li>Платформу и релиз можно оставить на автоопределение.</li>
          </ul>
        </aside>
        </div>
      </section>

      <section className="profile-dashboard-grid verified-apps-layout">
        <aside className="content-card profile-nav-card verified-apps-nav-card">
          <div className="profile-nav-head">
            <strong>Мои проверенные</strong>
          </div>
          <div className="profile-nav-list" role="tablist" aria-label="Категории моих проверенных приложений">
            {VERIFIED_APP_GROUPS.map((group, index) => (
              <div key={group.id} className="profile-panel-stack">
                {index > 0 ? <div className="profile-nav-divider" /> : null}
                <div style={navGroupLabelStyle}>{group.label}</div>
                <div className="profile-panel-stack">
                  {group.items.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`profile-nav-button${activePlatform === item.value ? ' is-active' : ''}`}
                      onClick={() => setActivePlatform(item.value)}
                    >
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="profile-dashboard-main">
          <article className="content-card profile-panel-card profile-panel-card-featured verified-apps-header-card">
            <div className="profile-panel-head">
              <h1>{catalogTitle}</h1>
            </div>
            <div className="profile-inline-note">Найдено: {filteredApps.length}</div>
          </article>

          {filteredApps.length > 0 ? (
            <div className="developer-app-grid">
              {filteredApps.map((app) => (
                <ProfileVerifiedAppCard key={app.id || `${app.appName}-${normalizeVerifiedAppPlatform(String(app.platform || ''))}`} app={app} />
              ))}
            </div>
          ) : (
            <section className="content-card profile-panel-card">
              <div className="profile-empty-copy">Для раздела {catalogTitle} пока нет отправленных приложений.</div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function RejectedDeveloperCard({
  application,
  onRetry
}: {
  application: SiteDeveloperApplication | null | undefined;
  onRetry: () => void;
}) {
  return (
    <section className="content-card profile-panel-card profile-panel-card-rejected profile-panel-card-centered">
      <strong className="profile-state-title">Заявка отклонена</strong>
      {application?.reviewNote ? <div className="profile-inline-note profile-inline-note-danger">{application.reviewNote}</div> : null}
      <button className="nv-button" type="button" onClick={onRetry}>Подать повторную заявку</button>
    </section>
  );
}

function ProfileOverviewPanel({
  overview,
  loading,
  name,
  email
}: {
  overview: SiteProfileOverview | null;
  loading: boolean;
  name: string;
  email: string;
}) {
  if (loading) {
    return (
      <div className="profile-panel-stack">
        <section className="content-card profile-panel-card">
          <div className="profile-empty-copy">Загружаем профиль...</div>
        </section>
      </div>
    );
  }

  return (
    <div className="profile-panel-stack">
      <section className="content-card profile-panel-card profile-panel-card-featured profile-account-card">
        <div className="profile-account-copy">
          <strong>{name}</strong>
          <span>{email}</span>
        </div>
      </section>

      <section className="content-card profile-panel-card">
        <div className="profile-panel-head">
          <h2>Системы</h2>
        </div>
        <div className="profile-system-grid">
          {(overview?.systems || []).map((system) => (
            <ProfileSystemCard key={system.platform} system={system} />
          ))}
        </div>
      </section>

      <section className="content-card profile-panel-card">
        <div className="profile-panel-head">
          <h2>Проверки</h2>
        </div>
        {(overview?.scans || []).length ? (
          <div className="profile-history-list">
            {overview?.scans.map((scan) => (
              <ProfileScanCard key={scan.id} scan={scan} />
            ))}
          </div>
        ) : (
          <div className="profile-empty-copy">Пока пусто.</div>
        )}
      </section>
    </div>
  );
}

export function ProfilePage() {
  const { user, logout } = useSiteAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [focused, setFocused] = useState(false);
  const [demoPassword, setDemoPassword] = useState('');
  const [pending, setPending] = useState<AccountPending>(null);
  const [developerPending, setDeveloperPending] = useState<DeveloperPending>('load');
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [portal, setPortal] = useState<SiteDeveloperPortalState | null>(null);
  const [overview, setOverview] = useState<SiteProfileOverview | null>(null);
  const [verifiedApps, setVerifiedApps] = useState<SiteVerifiedApp[]>([]);
  const [applyProject, setApplyProject] = useState(() => loadDraft(DEVELOPER_APPLICATION_DRAFT_KEY, { project: '' }).project);
  const [applyMessage, setApplyMessage] = useState(() => loadDraft(DEVELOPER_APPLICATION_DRAFT_KEY, { message: '' }).message);
  const [applicationDraftStatus, setApplicationDraftStatus] = useState<DraftStatus>('idle');
  const [showRetryForm, setShowRetryForm] = useState(false);
  const [reviewForm, setReviewForm] = useState<ReviewFormState>(() => loadDraft(VERIFIED_REVIEW_DRAFT_KEY, {
    repositoryUrl: '',
    appName: '',
    officialSiteUrl: '',
    description: '',
    platform: '' as PlatformOption,
    releaseTag: '',
    releaseAssetName: ''
  }));
  const [reviewDraftStatus, setReviewDraftStatus] = useState<DraftStatus>('idle');

  useEffect(() => {
    setName(user?.name || '');
    setEmail(user?.email || '');
  }, [user?.email, user?.name]);

  useEffect(() => {
    setReviewForm((current) => {
      if (!current.platform) {
        return current;
      }
      const normalizedPlatform = normalizeVerifiedAppPlatform(String(current.platform || ''));
      if (normalizedPlatform === current.platform) {
        return current;
      }
      return {
        ...current,
        platform: (normalizedPlatform === 'android' || normalizedPlatform === 'windows' || normalizedPlatform === 'linux' || normalizedPlatform === 'plugins' || normalizedPlatform === 'heroku'
          ? normalizedPlatform
          : '') as PlatformOption
      };
    });
  }, []);

  useEffect(() => {
    saveDraft(DEVELOPER_APPLICATION_DRAFT_KEY, {
      project: applyProject,
      message: applyMessage
    });
    setApplicationDraftStatus('saved');
  }, [applyMessage, applyProject]);

  useEffect(() => {
    saveDraft(VERIFIED_REVIEW_DRAFT_KEY, reviewForm);
    setReviewDraftStatus('saved');
  }, [reviewForm]);

  async function loadOverview() {
    setOverviewLoading(true);
    const result = await fetchProfileOverview({ limit: 80 });
    if (result.ok && result.data) {
      setOverview(result.data);
    } else {
      setError(result.error || 'Не удалось загрузить профиль.');
    }
    setOverviewLoading(false);
  }

  async function loadDeveloperData() {
    setDeveloperPending('load');
    try {
      const [portalResult, appsResult] = await Promise.all([
        fetchDeveloperPortalState(),
        fetchOwnVerifiedApps()
      ]);

      if (!portalResult.ok) {
        throw new Error(portalResult.error || 'Не удалось загрузить раздел разработчика.');
      }
      setPortal(portalResult.data || null);
      setVerifiedApps(appsResult.ok && appsResult.data ? appsResult.data : []);
    } catch (loadError) {
      setError(humanizeError(loadError, 'Не удалось загрузить раздел разработчика.'));
    } finally {
      setDeveloperPending(null);
    }
  }

  useEffect(() => {
    void Promise.all([loadOverview(), loadDeveloperData()]);
  }, []);

  async function handleNameChange(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending('name');
    setMessage('');
    setError('');
    const result = await requestProfileNameChange(name.trim());
    setPending(null);
    if (!result.ok) {
      setError(result.error || 'Не удалось отправить письмо для смены имени.');
      return;
    }
    setMessage(result.data?.message || 'Письмо отправлено.');
  }

  async function handleEmailChange(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending('email');
    setMessage('');
    setError('');
    const result = await requestProfileEmailChange(email.trim());
    setPending(null);
    if (!result.ok) {
      setError(result.error || 'Не удалось отправить письмо для смены почты.');
      return;
    }
    setMessage(result.data?.message || 'Письмо отправлено.');
  }

  async function handlePasswordChange(event: FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending('password');
    setMessage('');
    setError('');
    const result = await requestProfilePasswordChange();
    setPending(null);
    if (!result.ok) {
      setError(result.error || 'Не удалось отправить письмо для смены пароля.');
      return;
    }
    setMessage(result.data?.message || 'Письмо отправлено.');
  }

  async function handleLogout() {
    setPending('logout');
    setMessage('');
    setError('');
    try {
      await logout();
    } catch (logoutError) {
      setError(humanizeError(logoutError, 'Не удалось завершить сессию.'));
    } finally {
      setPending(null);
    }
  }

  async function handleDeveloperApply(event: FormEvent) {
    event.preventDefault();
    if (developerPending || pending) {
      return;
    }

    const composedMessage = [
      applyProject.trim() ? `Проект: ${applyProject.trim()}` : '',
      applyMessage.trim()
    ].filter(Boolean).join('\n\n');

    setDeveloperPending('apply');
    setMessage('');
    setError('');
    const result = await submitDeveloperApplication(composedMessage);
    if (!result.ok) {
      setError(result.error || 'Не удалось отправить заявку.');
      setDeveloperPending(null);
      return;
    }
    setApplyProject('');
    setApplyMessage('');
    clearDraft(DEVELOPER_APPLICATION_DRAFT_KEY);
    setApplicationDraftStatus('idle');
    setShowRetryForm(false);
    setMessage(result.data?.message || 'Заявка отправлена.');
    await loadDeveloperData();
    setDeveloperPending(null);
  }

  async function handleDeveloperVerify(event: FormEvent) {
    event.preventDefault();
    if (developerPending || pending) {
      return;
    }
    setDeveloperPending('verify');
    setMessage('');
    setError('');
    const result = await submitVerifiedAppReview({
      repositoryUrl: reviewForm.repositoryUrl,
      appName: reviewForm.appName,
      officialSiteUrl: reviewForm.officialSiteUrl,
      description: reviewForm.description,
      platform: reviewForm.platform ? (normalizeVerifiedAppPlatform(reviewForm.platform) as SiteVerifiedAppPlatform) : undefined,
      releaseTag: reviewForm.releaseTag,
      releaseAssetName: reviewForm.releaseAssetName
    });
    if (!result.ok) {
      setError(result.error || 'Не удалось отправить приложение.');
      setDeveloperPending(null);
      return;
    }
    setMessage(result.data?.message || 'Проверка отправлена.');
    setReviewForm({
      repositoryUrl: '',
      appName: '',
      officialSiteUrl: '',
      description: '',
      platform: '',
      releaseTag: '',
      releaseAssetName: ''
    });
    clearDraft(VERIFIED_REVIEW_DRAFT_KEY);
    setReviewDraftStatus('idle');
    await loadDeveloperData();
    setDeveloperPending(null);
  }

  const displayName = user?.name || portal?.user?.name || 'Аккаунт NeuralV';
  const displayEmail = user?.email || portal?.user?.email || 'Почта недоступна';
  const verifiedDeveloper = portal ? Boolean(portal.verifiedDeveloper) : Boolean(user?.is_verified_developer);
  const applicationState = resolveDeveloperApplicationState(portal?.latestApplication, verifiedDeveloper);

  return (
    <div className="page-stack profile-dashboard-shell">
      <section className="profile-dashboard-grid profile-dashboard-grid-tight">
        <aside className="content-card profile-nav-card">
          <div className="profile-nav-head">
            <strong>{displayName}</strong>
            <span>{displayEmail}</span>
          </div>
          <div className="profile-nav-list" role="tablist" aria-label="Разделы профиля">
            <button
              className={`profile-nav-button${activeTab === 'profile' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('profile')}
            >
              <span>Профиль</span>
            </button>
            <button
              className={`profile-nav-button${activeTab === 'developer' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('developer')}
            >
              <span>Разработчик</span>
            </button>
            <button
              className={`profile-nav-button${activeTab === 'security' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('security')}
            >
              <span>Безопасность</span>
            </button>
          </div>
          <div className="profile-nav-divider" />
          <button className="shell-chip shell-chip-danger profile-logout-button" type="button" onClick={handleLogout} disabled={pending !== null || developerPending !== null}>
            {pending === 'logout' ? 'Выходим...' : 'Выйти'}
          </button>
        </aside>

        <div className="profile-dashboard-main">
          {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
          {message ? <div className="form-message is-success">{message}</div> : null}

          {activeTab === 'profile' ? (
            <ProfileOverviewPanel
              overview={overview}
              loading={overviewLoading}
              name={displayName}
              email={displayEmail}
            />
          ) : null}

          {activeTab === 'security' ? (
            <SecurityWorkspace
              name={name}
              setName={setName}
              email={email}
              setEmail={setEmail}
              demoPassword={demoPassword}
              setDemoPassword={setDemoPassword}
              focused={focused}
              setFocused={setFocused}
              pending={pending}
              onNameChange={handleNameChange}
              onEmailChange={handleEmailChange}
              onPasswordChange={handlePasswordChange}
            />
          ) : null}

          {activeTab === 'developer' ? (
            developerPending === 'load' ? (
              <article className="content-card profile-panel-card profile-panel-card-centered">
                <strong className="profile-state-title">Загружаем...</strong>
              </article>
            ) : verifiedDeveloper ? (
              <VerifiedDeveloperWorkspace
                apps={verifiedApps}
                pending={developerPending}
                reviewForm={reviewForm}
                reviewDraftStatus={reviewDraftStatus}
                setReviewForm={setReviewForm}
                onVerify={handleDeveloperVerify}
              />
            ) : applicationState === 'pending' ? (
              <article className="content-card profile-panel-card profile-panel-card-featured profile-panel-card-centered">
                <strong className="profile-state-title">Заявка на рассмотрении</strong>
              </article>
            ) : applicationState === 'rejected' && !showRetryForm ? (
              <RejectedDeveloperCard application={portal?.latestApplication} onRetry={() => setShowRetryForm(true)} />
            ) : (
              <DeveloperApplicationCard
                projectName={applyProject}
                setProjectName={setApplyProject}
                message={applyMessage}
                setMessage={setApplyMessage}
                draftStatus={applicationDraftStatus}
                pending={developerPending}
                onApply={handleDeveloperApply}
              />
            )
          ) : null}
        </div>
      </section>
    </div>
  );
}
