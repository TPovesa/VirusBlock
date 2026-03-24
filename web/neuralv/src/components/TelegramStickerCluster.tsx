import type { CSSProperties } from 'react';

type TelegramStickerTone = 'sky' | 'rose' | 'mint' | 'amber';
type TelegramStickerVariant = 'hero' | 'compact';

type TelegramStickerItem = {
  emoji: string;
  label: string;
  tone?: TelegramStickerTone;
};

type TelegramStickerClusterProps = {
  items: TelegramStickerItem[];
  variant?: TelegramStickerVariant;
  className?: string;
};

const heroPresets = [
  { x: '-18%', y: '10%', rotate: '-8deg', delay: '0s' },
  { x: '62%', y: '2%', rotate: '7deg', delay: '0.4s' },
  { x: '-8%', y: '62%', rotate: '-5deg', delay: '0.8s' },
  { x: '60%', y: '72%', rotate: '9deg', delay: '1.2s' }
] as const;

export function TelegramStickerCluster({
  items,
  variant = 'hero',
  className = ''
}: TelegramStickerClusterProps) {
  if (variant === 'compact') {
    return (
      <div className={`telegram-sticker-cluster telegram-sticker-cluster-compact ${className}`.trim()} aria-hidden="true">
        {items.map((item, index) => (
          <span
            key={`${item.label}-${index}`}
            className={`telegram-sticker telegram-sticker-${item.tone || 'sky'}`}
            style={
              {
                '--sticker-delay': `${index * 0.18}s`,
                '--sticker-rotate': `${index % 2 === 0 ? -4 : 5}deg`
              } as CSSProperties
            }
          >
            <span className="telegram-sticker-emoji">{item.emoji}</span>
            <span className="telegram-sticker-label">{item.label}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={`telegram-sticker-stage ${className}`.trim()} aria-hidden="true">
      <div className="telegram-sticker-core">
        <span className="telegram-sticker-core-dot" />
        <strong>Telegram</strong>
        <span>plugin + module</span>
      </div>
      <div className="telegram-sticker-orbit telegram-sticker-orbit-a" />
      <div className="telegram-sticker-orbit telegram-sticker-orbit-b" />
      {items.slice(0, heroPresets.length).map((item, index) => {
        const preset = heroPresets[index];

        return (
          <span
            key={`${item.label}-${index}`}
            className={`telegram-sticker telegram-sticker-${item.tone || 'sky'} telegram-sticker-floating`}
            style={
              {
                '--sticker-x': preset.x,
                '--sticker-y': preset.y,
                '--sticker-rotate': preset.rotate,
                '--sticker-delay': preset.delay
              } as CSSProperties
            }
          >
            <span className="telegram-sticker-emoji">{item.emoji}</span>
            <span className="telegram-sticker-label">{item.label}</span>
          </span>
        );
      })}
    </div>
  );
}
