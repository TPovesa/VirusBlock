import { FormEvent, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthCodeStep } from '../components/AuthCodeStep';
import { AuthPageLayout } from '../components/AuthPageLayout';
import { SessionSummaryCard } from '../components/SessionSummaryCard';
import { useSiteAuth } from '../components/SiteAuthProvider';
import {
  SiteAuthChallenge,
  SiteAuthSession,
  resendLoginCode,
  startLogin,
  verifyLoginCode
} from '../lib/siteAuth';

type LoginPageProps = {
  onAuthenticated?: (session: SiteAuthSession) => void;
};

const initialChallenge: SiteAuthChallenge | null = null;

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const { setSession: setAuthSession } = useSiteAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<SiteAuthChallenge | null>(initialChallenge);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [session, setSession] = useState<SiteAuthSession | null>(null);

  const ready = useMemo(() => email.trim().length > 0 && password.trim().length > 0, [email, password]);

  async function handleStart(event: FormEvent) {
    event.preventDefault();
    if (!ready || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    setInfo(null);
    const result = await startLogin(email.trim(), password);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error || 'Не удалось начать вход.');
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
    const result = await verifyLoginCode(challenge.challengeId, code.trim());
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error || 'Код не подошёл.');
      return;
    }

    setSession(result.data);
    setAuthSession(result.data);
    setInfo('Вход выполнен.');
    onAuthenticated?.(result.data);
    const target = typeof location.state === 'object' && location.state && 'from' in location.state
      ? String((location.state as { from?: string }).from || '/profile')
      : '/profile';
    navigate(target, { replace: true });
  }

  async function handleResend() {
    if (!challenge || loading) {
      return;
    }

    setLoading(true);
    setError(null);
    const result = await resendLoginCode(challenge.challengeId);
    setLoading(false);

    if (!result.ok || !result.data) {
      setError(result.error || 'Не удалось отправить код ещё раз.');
      return;
    }

    setChallenge(result.data);
    setInfo(result.data.message || 'Код отправлен повторно.');
  }

  return (
    <AuthPageLayout
      title="Вход в NeuralV"
      description="Web-клиент использует тот же аккаунт и ту же двухшаговую авторизацию с кодом из почты."
      aside={<SessionSummaryCard session={session} title="Что получится после входа" />}
      footer={<span className="hero-support-text">Готовый hook для parent routing и protected pages.</span>}
    >
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
          helper={info ? <p className="hero-support-text">{info}</p> : null}
        />
      ) : (
        <form className="auth-form auth-form-login" onSubmit={handleStart}>
          <label className="auth-field">
            <span className="auth-field-label">Почта</span>
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label className="auth-field">
            <span className="auth-field-label">Пароль</span>
            <div className="field-inline">
              <input
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button className="shell-chip field-chip" type="button" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? 'Скрыть' : 'Показать'}
              </button>
            </div>
          </label>

          {error ? <p className="auth-error-text">{error}</p> : null}
          {info ? <p className="hero-support-text">{info}</p> : null}

          <div className="auth-actions auth-actions-primary">
            <button className="nv-button" type="submit" disabled={!ready || loading}>
              {loading ? 'Отправляем код...' : 'Получить код'}
            </button>
          </div>

          <div className="auth-actions auth-actions-secondary">
            <Link className="shell-chip" to="/reset-password">Сбросить пароль</Link>
            <Link className="shell-link auth-inline-link" to="/register">Нет аккаунта? Регистрация</Link>
          </div>
        </form>
      )}
    </AuthPageLayout>
  );
}
