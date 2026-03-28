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
  const [viewportMode, setViewportMode] = useState({ mobile: false, reduced: false });

  useEffect(() => {
    let frame = 0;
    const staticProgress = 0.62;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileQuery = window.matchMedia('(max-width: 760px)');
    const state = { current: 0, target: 0 };

    const animate = () => {
      frame = 0;
      state.current += (state.target - state.current) * 0.16;
      const next = Math.abs(state.current - state.target) < 0.0015 ? state.target : state.current;
      setProgress((current) => (Math.abs(current - next) < 0.001 ? current : next));
      if (Math.abs(next - state.target) >= 0.0015) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const updateTarget = () => {
      const node = ref.current;
      if (!node) {
        return;
      }

      const reduced = reducedMotionQuery.matches;
      const mobile = mobileQuery.matches;
      setViewportMode((current) => (
        current.mobile === mobile && current.reduced === reduced
          ? current
          : { mobile, reduced }
      ));

      if (reduced) {
        state.current = staticProgress;
        state.target = staticProgress;
        setProgress(staticProgress);
        return;
      }

      const rect = node.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const start = viewport * (mobile ? 0.94 : 0.88);
      const end = -rect.height * (mobile ? 0.18 : 0.34);
      state.target = clamp((start - rect.top) / (start - end));
      if (!frame) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const requestUpdate = () => {
      updateTarget();
    };

    const bindMediaListener = (query: MediaQueryList, listener: () => void) => {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', listener);
        return () => query.removeEventListener('change', listener);
      }

      query.addListener(listener);
      return () => query.removeListener(listener);
    };

    requestUpdate();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    const unbindReducedMotion = bindMediaListener(reducedMotionQuery, requestUpdate);
    const unbindMobile = bindMediaListener(mobileQuery, requestUpdate);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      unbindReducedMotion();
      unbindMobile();
    };
  }, []);

  const style = useMemo(() => {
    const { mobile, reduced } = viewportMode;
    const eased = progress * progress * (3 - 2 * progress);
    const enter = clamp((eased - 0.04) / 0.96);
    const rawFocus = 1 - Math.abs(eased - 0.5) * 2;
    const motionScale = reduced ? 0 : mobile ? 0.66 : 1;
    const revealScale = reduced ? 0.82 : mobile ? 0.92 : 1;
    const depthScale = reduced ? 0.24 : mobile ? 0.56 : 0.84;
    const beamScale = reduced ? 0.2 : mobile ? 0.5 : 0.7;
    const focus = reduced ? 0.42 + rawFocus * 0.18 : mobile ? 0.24 + rawFocus * 0.76 : rawFocus;
    const depth = 0.22 + focus * 0.78;
    const drift = reduced ? 0 : (0.5 - eased) * (mobile ? 12 : 20);
    const rise = reduced ? 0 : (1 - enter) * (mobile ? 14 : 24);
    const orbit = reduced ? 0 : rawFocus * (mobile ? 4 : 8);
    const swing = reduced ? 0 : (0.5 - eased) * (mobile ? 2 : 4);
    const pulse = reduced ? 1 : 0.98 + rawFocus * 0.04;
    const tilt = reduced ? 0 : (0.5 - eased) * (mobile ? 1.2 : 2.4);
    const beam = clamp((eased - 0.14) / 0.86) * beamScale;
    const flare = reduced ? 0.24 + rawFocus * 0.16 : mobile ? 0.16 + rawFocus * 0.6 : 0.18 + rawFocus * 0.82;
    const parallax = reduced ? 1 : 1 + rawFocus * 0.02;

    return {
      '--scene-progress': progress,
      '--scene-progress-eased': eased,
      '--scene-enter': enter,
      '--scene-focus': focus,
      '--scene-depth': depth,
      '--scene-drift': drift,
      '--scene-rise': rise,
      '--scene-orbit': orbit,
      '--scene-swing': swing,
      '--scene-pulse': pulse,
      '--scene-tilt': tilt,
      '--scene-beam': beam,
      '--scene-flare': flare,
      '--scene-motion-scale': motionScale,
      '--scene-reveal-scale': revealScale,
      '--scene-depth-scale': depthScale,
      '--scene-parallax': parallax
    } as CSSProperties;
  }, [progress, viewportMode]);

  return { ref, progress, style };
}
