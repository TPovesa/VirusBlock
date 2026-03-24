import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';

function clamp(value: number) {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function useScrollSceneProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const update = () => {
      frame = 0;
      const node = ref.current;
      if (!node) {
        return;
      }

      if (reducedMotion) {
        setProgress(1);
        return;
      }

      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const total = rect.height + viewport;
      const next = clamp((viewport - rect.top) / total);
      setProgress((current) => (Math.abs(current - next) < 0.002 ? current : next));
    };

    const requestUpdate = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(update);
    };

    requestUpdate();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
    };
  }, []);

  const style = useMemo(() => {
    const eased = progress * progress * (3 - 2 * progress);
    const depth = 1 - Math.abs(eased - 0.5) * 2;
    const pulse = Math.sin(eased * Math.PI);
    return {
      '--scene-progress': progress,
      '--scene-progress-eased': eased,
      '--scene-depth': depth,
      '--scene-pulse': pulse
    } as CSSProperties;
  }, [progress]);

  return { ref, progress, style };
}
