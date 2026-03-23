import type { ReactNode } from 'react';

type AuthCodeStepProps = {
  email: string;
  code: string;
  loading?: boolean;
  onCodeChange: (value: string) => void;
  onVerify: () => void;
  onResend: () => void;
  onBackToForm: () => void;
  submitLabel?: string;
  helper?: ReactNode;
};

export function AuthCodeStep({
  email,
  code,
  loading = false,
  onCodeChange,
  onVerify,
  onResend,
  onBackToForm,
  submitLabel = 'Подтвердить',
  helper
}: AuthCodeStepProps) {
  return (
    <div className="auth-step auth-step-code">
      <div className="auth-copy-block">
        <h3>Код из почты</h3>
        <p className="hero-support-text">Код отправлен на {email || 'указанный адрес'}.</p>
        {helper}
      </div>

      <label className="auth-field auth-field-code">
        <span className="auth-field-label">Код</span>
        <input
          className="auth-input auth-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => onCodeChange(event.target.value.replace(/\D+/g, '').slice(0, 6))}
        />
      </label>

      <div className="auth-actions auth-actions-primary">
        <button
          type="button"
          className="nv-button"
          onClick={onVerify}
          disabled={loading || code.trim().length < 6}
        >
          {loading ? 'Проверяем...' : submitLabel}
        </button>
        <button type="button" className="nv-button tonal" onClick={onResend} disabled={loading}>
          Отправить ещё раз
        </button>
      </div>

      <button type="button" className="shell-link auth-inline-link" onClick={onBackToForm}>
        Ввести данные заново
      </button>
    </div>
  );
}
