import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type CenteredHeroAction = {
  label: string;
  to?: string;
  href?: string;
  onClick?: () => void;
  external?: boolean;
  download?: boolean;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
};

type CenteredHeroMedia = {
  kind?: 'image' | 'video';
  src: string;
  alt: string;
  poster?: string;
};

type CenteredHeroMeta = {
  label: string;
  value: string;
};

type CenteredHeroSectionProps = {
  title: string;
  body?: string;
  actions?: CenteredHeroAction[];
  media: CenteredHeroMedia;
  meta?: CenteredHeroMeta[];
  mediaSide?: 'left' | 'right';
  className?: string;
  children?: ReactNode;
};

function renderAction(action: CenteredHeroAction, index: number) {
  const className = action.variant === 'secondary' ? 'shell-chip' : 'nv-button';
  if (action.disabled) {
    return (
      <button key={`${action.label}-${index}`} className={`${className} is-disabled`.trim()} type="button" disabled>
        {action.label}
      </button>
    );
  }
  if (action.to) {
    return (
      <Link key={`${action.label}-${index}`} className={className} to={action.to} onClick={action.onClick}>
        {action.label}
      </Link>
    );
  }

  if (action.href) {
    return (
      <a
        key={`${action.label}-${index}`}
        className={className}
        href={action.href}
        onClick={action.onClick}
        target={action.external ? '_blank' : undefined}
        rel={action.external ? 'noreferrer' : undefined}
        download={action.download}
      >
        {action.label}
      </a>
    );
  }

  return (
    <button key={`${action.label}-${index}`} className={className} type="button" onClick={action.onClick}>
      {action.label}
    </button>
  );
}

function renderMedia(media: CenteredHeroMedia) {
  if (media.kind === 'video') {
    return (
      <video
        className="platform-hero-media"
        poster={media.poster}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      >
        <source src={media.src} type="video/mp4" />
      </video>
    );
  }

  return <img className="platform-hero-media" src={media.src} alt={media.alt} loading="lazy" />;
}

export function CenteredHeroSection({
  title,
  body,
  actions = [],
  media,
  meta = [],
  mediaSide = 'right',
  className = '',
  children
}: CenteredHeroSectionProps) {
  return (
    <section className={`platform-hero ${className}`.trim()}>
      <div className="platform-hero-center">
        <div className="platform-hero-spacer" aria-hidden="true" />

        <article
          className={`platform-hero-card platform-hero-card-centered platform-hero-card-rich${
            mediaSide === 'left' ? ' is-media-left' : ''
          }`}
        >
          <div className="platform-hero-rich-grid">
            <div className="platform-hero-copy platform-hero-copy-rich">
              <h1>{title}</h1>
              {body ? <p>{body}</p> : null}
              {actions.length > 0 ? (
                <div className="platform-hero-actions">
                  {actions.map((action, index) => renderAction(action, index))}
                </div>
              ) : null}
              {meta.length > 0 ? (
                <div className="platform-hero-meta-list">
                  {meta.map((item) => (
                    <div key={`${item.label}-${item.value}`} className="platform-hero-meta-card">
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {children}
            </div>

            <div className="platform-hero-media-shell" aria-hidden="true">
              <div className="platform-hero-media-frame">
                {renderMedia(media)}
              </div>
            </div>
          </div>
        </article>

        <div className="story-scroll-cue" aria-hidden="true">
          <div className="story-scroll-arrow" />
        </div>
      </div>
    </section>
  );
}
