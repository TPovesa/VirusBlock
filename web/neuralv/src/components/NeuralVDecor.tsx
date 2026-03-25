type NeuralVDecorVariant = 'home' | 'android' | 'windows' | 'linux' | 'account';

type NeuralVDecorProps = {
  variant: NeuralVDecorVariant;
  className?: string;
};

const labels: Record<NeuralVDecorVariant, { title: string; note: string; src: string; alt: string }> = {
  home: {
    title: 'NeuralV',
    note: 'Android / Windows / Linux',
    src: '/neuralv/media/story/platforms-poster.avif',
    alt: 'Тёмная серверная инфраструктура.'
  },
  android: {
    title: 'Android',
    note: 'Один APK',
    src: '/neuralv/media/story/android.jpg',
    alt: 'Микросхема крупным планом.'
  },
  windows: {
    title: 'Windows',
    note: 'Setup / portable / NV',
    src: '/neuralv/media/story/windows.jpg',
    alt: 'Тёмное рабочее место с экраном.'
  },
  linux: {
    title: 'Linux',
    note: 'Установка через NV',
    src: '/neuralv/media/story/linux-poster.avif',
    alt: 'Код на тёмном экране.'
  },
  account: {
    title: 'Аккаунт',
    note: 'Почта, профиль и подтверждения',
    src: '/neuralv/media/story/account.jpg',
    alt: 'Тёмное рабочее пространство с ноутбуком.'
  }
};

export function NeuralVDecor({ variant, className = '' }: NeuralVDecorProps) {
  const copy = labels[variant];

  return (
    <div className={`neuralv-decor-static ${className}`.trim()} aria-hidden="true">
      <div className="neuralv-decor-card neuralv-decor-card-main">
        <img className="neuralv-decor-image" src={copy.src} alt={copy.alt} loading="lazy" />
        <span className="neuralv-decor-shade" />
        <span className="neuralv-decor-grid" />
        <div className="neuralv-decor-copy">
          <strong>{copy.title}</strong>
          <span>{copy.note}</span>
        </div>
      </div>
    </div>
  );
}
