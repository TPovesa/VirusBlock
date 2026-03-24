import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PasswordStrength } from '../components/PasswordStrength';
import { useSiteAuth } from '../components/SiteAuthProvider';
import {
  humanizeError,
  requestProfileEmailChange,
  requestProfileNameChange,
  requestProfilePasswordChange,
  validatePasswordStrength
} from '../lib/siteAuth';
import '../styles/auth.css';

type ProfileTab = 'developer' | 'security';

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
}: {
  name: string;
  setName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  demoPassword: string;
  setDemoPassword: (value: string) => void;
  focused: boolean;
  setFocused: (value: boolean) => void;
  pending: string | null;
  onNameChange: (event: FormEvent) => Promise<void>;
  onEmailChange: (event: FormEvent) => Promise<void>;
  onPasswordChange: (event: FormEvent) => Promise<void>;
}) {
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
  verifiedDeveloper,
  verifiedDeveloperAt,
  displayName,
  displayEmail
}: {
  verifiedDeveloper: boolean;
  verifiedDeveloperAt?: string | number | null;
  displayName: string;
  displayEmail: string;
}) {
  const verifiedAtText = verifiedDeveloperAt
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(verifiedDeveloperAt))
    : null;

  return (
    <div className="profile-panel-stack">
      <article className="content-card profile-panel-card profile-panel-card-featured">
        <div className="profile-panel-head">
          <div className="profile-panel-badge-row">
            <span className={`profile-status-pill${verifiedDeveloper ? ' is-active' : ''}`}>
              {verifiedDeveloper ? 'Доступ открыт' : 'Ожидает подтверждения'}
            </span>
          </div>
          <h2>Разработчик</h2>
          <p>Основной раздел для отправки приложения на проверку, публикации безопасных сборок и работы с репозиторием.</p>
        </div>
      </article>

      <div className="profile-developer-grid">
        <article className="content-card profile-panel-card profile-panel-card-emphasis">
          <div className="profile-panel-head">
            <h3>Статус</h3>
            <p>{displayName || 'Аккаунт NeuralV'} · {displayEmail || 'Почта недоступна'}</p>
          </div>
          <div className="profile-status-stack">
            <strong>{verifiedDeveloper ? 'Профиль разработчика подтверждён' : 'Пока обычный аккаунт'}</strong>
            <p>
              {verifiedDeveloper
                ? `Можно готовить репозиторий, release-артефакт и платформу приложения.${verifiedAtText ? ` Подтверждено ${verifiedAtText}.` : ''}`
                : 'После подтверждения здесь появится рабочий маршрут для отправки репозитория и релизной сборки на проверку.'}
            </p>
          </div>
        </article>

        <article className="content-card profile-panel-card">
          <div className="profile-panel-head">
            <h3>Что подготовить</h3>
            <p>Нужно заранее собрать всё, что понадобится для сертификации.</p>
          </div>
          <ul className="profile-checklist">
            <li>Публичный GitHub-репозиторий приложения.</li>
            <li>Точная релизная сборка, которую получает пользователь.</li>
            <li>Платформа разработки и короткое имя приложения.</li>
            <li>Иконка или ассеты, если они уже лежат в репозитории.</li>
          </ul>
        </article>

        <article className="content-card profile-panel-card">
          <div className="profile-panel-head">
            <h3>Что появится здесь</h3>
            <p>Раздел уже собран под developer-first сценарий и больше не смешивает его с обычной безопасностью аккаунта.</p>
          </div>
          <ul className="profile-checklist">
            <li>Заявка на статус разработчика.</li>
            <li>Отправка репозитория и release-артефакта на проверку.</li>
            <li>Список приложений, которые прошли верификацию.</li>
            <li>Публичный статус безопасности для подтверждённых сборок.</li>
          </ul>
        </article>
      </div>
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
  const [pending, setPending] = useState<'name' | 'email' | 'password' | 'refresh' | 'logout' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(user?.name || '');
    setEmail(user?.email || '');
  }, [user?.email, user?.name]);

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

  const profileUser = user as (typeof user & { is_verified_developer?: boolean; verified_developer_at?: string | number | null }) | null;
  const displayName = user?.name || 'Аккаунт NeuralV';
  const displayEmail = user?.email || 'Почта недоступна';
  const verifiedDeveloper = Boolean(profileUser?.is_verified_developer);

  return (
    <div className="page-stack profile-dashboard-shell">
      <section className="hero-shell profile-hub-hero">
        <div className="hero-copy profile-hub-copy">
          <div className="profile-hub-heading">
            <h1>Профиль</h1>
            <p>Аккаунт, безопасность и раздел разработчика собраны в одном месте без лишних боковых блоков.</p>
          </div>
          <div className="hero-actions profile-hub-actions">
            <button className="shell-chip" type="button" onClick={handleRefresh} disabled={pending !== null}>
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
            <p>{verifiedDeveloper ? 'Раздел разработчика открыт для этого аккаунта.' : 'Пока доступна только обычная учётная запись.'}</p>
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
              <small>Репозиторий, публикация и статус приложений.</small>
            </button>
            <button
              className={`profile-nav-button${activeTab === 'security' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setActiveTab('security')}
            >
              <span>Безопасность</span>
              <small>Имя, почта и пароль по ссылке из письма.</small>
            </button>
          </div>
          <div className="profile-nav-divider" />
          <button className="shell-chip shell-chip-danger profile-logout-button" type="button" onClick={handleLogout} disabled={pending !== null}>
            {pending === 'logout' ? 'Выходим...' : 'Выйти'}
          </button>
        </aside>

        <div className="profile-dashboard-main">
          {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
          {message ? <div className="form-message is-success">{message}</div> : null}

          {activeTab === 'developer' ? (
            <DeveloperWorkspace
              verifiedDeveloper={verifiedDeveloper}
              verifiedDeveloperAt={profileUser?.verified_developer_at}
              displayName={displayName}
              displayEmail={displayEmail}
            />
          ) : (
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
          )}
        </div>
      </section>
    </div>
  );
}
