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
  label: string;
  tags: string[];
  main: StoryMediaAsset;
  inset?: StoryMediaAsset;
};

const storyMedia: Record<StoryVisualKind, StoryMediaConfig> = {
  shield: {
    label: 'Спокойный интерфейс',
    tags: ['тихий режим', 'ясный итог'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/privacy-poster.avif',
      alt: 'Тёмный интерфейс с приглушённой подсветкой и безопасной подачей.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/account.jpg',
      alt: 'Тёмное рабочее место с экраном профиля.'
    }
  },
  route: {
    label: 'Путь проверки',
    tags: ['быстрый проход', 'глубокий разбор'],
    main: {
      kind: 'video',
      src: '/neuralv/media/story/route-loop.mp4',
      poster: '/neuralv/media/story/route-poster.avif',
      alt: 'Петля с тёмной технологичной сценой для шага маршрута проверки.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/privacy-poster.avif',
      alt: 'Контрольная сцена интерфейса для маршрута проверки.'
    }
  },
  platforms: {
    label: 'Разные системы',
    tags: ['android', 'windows', 'linux'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/platforms-poster.avif',
      alt: 'Набор разных устройств и экранов в одной тёмной сцене.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/hero.jpg',
      alt: 'Общий тёмный технологичный сетап.'
    }
  },
  privacy: {
    label: 'Подача без шума',
    tags: ['спокойно', 'по делу'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/privacy-poster.avif',
      alt: 'Сдержанная тёмная сцена про приватность и спокойный результат.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/route-poster.avif',
      alt: 'Дополнительная тёмная визуальная карточка.'
    }
  },
  android: {
    label: 'Android',
    tags: ['один APK', 'быстрый старт'],
    main: {
      kind: 'video',
      src: '/neuralv/media/story/android-loop.mp4',
      poster: '/neuralv/media/story/android.jpg',
      alt: 'Петля со смартфоном в тёмной технологичной сцене.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/platforms-poster.avif',
      alt: 'Тёмная карточка с устройствами для Android.'
    }
  },
  windows: {
    label: 'Windows',
    tags: ['setup', 'portable', 'nv'],
    main: {
      kind: 'video',
      src: '/neuralv/media/story/windows-loop.mp4',
      poster: '/neuralv/media/story/windows.jpg',
      alt: 'Петля с рабочим местом для Windows-клиента.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/route-poster.avif',
      alt: 'Дополнительная тёмная карточка для Windows.'
    }
  },
  linux: {
    label: 'Linux',
    tags: ['nv', 'обновление', 'терминал'],
    main: {
      kind: 'image',
      src: '/neuralv/media/story/linux-poster.avif',
      alt: 'Терминал и код в тёмной сцене для Linux.'
    },
    inset: {
      kind: 'image',
      src: '/neuralv/media/story/platforms-poster.avif',
      alt: 'Технологичная карточка для Linux-сцены.'
    }
  }
};

function renderMedia(asset: StoryMediaAsset, className: string) {
  if (asset.kind === 'video') {
    return (
      <video
        className={className}
        poster={asset.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={asset.alt}
      >
        <source src={asset.src} type="video/mp4" />
      </video>
    );
  }

  return <img className={className} src={asset.src} alt={asset.alt} loading="lazy" />;
}

export function StoryScene({ title, body, kicker, accent, visual, aside, compact = false }: StorySceneProps) {
  const { ref, style } = useScrollSceneProgress<HTMLElement>();
  const media = storyMedia[visual];

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

          <div className="story-scene-visual-wrap" aria-hidden="true">
            <div className="story-scene-media-shell">
              <div className="story-scene-media-label">
                <span>{media.label}</span>
              </div>
              <div className="story-scene-media-main">
                {renderMedia(media.main, 'story-scene-media-asset')}
              </div>
              <span className="story-scene-media-overlay" />
              {media.inset ? (
                <div className="story-scene-media-inset">
                  <div className="story-scene-media-inset-asset">
                    {renderMedia(media.inset, 'story-scene-media-inset-media')}
                  </div>
                  <span className="story-scene-media-inset-overlay" />
                </div>
              ) : null}
              <div className="story-scene-media-tags">
                {media.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
