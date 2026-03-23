import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PasswordStrength } from '../components/PasswordStrength';
import { useSiteAuth } from '../components/SiteAuthProvider';
import {
  confirmProfileAction,
  humanizeError,
  inspectProfileAction,
  SiteProfileActionPreview,
  validatePasswordStrength
} from '../lib/siteAuth';

export function AccountActionPage() {
  const { logout, refresh } = useSiteAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token')?.trim() || '';
  const [pending, setPending] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<SiteProfileActionPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const passwordError = useMemo(() => validatePasswordStrength(password), [password]);
  const needsPassword = preview?.kind === 'profile_password_change';

  useEffect(() => {
    if (!token) {
      setPending(false);
      setError('Ссылка неполная или повреждена.');
      return;
    }

    inspectProfileAction(token)
      .then((result) => {
        if (!result.ok || !result.data) {
          setError(result.error || 'Эта ссылка недоступна или уже истекла.');
          return;
        }
        setPreview(result.data);
      })
      .finally(() => setPending(false));
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token || !preview || submitting) {
      return;
    }

    if (needsPassword) {
      if (passwordError) {
        setError(passwordError);
        return;
      }
      if (password !== confirmPassword) {
        setError('Пароли не совпадают.');
        return;
      }
    }

    setSubmitting(true);
    setError('');
    setMessage('');
    const result = await confirmProfileAction(token, needsPassword ? { password } : undefined);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Не удалось подтвердить действие.');
      return;
    }

    if (result.data?.requiresRelogin) {
      await logout();
      setMessage(result.data?.message || 'Действие подтверждено. Войдите заново.');
      navigate('/login', { replace: true });
      return;
    }

    try {
      await refresh();
    } catch {
      // The action itself is already confirmed on the backend.
    }

    setMessage(result.data?.message || 'Действие подтверждено.');
  }

  return (
    <div className="page-stack auth-page-stack">
      <section className="hero-shell auth-shell action-shell">
        <div className="hero-copy hero-copy-tight">
          <span className="eyebrow">NeuralV account</span>
          <h1>{preview?.title || 'Подтверждение действия'}</h1>
          <p>Подтверждение идёт прямо на сайте. Если это были не вы, просто закройте страницу.</p>
        </div>

        <article className="surface-card auth-card auth-card-wide">
          {pending ? <div className="form-message">Проверяем ссылку...</div> : null}
          {!pending && error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}
          {!pending && message ? <div className="form-message is-success">{message}</div> : null}

          {!pending && preview ? (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="action-preview">
                <div className="action-preview-row"><span>Почта</span><strong>{preview.email}</strong></div>
                {preview.pendingName ? <div className="action-preview-row"><span>Новый юз</span><strong>{preview.pendingName}</strong></div> : null}
                {preview.currentEmail ? <div className="action-preview-row"><span>Старая почта</span><strong>{preview.currentEmail}</strong></div> : null}
                {preview.nextEmail ? <div className="action-preview-row"><span>Новая почта</span><strong>{preview.nextEmail}</strong></div> : null}
                {preview.maskedEmail ? <div className="action-preview-row"><span>Аккаунт</span><strong>{preview.maskedEmail}</strong></div> : null}
              </div>

              {needsPassword ? (
                <>
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
                </>
              ) : null}

              <div className="auth-actions-row">
                <button className="nv-button" type="submit" disabled={submitting}>
                  {submitting ? 'Подтверждаем...' : 'Подтвердить'}
                </button>
                <Link className="shell-chip" to="/login">К аккаунту</Link>
              </div>
            </form>
          ) : null}
        </article>
      </section>
    </div>
  );
}
