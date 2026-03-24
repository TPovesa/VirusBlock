type NeuralVDecorVariant = 'home' | 'android' | 'windows' | 'linux' | 'account';

type NeuralVDecorProps = {
  variant: NeuralVDecorVariant;
  className?: string;
};

const labels: Record<NeuralVDecorVariant, { title?: string; note?: string }> = {
  home: { title: 'NeuralV', note: 'Android / Windows / Linux' },
  android: { title: 'Android', note: 'Один APK' },
  windows: { title: 'Windows', note: 'Setup / portable / NV' },
  linux: { title: 'Linux', note: 'Установка через NV' },
  account: {}
};

export function NeuralVDecor({ variant, className = '' }: NeuralVDecorProps) {
  const copy = labels[variant];

  return (
    <div className={`neuralv-decor-static ${className}`.trim()} aria-hidden="true">
      <div className="neuralv-decor-card neuralv-decor-card-main">
        <svg className="neuralv-decor-svg" viewBox="0 0 320 220" fill="none">
          <rect x="18" y="16" width="284" height="188" rx="32" className="neuralv-decor-frame" />
          <rect x="40" y="42" width="240" height="70" rx="24" className="neuralv-decor-block neuralv-decor-block-accent" />
          <rect x="52" y="130" width="80" height="52" rx="20" className="neuralv-decor-block" />
          <rect x="148" y="130" width="120" height="52" rx="20" className="neuralv-decor-block" />
          <path d="M86 156 C112 156 124 110 164 110 C204 110 212 164 248 164" className="neuralv-decor-line" />
          <circle cx="86" cy="156" r="9" className="neuralv-decor-node" />
          <circle cx="164" cy="110" r="11" className="neuralv-decor-node neuralv-decor-node-accent" />
          <circle cx="248" cy="164" r="9" className="neuralv-decor-node" />
          <circle cx="164" cy="110" r="24" stroke="rgba(206,78,92,0.28)" strokeWidth="2" fill="none" />
          <circle cx="248" cy="164" r="32" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" fill="none" />
          <rect x="70" y="62" width="180" height="12" rx="6" className="neuralv-decor-block-accent" />
        </svg>
        {copy.title || copy.note ? (
          <div className="neuralv-decor-copy">
            {copy.title ? <strong>{copy.title}</strong> : null}
            {copy.note ? <span>{copy.note}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
