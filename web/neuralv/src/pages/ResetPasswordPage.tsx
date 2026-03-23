import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PasswordStrength } from '../components/PasswordStrength';
import {
  confirmPasswordReset,
  humanizeError,
  inspectPasswordResetLink,
  requestPasswordReset,
  validatePasswordStrength
} from '../lib/siteAuth';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() || '';
  const email = params.get('email')?.trim() || '';
  const hasResetLink = Boolean(token && email);

  const [requestEmail, setRequestEmail] = useState(email);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [focused, setFocused] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [readyLink, setReadyLink] = useState(false);

  const passwordError = useMemo(() => validatePasswordStrength(password), [password]);

  useEffect(() => {
    if (!hasResetLink) {
      return;
    }

    setPending(true);
    setError('');
    inspectPasswordResetLink(token, email)
      .then((result) => {
        if (!result.ok) {
          setError(result.error || 'Эта ссылка недоступна или уже истекла.');
          return;
        }
        setReadyLink(true);
      })
      .finally(() => setPending(false));
  }, [email, hasResetLink, token]);

  async function handleRequestSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !requestEmail.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    const result = await requestPasswordReset(requestEmail.trim());
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Не удалось отправить письмо для сброса пароля.');
      return;
    }

    setMessage(result.data?.message || 'Письмо со ссылкой для сброса пароля отправлено.');
  }

  async function handleConfirmSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || !readyLink) {
      return;
    }

    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('Пароли не совпадают.');
      return;
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    const result = await confirmPasswordReset({ email, token, password });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Не удалось обновить пароль.');
      return;
    }

    setMessage(result.data?.message || 'Пароль обновлён.');
  }

  return (
    <div className="page-stack auth-page-stack">
      <section className="hero-shell auth-shell reset-shell">
        <div className="hero-copy hero-copy-tight">
          <span className="eyebrow">NeuralV account</span>
          <h1>{hasResetLink ? 'Новый пароль' : 'Сброс пароля'}</h1>
          <p>{hasResetLink ? 'Пароль меняется прямо на сайте. Приложение здесь не участвует.' : 'Отправим письмо со ссылкой. Новый пароль задаётся прямо на сайте.'}</p>
        </div>

        <article className="surface-card auth-card auth-card-wide">
          {hasResetLink ? (
            <form className="auth-form" onSubmit={handleConfirmSubmit}>
              {pending ? <div className="form-message">Проверяем ссылку...</div> : null}

              <label className="field-block">
                <span className="field-label">Почта</span>
                <input className="field-input" type="email" value={email} readOnly />
              </label>

              <label className="field-block">
                <span className="field-label">Новый пароль</span>
                <input
                  className="field-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onFocus={() => setFocused(true)}
                  autoComplete="new-password"
                  required
                />
              </label>
              <PasswordStrength password={password} visible={focused || password.length > 0} />

              <label className="field-block field-block-compact-gap">
                <span className="field-label">Подтверждение</span>
                <input
                  className="field-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>

              {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
              {message ? <div className="form-message is-success">{message}</div> : null}

              <div className="auth-actions-row">
                <button className="nv-button" type="submit" disabled={submitting || pending || !readyLink}>
                  {submitting ? 'Сохраняем...' : 'Обновить пароль'}
                </button>
                <Link className="shell-chip" to="/login">К входу</Link>
              </div>
            </form>
          ) : (
            <form className="auth-form" onSubmit={handleRequestSubmit}>
              <label className="field-block">
                <span className="field-label">Почта аккаунта</span>
                <input
                  className="field-input"
                  type="email"
                  value={requestEmail}
                  onChange={(event) => setRequestEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
              {message ? <div className="form-message is-success">{message}</div> : null}

              <div className="auth-actions-row">
                <button className="nv-button" type="submit" disabled={submitting}>
                  {submitting ? 'Отправляем...' : 'Отправить письмо'}
                </button>
                <Link className="shell-chip" to="/login">Назад ко входу</Link>
              </div>
            </form>
          )}
        </article>
      </section>
    </div>
  );
}
