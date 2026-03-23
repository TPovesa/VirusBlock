import { evaluatePasswordStrength } from '../lib/siteAuth';

const strengthLabels = {
  weak: 'Слабый',
  fair: 'Базовый',
  good: 'Нормальный',
  strong: 'Сильный'
} as const;

export function PasswordStrength({ password, visible }: { password: string; visible: boolean }) {
  const strength = evaluatePasswordStrength(password);
  const tone =
    strength.label === 'weak'
      ? 'weak'
      : strength.label === 'fair'
        ? 'medium'
        : strength.label === 'good'
          ? 'strong'
          : 'excellent';
  const rules = [
    { id: 'len', label: 'Минимум 8 символов', passed: password.length >= 8 },
    { id: 'upper', label: 'Есть заглавная буква', passed: /[A-ZА-ЯЁ]/.test(password) },
    { id: 'lower', label: 'Есть строчная буква', passed: /[a-zа-яё]/.test(password) },
    { id: 'digit', label: 'Есть цифра', passed: /\d/.test(password) },
    { id: 'special', label: 'Есть спецсимвол', passed: /[^A-Za-zА-Яа-яЁё\d]/.test(password) }
  ];

  return (
    <div className={`password-panel${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <div className="password-meter-row">
        <div className="password-meter-track">
          <div className={`password-meter-fill tone-${tone}`} style={{ width: `${Math.max(strength.percent, 6)}%` }} />
        </div>
        <span className={`password-meter-label tone-${tone}`}>{strengthLabels[strength.label]}</span>
      </div>
      <div className="password-rule-list">
        {rules.map((rule) => (
          <div key={rule.id} className={`password-rule${rule.passed ? ' is-passed' : ''}`}>
            <span className="password-rule-dot" aria-hidden="true" />
            <span>{rule.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
