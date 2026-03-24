import { ReactNode } from 'react';
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

function StoryVisual({ kind }: { kind: StoryVisualKind }) {
  const className = `story-visual-svg story-visual-svg-${kind}`;

  switch (kind) {
    case 'route':
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <rect x="22" y="26" width="316" height="188" rx="30" className="story-panel-outline story-panel-strong" />
            <rect x="44" y="48" width="84" height="30" rx="15" className="story-chip-fill story-highlight-pill" />
            <rect x="232" y="52" width="76" height="20" rx="10" className="story-chip-fill story-chip-fill-faint" />
            <rect x="204" y="148" width="106" height="34" rx="17" className="story-panel-fill story-plate" />
          </g>
          <g className="story-layer story-layer-mid">
            <path d="M60 162 C100 162 114 84 164 84 C216 84 226 174 286 174" className="story-route-line" />
            <path d="M60 162 C100 162 114 84 164 84 C216 84 226 174 286 174" className="story-route-glow" />
            <path d="M82 108 H134" className="story-grid-link story-grid-link-soft" />
            <path d="M214 108 H280" className="story-grid-link story-grid-link-soft" />
          </g>
          <g className="story-layer story-layer-top">
            <circle cx="60" cy="162" r="16" className="story-node story-node-soft" />
            <circle cx="164" cy="84" r="16" className="story-node story-node-accent" />
            <circle cx="286" cy="174" r="16" className="story-node story-node-soft" />
            <circle cx="164" cy="84" r="28" className="story-beacon-ring" />
            <rect x="142" y="116" width="92" height="12" rx="6" className="story-sweep-bar" />
          </g>
        </svg>
      );
    case 'platforms':
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <rect x="26" y="34" width="102" height="74" rx="24" className="story-panel-outline" />
            <rect x="146" y="34" width="188" height="74" rx="24" className="story-panel-outline story-panel-outline-accent" />
            <rect x="78" y="132" width="204" height="84" rx="28" className="story-panel-outline" />
          </g>
          <g className="story-layer story-layer-mid">
            <path d="M128 70 H146" className="story-grid-link" />
            <path d="M214 108 V132" className="story-grid-link" />
            <rect x="48" y="56" width="56" height="16" rx="8" className="story-chip-fill story-chip-fill-faint" />
            <rect x="170" y="54" width="86" height="18" rx="9" className="story-chip-fill" />
            <rect x="102" y="156" width="132" height="22" rx="11" className="story-panel-fill story-plate" />
          </g>
          <g className="story-layer story-layer-top">
            <circle cx="128" cy="70" r="10" className="story-node story-node-soft" />
            <circle cx="146" cy="70" r="10" className="story-node story-node-soft" />
            <circle cx="214" cy="132" r="12" className="story-node story-node-accent" />
            <circle cx="214" cy="132" r="30" className="story-beacon-ring" />
            <path d="M122 188 H246" className="story-highlight-trace" />
          </g>
        </svg>
      );
    case 'privacy':
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <rect x="36" y="38" width="288" height="164" rx="34" className="story-panel-outline story-panel-strong" />
            <path d="M88 84 H118" className="story-grid-link" />
            <path d="M242 84 H272" className="story-grid-link" />
            <path d="M118 160 H242" className="story-grid-link story-grid-link-soft" />
          </g>
          <g className="story-layer story-layer-mid">
            <path d="M180 62 L236 86 V124 C236 156 213 181 180 194 C147 181 124 156 124 124 V86 Z" className="story-shield" />
            <path d="M154 118 L172 138 L208 102" className="story-check-line" />
            <path d="M96 194 C128 168 144 156 180 156 C216 156 232 168 264 194" className="story-radar" />
          </g>
          <g className="story-layer story-layer-top">
            <circle cx="180" cy="124" r="22" className="story-node story-node-accent" />
            <circle cx="180" cy="124" r="38" className="story-beacon-ring" />
            <rect x="144" y="176" width="72" height="10" rx="5" className="story-sweep-bar" />
          </g>
        </svg>
      );
    case 'android':
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <rect x="112" y="20" width="136" height="200" rx="38" className="story-panel-outline story-panel-outline-accent" />
            <rect x="136" y="48" width="88" height="8" rx="4" className="story-chip-fill story-chip-fill-faint" />
          </g>
          <g className="story-layer story-layer-mid">
            <rect x="132" y="70" width="96" height="92" rx="26" className="story-panel-fill story-plate" />
            <path d="M144 98 H216" className="story-grid-link" />
            <path d="M144 124 H204" className="story-grid-link story-grid-link-soft" />
            <path d="M144 150 H188" className="story-grid-link story-grid-link-soft" />
          </g>
          <g className="story-layer story-layer-top">
            <rect x="136" y="180" width="88" height="18" rx="9" className="story-chip-fill" />
            <rect x="142" y="84" width="76" height="16" rx="8" className="story-sweep-bar" />
            <circle cx="180" cy="116" r="32" className="story-beacon-ring" />
          </g>
        </svg>
      );
    case 'windows':
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <rect x="30" y="38" width="300" height="170" rx="30" className="story-panel-outline story-panel-strong" />
            <rect x="56" y="64" width="76" height="118" rx="22" className="story-panel-fill story-plate" />
            <rect x="286" y="70" width="18" height="104" rx="9" className="story-chip-fill story-chip-fill-faint" />
          </g>
          <g className="story-layer story-layer-mid">
            <path d="M92 88 H272" className="story-grid-link" />
            <path d="M92 122 H232" className="story-grid-link story-grid-link-soft" />
            <path d="M92 156 H248" className="story-grid-link story-grid-link-soft" />
            <rect x="160" y="76" width="96" height="14" rx="7" className="story-chip-fill" />
          </g>
          <g className="story-layer story-layer-top">
            <rect x="156" y="140" width="108" height="14" rx="7" className="story-sweep-bar" />
            <circle cx="276" cy="170" r="12" className="story-node story-node-accent" />
            <circle cx="276" cy="170" r="28" className="story-beacon-ring" />
          </g>
        </svg>
      );
    case 'linux':
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <rect x="38" y="48" width="284" height="146" rx="32" className="story-panel-outline story-panel-strong" />
            <rect x="62" y="72" width="76" height="98" rx="22" className="story-panel-fill story-plate" />
          </g>
          <g className="story-layer story-layer-mid">
            <path d="M84 96 H276" className="story-grid-link" />
            <path d="M84 128 H220" className="story-grid-link story-grid-link-soft" />
            <path d="M84 160 H250" className="story-grid-link story-grid-link-soft" />
            <path d="M168 86 H286" className="story-route-line" />
          </g>
          <g className="story-layer story-layer-top">
            <rect x="170" y="150" width="84" height="14" rx="7" className="story-sweep-bar" />
            <circle cx="274" cy="160" r="14" className="story-node story-node-accent" />
            <circle cx="274" cy="160" r="32" className="story-beacon-ring" />
          </g>
        </svg>
      );
    case 'shield':
    default:
      return (
        <svg viewBox="0 0 360 240" className={className} fill="none" aria-hidden="true">
          <g className="story-layer story-layer-base">
            <circle cx="180" cy="120" r="78" className="story-ring story-ring-outer" />
            <circle cx="180" cy="120" r="56" className="story-ring story-ring-inner" />
            <path d="M108 120 H148 L164 92 L184 148 L202 110 H252" className="story-route-line" />
          </g>
          <g className="story-layer story-layer-mid">
            <path d="M180 52 L236 74 V118 C236 155 214 180 180 196 C146 180 124 155 124 118 V74 Z" className="story-shield" />
            <path d="M156 118 L172 136 L208 100" className="story-check-line" />
            <path d="M132 188 C150 170 164 162 180 162 C196 162 210 170 228 188" className="story-radar" />
          </g>
          <g className="story-layer story-layer-top">
            <circle cx="180" cy="120" r="22" className="story-node story-node-accent" />
            <circle cx="180" cy="120" r="42" className="story-beacon-ring" />
            <rect x="140" y="82" width="80" height="14" rx="7" className="story-sweep-bar" />
          </g>
        </svg>
      );
  }
}

export function StoryScene({ title, body, kicker, accent, visual, aside, compact = false }: StorySceneProps) {
  const { ref, style } = useScrollSceneProgress<HTMLElement>();

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
          <div className="story-scene-visual-wrap">
            <StoryVisual kind={visual} />
          </div>
        </article>
      </div>
    </section>
  );
}
