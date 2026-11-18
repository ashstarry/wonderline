'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { ArtStyle } from '@/lib/scene';
import { BRUSH_LEVEL_FRESH_MS, brushVoiceAmount, type BrushCompanionState } from './brush-companion-state';
import './brush-companion.css';

export type BrushCompanionHandle = { setLevel: (level: number) => void; reset: () => void };

type Props = {
  ref?: Ref<BrushCompanionHandle>;
  medium: ArtStyle;
  state: BrushCompanionState;
  reducedMotion: boolean;
};

/** Waiting feedback lives next to the microphone, outside the actual drawing SVG. */
export default function BrushCompanion({ ref, medium, state, reducedMotion }: Props) {
  const element = useRef<HTMLSpanElement>(null);
  const current = useRef({ state, reducedMotion });
  current.current = { state, reducedMotion };
  const staleLevel = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    if (staleLevel.current) clearTimeout(staleLevel.current);
    staleLevel.current = null;
    element.current?.style.setProperty('--brush-voice-lift', '0px');
    element.current?.style.setProperty('--brush-voice-turn', '0deg');
    element.current?.removeAttribute('data-hearing');
  };

  useImperativeHandle(ref, () => ({
    reset,
    setLevel(level) {
      const node = element.current;
      if (!node || current.current.state !== 'listening' || current.current.reducedMotion) { reset(); return; }
      if (staleLevel.current) clearTimeout(staleLevel.current);
      const amount = brushVoiceAmount(level);
      node.style.setProperty('--brush-voice-lift', `${(-amount * 5).toFixed(2)}px`);
      node.style.setProperty('--brush-voice-turn', `${(amount * 12).toFixed(2)}deg`);
      if (amount > 0) node.setAttribute('data-hearing', 'true'); else node.removeAttribute('data-hearing');
      staleLevel.current = amount > 0 ? setTimeout(reset, BRUSH_LEVEL_FRESH_MS) : null;
    },
  }), []);

  useEffect(() => { reset(); return reset; }, [state, reducedMotion]);

  return <span ref={element} className={`brush-companion brush-companion--${medium}`} data-state={state} data-still={reducedMotion || undefined} aria-hidden="true">
    <svg className="brush-companion__shadow" viewBox="0 0 72 76"><ellipse cx="36" cy="65" rx="16" ry="3" fill="#96876c" opacity=".12"/></svg>
    <svg className="brush-companion__tool" viewBox="0 0 72 76" fill="none">
      <g stroke="#6f6a54" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
        {medium === 'crayon' ? <>
          <path d="M28 20 35 10 42 20V56Q35 60 28 56Z" fill="#cb8a62"/>
          <path d="M28 24Q35 26 42 24V49Q35 51 28 49Z" fill="#edc995"/>
          <path d="m30 21 5-7 5 7M28 30Q35 32 42 30M28 44Q35 46 42 44" stroke="#bd936f"/>
          <path d="M31 26V47" stroke="#fff8df" opacity=".7"/>
        </> : medium === 'pencil' ? <>
          <path d="M30 18 35 8 40 18V56Q35 59 30 56Z" fill="#eccb7a"/>
          <path d="m30 18 5-10 5 10Z" fill="#efddba"/>
          <path d="m33 12 2-4 2 4" fill="#627f62" stroke="#627f62"/>
          <path d="M30 20V50M35 20V50" stroke="#b7a064"/>
          <path d="M30 50H40V56Q35 59 30 56Z" fill="#d9a0a1"/>
        </> : <>
          <path d="M32 33Q29 24 35 9 44 20 39 33Z" fill="#6b917b"/>
          <path d="M35 13Q34 25 32 30" stroke="#b4c9a3"/>
          <path d="M32 32H39L38 41H33Z" fill="#d8ccb2"/>
          <path d="M33 40H38L37 60Q35 64 33 60Z" fill="#cb9875"/>
        </>}
        <g className="brush-companion__face" stroke="#655e4d">
          <path d={medium === 'watercolor' ? 'M34 46v1M37 46v1' : 'M32 35v1M38 35v1'} strokeWidth="1.7"/>
          <path d={medium === 'watercolor' ? 'M34 50q1.5 1.5 3 0' : 'M33 40q2 2 4 0'} strokeWidth="1.1"/>
        </g>
      </g>
    </svg>
    {medium === 'watercolor' && <svg className="brush-companion__paint" viewBox="0 0 72 76"><path d="M47 62q6-5 11 0-4 5-11 0" fill="#aac8af" opacity=".55"/></svg>}
  </span>;
}
