import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PasswordStrength } from '../components/PasswordStrength';
import { useSiteAuth } from '../components/SiteAuthProvider';
import {
  fetchDeveloperPortalState,
  fetchOwnVerifiedApps,
  humanizeError,
  requestProfileEmailChange,
  requestProfileNameChange,
  requestProfilePasswordChange,
  submitDeveloperApplication,
  submitVerifiedAppReview,
  type SiteDeveloperPortalState,
  type SiteVerifiedApp,
  validatePasswordStrength
} from '../lib/siteAuth';
import '../styles/auth.css';

type ProfileTab = 'developer' | 'security';
type AccountPending = 'name' | 'email' | 'password' | 'refresh' | 'logout' | null;
type DeveloperPending = 'load' | 'apply' | 'verify' | null;
type PlatformOption = 'android' | 'windows' | 'linux';

type ReviewFormState = {
  appName: string;
  platform: PlatformOption;
  repositoryUrl: string;
  releaseArtifactUrl: string;
  officialSiteUrl: string;
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

type DeveloperWorkspaceProps = {
  portal: SiteDeveloperPortalState | null;
  apps: SiteVerifiedApp[];
  loading: boolean;
  pending: DeveloperPending;
  note: string;
  error: string;
  applyMessage: string;
  setApplyMessage: (value: string) => void;
  reviewForm: ReviewFormState;
  setReviewForm: Dispatch<SetStateAction<ReviewFormState>>;
  onApply: (event: FormEvent) => Promise<void>;
  onVerify: (event: FormEvent) => Promise<void>;
  onReload: () => Promise<void>;
};

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

function ProfileVerifiedAppCard({ app }: { app: SiteVerifiedApp }) {
  const initial = (app.appName || '?').slice(0, 1).toUpperCase();
  const verifiedAt = formatDate(app.verifiedAt || app.createdAt);
  const safe = String(app.status || '').toUpperCase() === 'SAFE';

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
          <p>{app.authorName || 'Разработчик NeuralV'}</p>
        </div>
      </div>
      {app.publicSummary ? <p className="developer-app-summary">{app.publicSummary}</p> : null}
      <div className="developer-app-row">
        <span>Платформа</span>
        <strong>{String(app.platform || '').toUpperCase()}</strong>
      </div>
      <div className="developer-app-links">
        {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
        {app.releaseArtifactUrl ? <a className="shell-chip" href={app.releaseArtifactUrl} target="_blank" rel="noreferrer">Релиз</a> : null}
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
  const passwordHint = useMemo(() => validatePasswordStrength(demoPassword), [demoPassword]);

  return (
    <div className="profile-panel-stack">
      <article className="content-card profile-panel-card profile-panel-card-featured">
        <div className="profile-panel-head">
          <h2>Безопасность</h2>
          <p>Имя, почта и пароль меняются только через письмо подтверждения.</p>
        </div>
      </article>

      <div className="profile-security-grid">
        <section className="content-card profile-panel-card profile-form-card">
          <div className="profile-panel-head">
            <h3>Имя</h3>
            <p>Подтверждение нового имени придёт по почте.</p>
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
            <h3>Почта</h3>
            <p>Новый адрес подтверждается только ссылкой из письма.</p>
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
          <h3>Пароль</h3>
          <p>Новый пароль задаётся после перехода по ссылке из письма.</p>
        </div>
        <form className="auth-form" onSubmit={onPasswordChange}>
          <label className="auth-field">
            <span className="auth-field-label">Проверить пароль заранее</span>
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
          {passwordHint ? <div className="hero-support-text">Финальный шаг смены пароля откроется в браузере по ссылке из письма.</div> : null}
          <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
        </form>
        <div className="auth-footer-note">
          Нужен сброс без входа? <Link to="/reset-password">Открыть страницу сброса</Link>
        </div>
      </section>
    </div>
  );
}

function DeveloperWorkspace({
  portal,
  apps,
  loading,
  pending,
  note,
  error,
  applyMessage,
  setApplyMessage,
  reviewForm,
  setReviewForm,
  onApply,
  onVerify,
  onReload
}: DeveloperWorkspaceProps) {
  const verifiedDeveloper = Boolean(portal?.verifiedDeveloper);
  const verifiedAtText = formatDate(portal?.verifiedDeveloperAt);
  const lastApplication = portal?.latestApplication;
  const stats = portal?.stats;

  return (
    <div className="profile-panel-stack">
      <article className="content-card profile-panel-card profile-panel-card-featured">
        <div className="profile-panel-head profile-panel-head-wide">
          <div>
            <div className="profile-panel-badge-row">
              <span className={`profile-status-pill${verifiedDeveloper ? ' is-active' : ''}`}>
                {verifiedDeveloper ? 'Статус разработчика подтверждён' : 'Обычный аккаунт'}
              </span>
            </div>
            <h2>Разработчик</h2>
            <p>
              {verifiedDeveloper
                ? 'Здесь подаются репозиторий, релиз и платформа приложения. После автоматической проверки безопасные сборки попадают в публичный каталог.'
                : 'Сначала отправь заявку на статус разработчика. После подтверждения откроется форма сертификации приложений.'}
            </p>
          </div>
          <button className="shell-chip" type="button" onClick={onReload} disabled={pending !== null}>
            {loading || pending === 'load' ? 'Обновляем...' : 'Обновить раздел'}
          </button>
        </div>
      </article>

      <div className="profile-summary-grid profile-summary-grid-developer">
        <article className="content-card profile-summary-card-hero">
          <span className="profile-summary-label">Статус</span>
          <strong>{verifiedDeveloper ? 'Подтверждён' : 'Ожидает подтверждения'}</strong>
          <p>{verifiedAtText ? `Подтверждено ${verifiedAtText}.` : 'После подтверждения появится форма сертификации приложений.'}</p>
        </article>
        <article className="content-card profile-summary-card-hero">
          <span className="profile-summary-label">Безопасных сборок</span>
          <strong>{stats?.safe ?? 0}</strong>
          <p>Столько релизов уже получили статус «Безопасно».</p>
        </article>
        <article className="content-card profile-summary-card-hero">
          <span className="profile-summary-label">Очередь</span>
          <strong>{(stats?.queued ?? 0) + (stats?.running ?? 0)}</strong>
          <p>Активные проверки и задачи, которые ещё ждут завершения.</p>
        </article>
      </div>

      {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
      {note ? <div className="form-message is-success">{note}</div> : null}

      {!verifiedDeveloper ? (
        <div className="profile-developer-grid">
          <section className="content-card profile-panel-card profile-form-card">
            <div className="profile-panel-head">
              <h3>Заявка на статус разработчика</h3>
              <p>Письмо уйдёт на почту админа. После ручного подтверждения этот аккаунт получит доступ к сертификации приложений.</p>
            </div>
            <form className="auth-form" onSubmit={onApply}>
              <label className="auth-field">
                <span className="auth-field-label">Коротко о проекте</span>
                <textarea
                  className="auth-input auth-textarea"
                  value={applyMessage}
                  onChange={(event) => setApplyMessage(event.target.value)}
                  placeholder="Что это за приложение, где лежит исходник и что именно нужно проверить"
                  rows={5}
                />
              </label>
              <button className="nv-button" type="submit" disabled={pending !== null}>
                {pending === 'apply' ? 'Отправляем...' : 'Отправить заявку'}
              </button>
            </form>
          </section>

          <section className="content-card profile-panel-card">
            <div className="profile-panel-head">
              <h3>Последняя заявка</h3>
              <p>{lastApplication ? 'Текущий статус последней заявки.' : 'Заявок пока нет.'}</p>
            </div>
            {lastApplication ? (
              <div className="profile-status-stack">
                <strong>{lastApplication.status || 'PENDING_REVIEW'}</strong>
                {lastApplication.message ? <p>{lastApplication.message}</p> : null}
                {lastApplication.createdAt ? <p>Отправлено: {formatDate(lastApplication.createdAt)}</p> : null}
                {lastApplication.reviewedAt ? <p>Проверено: {formatDate(lastApplication.reviewedAt)}</p> : null}
                {lastApplication.reviewNote ? <p>{lastApplication.reviewNote}</p> : null}
              </div>
            ) : (
              <div className="profile-empty-copy">Как только заявка появится, её статус будет виден здесь.</div>
            )}
          </section>
        </div>
      ) : (
        <>
          <section className="content-card profile-panel-card profile-form-card">
            <div className="profile-panel-head">
              <h3>Сертификация приложения</h3>
              <p>Нужен публичный GitHub-репозиторий, точный release artifact и платформа приложения.</p>
            </div>
            <form className="auth-form" onSubmit={onVerify}>
              <div className="profile-security-grid">
                <label className="auth-field">
                  <span className="auth-field-label">Название приложения</span>
                  <input
                    className="auth-input"
                    type="text"
                    value={reviewForm.appName}
                    onChange={(event) => setReviewForm((current) => ({ ...current, appName: event.target.value }))}
                    placeholder="Например, NeuralV Launcher"
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field-label">Платформа</span>
                  <select
                    className="auth-input"
                    value={reviewForm.platform}
                    onChange={(event) => setReviewForm((current) => ({ ...current, platform: event.target.value as PlatformOption }))}
                  >
                    <option value="windows">Windows</option>
                    <option value="android">Android</option>
                    <option value="linux">Linux</option>
                  </select>
                </label>
              </div>

              <label className="auth-field">
                <span className="auth-field-label">GitHub-репозиторий</span>
                <input
                  className="auth-input"
                  type="url"
                  value={reviewForm.repositoryUrl}
                  onChange={(event) => setReviewForm((current) => ({ ...current, repositoryUrl: event.target.value }))}
                  placeholder="https://github.com/owner/repo"
                />
              </label>

              <label className="auth-field">
                <span className="auth-field-label">Release artifact</span>
                <input
                  className="auth-input"
                  type="url"
                  value={reviewForm.releaseArtifactUrl}
                  onChange={(event) => setReviewForm((current) => ({ ...current, releaseArtifactUrl: event.target.value }))}
                  placeholder="https://github.com/owner/repo/releases/download/..."
                />
              </label>

              <label className="auth-field">
                <span className="auth-field-label">Официальный сайт (необязательно)</span>
                <input
                  className="auth-input"
                  type="url"
                  value={reviewForm.officialSiteUrl}
                  onChange={(event) => setReviewForm((current) => ({ ...current, officialSiteUrl: event.target.value }))}
                  placeholder="https://example.com"
                />
              </label>

              <div className="profile-inline-note">
                Сервер анализирует только публичный репозиторий и точный релизный файл. Если безопасная версия подтверждена, её хеш дальше используется как trusted-совпадение при проверках.
              </div>

              <button className="nv-button" type="submit" disabled={pending !== null}>
                {pending === 'verify' ? 'Запускаем проверку...' : 'Запустить верификацию'}
              </button>
            </form>
          </section>

          <section className="content-card profile-panel-card">
            <div className="profile-panel-head profile-panel-head-wide">
              <div>
                <h3>Проверенные приложения</h3>
                <p>Безопасные релизы видны и здесь, и в общем каталоге.</p>
              </div>
              <Link className="shell-chip" to="/verified-apps">Открыть каталог</Link>
            </div>
            {apps.length > 0 ? (
              <div className="developer-app-grid">
                {apps.map((app) => (
                  <ProfileVerifiedAppCard key={app.id || `${app.appName}-${app.platform}`} app={app} />
                ))}
              </div>
            ) : (
              <div className="profile-empty-copy">Сертифицированных приложений пока нет. Как только сервер закончит первую проверку, карточка появится здесь.</div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function ProfilePage() {
  const { user, refresh, logout } = useSiteAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>('developer');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [focused, setFocused] = useState(false);
  const [demoPassword, setDemoPassword] = useState('');
  const [pending, setPending] = useState<AccountPending>(null);
  const [developerPending, setDeveloperPending] = useState<DeveloperPending>('load');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [portal, setPortal] = useState<SiteDeveloperPortalState | null>(null);
  const [verifiedApps, setVerifiedApps] = useState<SiteVerifiedApp[]>([]);
  const [applyMessage, setApplyMessage] = useState('');
  const [reviewForm, setReviewForm] = useState<ReviewFormState>({
    appName: '',
    platform: 'windows',
    repositoryUrl: '',
    releaseArtifactUrl: '',
    officialSiteUrl: ''
  });

  useEffect(() => {
    setName(user?.name || '');
    setEmail(user?.email || '');
  }, [user?.email, user?.name]);

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

      if (appsResult.ok && appsResult.data) {
        setVerifiedApps(appsResult.data);
      } else {
        setVerifiedApps([]);
      }
    } catch (loadError) {
      setError(humanizeError(loadError, 'Не удалось загрузить раздел разработчика.'));
    } finally {
      setDeveloperPending(null);
    }
  }

  useEffect(() => {
    void loadDeveloperData();
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
    setMessage(result.data?.message || 'Письмо для подтверждения нового имени отправлено.');
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
    setMessage(result.data?.message || 'Письмо для подтверждения новой почты отправлено.');
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
    setMessage(result.data?.message || 'Письмо для смены пароля отправлено.');
  }

  async function handleRefresh() {
    setPending('refresh');
    setMessage('');
    setError('');
    try {
      await refresh();
      await loadDeveloperData();
      setMessage('Профиль обновлён.');
    } catch (refreshError) {
      setError(humanizeError(refreshError, 'Не удалось обновить профиль.'));
    } finally {
      setPending(null);
    }
  }

  async function handleLogout() {
    setPending('logout');
    setMessage('');
    setError('');
    try {
      await logout();
      setMessage('Сессия завершена.');
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
    setDeveloperPending('apply');
    setMessage('');
    setError('');
    const result = await submitDeveloperApplication(applyMessage.trim());
    if (!result.ok) {
      setError(result.error || 'Не удалось отправить заявку на статус разработчика.');
      setDeveloperPending(null);
      return;
    }
    setApplyMessage('');
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
      appName: reviewForm.appName,
      platform: reviewForm.platform,
      repositoryUrl: reviewForm.repositoryUrl,
      releaseArtifactUrl: reviewForm.releaseArtifactUrl,
      officialSiteUrl: reviewForm.officialSiteUrl
    });
    if (!result.ok) {
      setError(result.error || 'Не удалось запустить проверку приложения.');
      setDeveloperPending(null);
      return;
    }
    setMessage(result.data?.message || 'Проверка запущена.');
    await loadDeveloperData();
    setDeveloperPending(null);
  }

  const displayName = user?.name || portal?.user?.name || 'Аккаунт NeuralV';
  const displayEmail = user?.email || portal?.user?.email || 'Почта недоступна';
  const verifiedDeveloper = Boolean(portal?.verifiedDeveloper || user?.is_verified_developer);

  return (
    <div className="page-stack profile-dashboard-shell">
      <section className="hero-shell profile-hub-hero">
        <div className="hero-copy profile-hub-copy">
          <div className="profile-hub-heading">
            <h1>Профиль</h1>
            <p>Раздел разработчика и настройки безопасности собраны в одном месте без лишних боковых блоков.</p>
          </div>
          <div className="hero-actions profile-hub-actions">
            <button className="shell-chip" type="button" onClick={handleRefresh} disabled={pending !== null || developerPending !== null}>
              {pending === 'refresh' ? 'Обновляем...' : 'Обновить профиль'}
            </button>
          </div>
        </div>
        <div className="profile-hub-summary-grid">
          <article className="content-card profile-summary-card-hero">
            <span className="profile-summary-label">Аккаунт</span>
            <strong>{displayName}</strong>
            <p>{displayEmail}</p>
          </article>
          <article className="content-card profile-summary-card-hero">
            <span className="profile-summary-label">Доступ</span>
            <strong>{user?.is_premium ? 'Расширенный' : 'Обычный'}</strong>
            <p>{user?.is_premium ? 'Премиум активен на аккаунте.' : 'Обычный режим без премиум-доступа.'}</p>
          </article>
          <article className="content-card profile-summary-card-hero">
            <span className="profile-summary-label">Разработчик</span>
            <strong>{verifiedDeveloper ? 'Подтверждён' : 'Не подтверждён'}</strong>
            <p>{verifiedDeveloper ? 'Сертификация приложений уже доступна.' : 'Сначала нужна заявка на статус разработчика.'}</p>
          </article>
        </div>
      </section>

      <section className="profile-dashboard-grid">
        <aside className="content-card profile-nav-card">
          <div className="profile-nav-head">
            <span className="profile-summary-label">Меню</span>
            <strong>{displayName}</strong>
          </div>
          <div className="profile-nav-list" role="tablist" aria-label="Разделы профиля">
            <button
              className={`profile-nav-button${activeTab === 'developer' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('developer')}
            >
              <span>Разработчик</span>
              <small>Статус, сертификация и проверенные приложения.</small>
            </button>
            <button
              className={`profile-nav-button${activeTab === 'security' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('security')}
            >
              <span>Безопасность</span>
              <small>Имя, почта и пароль через письмо подтверждения.</small>
            </button>
          </div>
          <div className="profile-nav-divider" />
          <button className="shell-chip shell-chip-danger profile-logout-button" type="button" onClick={handleLogout} disabled={pending !== null || developerPending !== null}>
            {pending === 'logout' ? 'Выходим...' : 'Выйти'}
          </button>
        </aside>

        <div className="profile-dashboard-main">
          {activeTab === 'developer' ? (
            <DeveloperWorkspace
              portal={portal}
              apps={verifiedApps}
              loading={developerPending === 'load'}
              pending={developerPending}
              note={message}
              error={error}
              applyMessage={applyMessage}
              setApplyMessage={setApplyMessage}
              reviewForm={reviewForm}
              setReviewForm={setReviewForm}
              onApply={handleDeveloperApply}
              onVerify={handleDeveloperVerify}
              onReload={loadDeveloperData}
            />
          ) : (
            <>
              {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
              {message ? <div className="form-message is-success">{message}</div> : null}
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
            </>
          )}
        </div>
      </section>
    </div>
  );
}
