import type { ReactNode } from 'react';
import { useScrollSceneProgress } from '../hooks/useScrollSceneProgress';

type StoryVisualKind = 'shield' | 'route' | 'platforms' | 'privacy' | 'android' | 'windows' | 'linux' | 'telegram';

type StorySceneProps = {
  title: string;
  body: string;
  kicker?: string;
  accent?: string;
  visual: StoryVisualKind;
  aside?: ReactNode;
  compact?: boolean;
  chips?: string[];
  mediaAlign?: 'left' | 'right';
};

type StoryMediaAsset = {
  kind: 'image' | 'video';
  src: string;
  poster?: string;
  alt: string;
};

const mediaConfigs: Record<StoryVisualKind, StoryMediaAsset> = {
  shield: {
    kind: 'image',
    src: '/media/story/hero.jpg',
    alt: 'Рабочее место разработчика в тёмной палитре.'
  },
  route: {
    kind: 'video',
    src: '/media/story/route-loop.mp4',
    poster: '/media/story/route-poster.avif',
    alt: 'Тёмная анимированная сцена с маршрутом проверки.'
  },
  platforms: {
    kind: 'image',
    src: '/media/story/windows.jpg',
    alt: 'Рабочее место с несколькими экранами и кодом.'
  },
  privacy: {
    kind: 'image',
    src: '/media/story/linux.jpg',
    alt: 'Тёмная сцена с терминалом и кодом.'
  },
  android: {
    kind: 'video',
    src: '/media/story/android-loop.mp4',
    poster: '/media/story/android.jpg',
    alt: 'Android-сцена в тёмной палитре.'
  },
  windows: {
    kind: 'video',
    src: '/media/story/windows-loop.mp4',
    poster: '/media/story/windows.jpg',
    alt: 'Windows-сцена в тёмной палитре.'
  },
  linux: {
    kind: 'image',
    src: '/media/story/linux-poster.avif',
    alt: 'Linux-сцена с тёмным фоном.'
  },
  telegram: {
    kind: 'image',
    src: '/media/story/telegram.jpg',
    alt: 'Telegram-сцена в тёмной палитре.'
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

export function StoryScene({
  title,
  body,
  kicker,
  accent,
  visual,
  aside,
  compact = false,
  chips = [],
  mediaAlign = 'right'
}: StorySceneProps) {
  const { ref, style } = useScrollSceneProgress<HTMLElement>();
  const media = mediaConfigs[visual];

  return (
    <section ref={ref} className={`story-scene${compact ? ' story-scene-compact' : ''}`} style={style}>
      <article className={`story-scene-card story-scene-card-${visual}${mediaAlign === 'left' ? ' is-media-left' : ''}`} data-kind={visual}>
        <div className="story-scene-copy">
          {kicker ? <span className="story-scene-kicker">{kicker}</span> : null}
          <h2>{title}</h2>
          <p>{body}</p>
          {accent ? <div className="story-scene-accent">{accent}</div> : null}
          {chips.length > 0 ? (
            <div className="story-scene-media-strip">
              {chips.map((chip) => (
                <span key={chip} className="story-scene-media-chip">{chip}</span>
              ))}
            </div>
          ) : null}
          {aside ? <div className="story-scene-aside">{aside}</div> : null}
        </div>

        <div className={`story-scene-media-shell story-scene-media-shell-${visual}`} aria-hidden="true">
          <div className="story-scene-media-frame">
            {renderMedia(media)}
          </div>
        </div>
      </article>
    </section>
  );
}
