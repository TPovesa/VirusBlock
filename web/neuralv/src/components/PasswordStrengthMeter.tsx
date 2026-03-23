import { evaluatePasswordStrength } from '../lib/siteAuth';

type PasswordStrengthMeterProps = {
  password: string;
};

const labels = {
  weak: 'Слабый',
  fair: 'Базовый',
  good: 'Нормальный',
  strong: 'Сильный'
} as const;

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const strength = evaluatePasswordStrength(password);

  return (
    <div className={`auth-strength auth-strength-${strength.label}`}>
      <div className="auth-strength-head">
        <span className="auth-field-label">Надёжность пароля</span>
        <strong>{labels[strength.label]}</strong>
      </div>
      <div className="auth-strength-track" aria-hidden="true">
        <span className="auth-strength-bar" style={{ width: `${strength.percent}%` }} />
      </div>
      {strength.hints.length > 0 ? (
        <ul className="auth-strength-hints">
          {strength.hints.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      ) : (
        <p className="hero-support-text">Пароль выглядит достаточно сильным.</p>
      )}
    </div>
  );
}
