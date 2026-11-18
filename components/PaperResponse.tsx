'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { ArtStyle } from '@/lib/scene';
import { BRUSH_LEVEL_FRESH_MS, brushVoiceAmount, type BrushCompanionState } from './brush-companion-state';
import './paper-response.css';

export type PaperResponseHandle = { setLevel: (level: number) => void; reset: () => void };

type Props = {
  ref?: Ref<PaperResponseHandle>;
  medium: ArtStyle;
  state: BrushCompanionState;
  reducedMotion: boolean;
};

/** A response at the paper's edges; the artwork and its input coordinates never move. */
export default function PaperResponse({ ref, medium, state, reducedMotion }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const current = useRef({ state, reducedMotion });
  current.current = { state, reducedMotion };
  const frame = useRef<number | null>(null);
  const voice = useRef({ amount: 0, target: 0, receivedAt: 0, lastFrame: 0 });

  function reset() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    voice.current = { amount: 0, target: 0, receivedAt: 0, lastFrame: 0 };
    element.current?.style.setProperty('--paper-voice', '0');
  }

  function followVoice(now: number) {
    frame.current = null;
    if (!element.current || current.current.state !== 'listening' || current.current.reducedMotion) {
      reset();
      return;
    }
    const sample = voice.current;
    const target = now - sample.receivedAt <= BRUSH_LEVEL_FRESH_MS ? sample.target : 0;
    const elapsed = sample.lastFrame ? Math.min(64, now - sample.lastFrame) : 16;
    // A soft attack and slower release avoid sharp flashes on individual syllables.
    const response = 1 - Math.exp(-elapsed / (target > sample.amount ? 65 : 150));
    sample.amount += (target - sample.amount) * response;
    sample.lastFrame = now;
    if (target === 0 && sample.amount < .002) {
      reset();
      return;
    }
    element.current.style.setProperty('--paper-voice', sample.amount.toFixed(3));
    frame.current = requestAnimationFrame(followVoice);
  }

  useImperativeHandle(ref, () => ({
    reset,
    setLevel(level) {
      if (current.current.state !== 'listening' || current.current.reducedMotion) {
        reset();
        return;
      }
      voice.current.target = brushVoiceAmount(level);
      voice.current.receivedAt = performance.now();
      if (frame.current === null && (voice.current.target > 0 || voice.current.amount > 0)) {
        voice.current.lastFrame = 0;
        frame.current = requestAnimationFrame(followVoice);
      }
    },
  }), []);

  useEffect(() => { reset(); return reset; }, [state, reducedMotion]);

  return <div ref={element} className={`paper-response paper-response--${medium}`} data-state={state} data-still={reducedMotion || undefined} data-allow-motion={!reducedMotion || undefined} aria-hidden="true">
    <div className="paper-response__rim" />
    <svg className="paper-response__trail" viewBox="0 0 1000 640" preserveAspectRatio="none">
      <rect x="3" y="3" width="994" height="634" rx="7" pathLength="100" vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="paper-response__bloom paper-response__bloom--warm" />
    <div className="paper-response__bloom paper-response__bloom--cool" />
  </div>;
}
