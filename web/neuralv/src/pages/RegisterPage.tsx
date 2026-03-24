import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthCodeStep } from '../components/AuthCodeStep';
import { AuthPageLayout } from '../components/AuthPageLayout';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';
import { useSiteAuth } from '../components/SiteAuthProvider';
import {
  resendRegisterCode,
  startRegister,
  validatePasswordStrength,
  verifyRegisterCode
} from '../lib/siteAuth';
import type { SiteAuthChallenge, SiteAuthSession } from '../lib/siteAuth';

type RegisterPageProps = {
  onAuthenticated?: (session: SiteAuthSession) => void;
};

export function RegisterPage({ onAuthenticated }: RegisterPageProps) {
  const { setSession: setAuthSession } = useSiteAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<SiteAuthChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const passwordError = useMemo(() => validatePasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;
  const ready = useMemo(() => {
    return name.trim().length > 0 && email.trim().length > 0 && !passwordError && confirmPassword === password;
  }, [confirmPassword, email, name, passwordError]);

  async function handleStart(event: FormEvent) {
    event.preventDefault();
    if (!ready || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    const result = await startRegister(name.trim(), email.trim(), password);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error || 'Не удалось начать регистрацию.');
      return;
    }

    setChallenge(result.data);
    setCode('');
    setInfo(result.data.message || 'Код отправлен на почту.');
  }

  async function handleVerify() {
    if (!challenge || code.trim().length < 6 || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    const result = await verifyRegisterCode(challenge.challengeId, code.trim());
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error || 'Код не подошёл.');
      return;
    }

    setAuthSession(result.data);
    setInfo('Аккаунт создан.');
    onAuthenticated?.(result.data);
    navigate('/profile', { replace: true });
  }

  async function handleResend() {
    if (!challenge || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    const result = await resendRegisterCode(challenge.challengeId);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error || 'Не удалось отправить код ещё раз.');
      return;
    }

    setChallenge(result.data);
    setInfo(result.data.message || 'Код отправлен повторно.');
  }

  return (
    <AuthPageLayout title="Регистрация">
      {challenge ? (
        <AuthCodeStep
          email={challenge.email}
          code={code}
          loading={loading}
          onCodeChange={setCode}
          onVerify={handleVerify}
          onResend={handleResend}
          onBackToForm={() => {
            setChallenge(null);
            setCode('');
            setError(null);
            setInfo(null);
          }}
          submitLabel="Создать аккаунт"
          helper={<p className="hero-support-text">{info || 'Письмо уже в пути. Если его нет, можно отправить код ещё раз.'}</p>}
        />
      ) : (
        <form className="auth-form auth-form-register" onSubmit={handleStart}>
          <label className="auth-field">
            <span className="auth-field-label">Имя</span>
            <input className="auth-input" type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="auth-field">
            <span className="auth-field-label">Почта</span>
            <input className="auth-input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>

          <label className="auth-field">
            <span className="auth-field-label">Пароль</span>
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <PasswordStrengthMeter password={password} />

          <label className="auth-field">
            <span className="auth-field-label">Повтор пароля</span>
            <input
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>

          {!passwordsMatch && confirmPassword.length > 0 ? (
            <p className="auth-error-text">Пароли не совпадают.</p>
          ) : null}
          {passwordError ? (
            <p className="hero-support-text">{passwordError}</p>
          ) : null}
          {error ? <p className="auth-error-text">{error}</p> : null}
          {info ? <p className="hero-support-text">{info}</p> : null}

          <div className="auth-actions auth-actions-primary">
            <button className="nv-button" type="submit" disabled={!ready || loading}>
              {loading ? 'Проверяем...' : 'Отправить код'}
            </button>
          </div>

          <div className="auth-actions auth-actions-secondary auth-actions-wrap">
            <Link className="shell-link auth-inline-link" to="/login">Уже есть аккаунт? Войти</Link>
          </div>
        </form>
      )}
    </AuthPageLayout>
  );
}
