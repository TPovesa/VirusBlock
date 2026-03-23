import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSiteAuth } from '../components/SiteAuthProvider';
import { PasswordStrength } from '../components/PasswordStrength';
import {
  humanizeError,
  requestProfileEmailChange,
  requestProfileNameChange,
  requestProfilePasswordChange,
  validatePasswordStrength
} from '../lib/siteAuth';

export function ProfilePage() {
  const { user, refresh, logout } = useSiteAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [focused, setFocused] = useState(false);
  const [demoPassword, setDemoPassword] = useState('');
  const [pending, setPending] = useState<'name' | 'email' | 'password' | 'refresh' | 'logout' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const passwordHint = useMemo(() => validatePasswordStrength(demoPassword), [demoPassword]);

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
      setError(result.error || 'Не удалось отправить письмо для смены юза.');
      return;
    }
    setMessage(result.data?.message || 'Письмо для подтверждения нового юза отправлено.');
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
    setMessage(result.data?.message || 'Письмо для подтверждения смены пароля отправлено.');
  }

  async function handleRefresh() {
    setPending('refresh');
    setMessage('');
    setError('');
    try {
      await refresh();
      setMessage('Профиль синхронизирован.');
    } catch (refreshError) {
      setError(humanizeError(refreshError, 'Не удалось синхронизировать профиль.'));
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
      setMessage('Сессия очищена.');
    } catch (logoutError) {
      setError(humanizeError(logoutError, 'Не удалось завершить сессию.'));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="page-stack profile-stack">
      <section className="hero-shell profile-shell">
        <div className="hero-copy hero-copy-tight">
          <span className="eyebrow">NeuralV account</span>
          <h1>Профиль</h1>
          <p>Юз, почта и пароль меняются через письмо со ссылкой. Само изменение подтверждается уже на сайте.</p>
          <div className="hero-actions">
            <button className="nv-button" type="button" onClick={handleRefresh} disabled={pending !== null}>
              {pending === 'refresh' ? 'Синхронизируем...' : 'Обновить профиль'}
            </button>
            <button className="shell-chip" type="button" onClick={handleLogout} disabled={pending !== null}>
              {pending === 'logout' ? 'Выходим...' : 'Выйти'}
            </button>
          </div>
        </div>

        <article className="surface-card profile-summary-card">
          <div className="profile-copy-stack">
            <span className="summary-kicker">Текущая сессия</span>
            <strong>{user?.name || 'Аккаунт NeuralV'}</strong>
            <span>{user?.email || 'Почта недоступна'}</span>
            <span>{user?.is_premium ? 'Premium активен' : 'Обычный аккаунт'}</span>
          </div>
        </article>
      </section>

      <section className="section-grid section-grid-platform profile-form-grid">
        <article className="surface-card platform-install-card">
          <div className="card-heading"><h2>Изменить юз</h2></div>
          <form className="auth-form" onSubmit={handleNameChange}>
            <label className="field-block">
              <span className="field-label">Новый юз</span>
              <input className="field-input" type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
          </form>
        </article>

        <article className="surface-card platform-install-card">
          <div className="card-heading"><h2>Изменить почту</h2></div>
          <form className="auth-form" onSubmit={handleEmailChange}>
            <label className="field-block">
              <span className="field-label">Новая почта</span>
              <input className="field-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
          </form>
        </article>

        <article className="surface-card platform-install-card profile-password-card">
          <div className="card-heading"><h2>Изменить пароль</h2></div>
          <form className="auth-form" onSubmit={handlePasswordChange}>
            <label className="field-block">
              <span className="field-label">Требования к паролю</span>
              <input
                className="field-input"
                type="password"
                value={demoPassword}
                onChange={(event) => setDemoPassword(event.target.value)}
                onFocus={() => setFocused(true)}
                placeholder="Проверь требования заранее"
              />
            </label>
            <PasswordStrength password={demoPassword} visible={focused || demoPassword.length > 0} />
            {passwordHint ? <div className="form-message">Новый пароль задаётся уже после перехода по ссылке из письма.</div> : null}
            <button className="nv-button" type="submit" disabled={pending !== null}>Отправить письмо</button>
          </form>
        </article>
      </section>

      {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
      {message ? <div className="form-message is-success">{message}</div> : null}

      <div className="auth-footer-note">
        Нужен сброс пароля без входа? <Link to="/reset-password">Открыть страницу сброса</Link>
      </div>
    </div>
  );
}
