import type { ReactNode } from 'react';
import { useScrollSceneProgress } from '../hooks/useScrollSceneProgress';

type StoryVisualKind = 'shield' | 'route' | 'platforms' | 'privacy' | 'android' | 'windows' | 'linux';

type StorySceneProps = {
  title: string;
  body: string;
  kicker?: string;
  accent?: string;
  visual: StoryVisualKind;
  aside?: ReactNode;
  compact?: boolean;
};

type StoryMediaAsset = {
  kind: 'image' | 'video';
  src: string;
  poster?: string;
  alt: string;
};

type StoryMediaConfig = {
  tag: string;
  title: string;
  note: string;
  chips: string[];
  main: StoryMediaAsset;
};

const mediaConfigs: Record<StoryVisualKind, StoryMediaConfig> = {
  shield: {
    tag: 'Shield',
    title: 'Тихий защитный слой',
    note: 'Когда фон чистый, результат читается сразу.',
    chips: ['Local', 'Account', 'History'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/privacy-poster.avif',
      alt: 'Тёмный интерфейс с приглушённой подсветкой и спокойной подачей.'
    }
  },
  route: {
    tag: 'Flow',
    title: 'Сигнал идёт по этапам',
    note: 'Быстрый проход остаётся спокойным. Жёсткий включается там, где нужен.',
    chips: ['Fast', 'Deep', 'Decision'],
    main: {
      kind: 'video',
      src: '/neuralv/media/story/route-loop.mp4',
      poster: '/neuralv/media/story/route-poster.avif',
      alt: 'Тёмная технологичная петля для маршрута проверки.'
    }
  },
  platforms: {
    tag: 'Systems',
    title: 'Одна логика, разные оболочки',
    note: 'Android, Windows и Linux выглядят по-разному, но работают как один продукт.',
    chips: ['Android', 'Windows', 'Linux'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/platforms-poster.avif',
      alt: 'Набор разных устройств и экранов в одной тёмной сцене.'
    }
  },
  privacy: {
    tag: 'Focus',
    title: 'Без лишнего шума',
    note: 'Результат должен быть ясным, даже когда проверка сложная.',
    chips: ['Quiet UI', 'Clear actions', 'No noise'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/privacy-poster.avif',
      alt: 'Сдержанная тёмная сцена про приватность и спокойный результат.'
    }
  },
  android: {
    tag: 'Android',
    title: 'Один APK',
    note: 'Ставится быстро и не требует отдельного сценария сопровождения.',
    chips: ['APK', 'Mobile', 'Account'],
    main: {
      kind: 'video',
      src: '/neuralv/media/story/android-loop.mp4',
      poster: '/neuralv/media/story/android.jpg',
      alt: 'Смартфон в тёмной технологичной сцене.'
    }
  },
  windows: {
    tag: 'Windows',
    title: 'Несколько путей установки',
    note: 'Setup, portable и NV остаются частью одной поставки.',
    chips: ['Setup', 'Portable', 'NV'],
    main: {
      kind: 'video',
      src: '/neuralv/media/story/windows-loop.mp4',
      poster: '/neuralv/media/story/windows.jpg',
      alt: 'Рабочее место для Windows-клиента.'
    }
  },
  linux: {
    tag: 'Linux',
    title: 'Чистая установка через NV',
    note: 'Один поддерживаемый маршрут проще поддерживать и проще объяснять.',
    chips: ['NV', 'CLI', 'Updates'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/linux-poster.avif',
      alt: 'Терминал и код в тёмной сцене для Linux.'
    }
  }
};

function renderMedia(asset: StoryMediaAsset) {
  if (asset.kind === 'video') {
    return (
      <video
        className="story-scene-media"
        poster={asset.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      >
        <source src={asset.src} type="video/mp4" />
      </video>
    );
  }

  return <img className="story-scene-media" src={asset.src} alt={asset.alt} loading="lazy" />;
}

export function StoryScene({ title, body, kicker, accent, visual, aside, compact = false }: StorySceneProps) {
  const { ref, style } = useScrollSceneProgress<HTMLElement>();
  const media = mediaConfigs[visual];

  return (
    <section ref={ref} className={`story-scene${compact ? ' story-scene-compact' : ''}`} style={style}>
      <div className="story-scene-sticky">
        <article className={`story-scene-card story-scene-card-${visual}`} data-kind={visual}>
          <div className="story-scene-copy">
            {kicker ? <span className="story-scene-kicker">{kicker}</span> : null}
            <h2>{title}</h2>
            <p>{body}</p>
            {accent ? <div className="story-scene-accent">{accent}</div> : null}
            {aside ? <div className="story-scene-aside">{aside}</div> : null}
          </div>

          <div className={`story-scene-media-shell story-scene-media-shell-${visual}`} aria-hidden="true">
            <div className="story-scene-media-frame">
              {renderMedia(media.main)}
              <span className="story-scene-media-shade" />
              <span className="story-scene-media-grid" />
              <span className="story-scene-media-line story-scene-media-line-a" />
              <span className="story-scene-media-line story-scene-media-line-b" />
              <div className="story-scene-media-overlay">
                <div className="story-scene-media-caption">
                  <span className="story-scene-media-tag">{media.tag}</span>
                  <strong>{media.title}</strong>
                  <span>{media.note}</span>
                </div>
                <div className="story-scene-media-strip">
                  {media.chips.map((chip) => (
                    <span key={chip} className="story-scene-media-chip">{chip}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
