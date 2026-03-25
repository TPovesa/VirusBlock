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

const mediaConfigs: Record<StoryVisualKind, StoryMediaAsset> = {
  shield: {
    kind: 'image',
    src: '/neuralv/media/story/hero.jpg',
    alt: 'Рабочее место разработчика в тёмной палитре.'
  },
  route: {
    kind: 'video',
    src: '/neuralv/media/story/route-loop.mp4',
    poster: '/neuralv/media/story/route-poster.avif',
    alt: 'Тёмная анимированная сцена с маршрутом проверки.'
  },
  platforms: {
    kind: 'image',
    src: '/neuralv/media/story/windows.jpg',
    alt: 'Рабочее место с несколькими экранами и кодом.'
  },
  privacy: {
    kind: 'image',
    src: '/neuralv/media/story/linux.jpg',
    alt: 'Тёмная сцена с терминалом и кодом.'
  },
  android: {
    kind: 'video',
    src: '/neuralv/media/story/android-loop.mp4',
    poster: '/neuralv/media/story/android.jpg',
    alt: 'Android-сцена в тёмной палитре.'
  },
  windows: {
    kind: 'video',
    src: '/neuralv/media/story/windows-loop.mp4',
    poster: '/neuralv/media/story/windows.jpg',
    alt: 'Windows-сцена в тёмной палитре.'
  },
  linux: {
    kind: 'image',
    src: '/neuralv/media/story/linux-poster.avif',
    alt: 'Linux-сцена с тёмным фоном.'
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
            {renderMedia(media)}
            <span className="story-scene-media-shade" />
          </div>
        </div>
      </article>
    </section>
  );
}
