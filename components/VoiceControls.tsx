'use client';
import { useLanguage } from './LanguageProvider';

import { useEffect, useId, useRef } from 'react';
import { LoaderCircle, Mic, Pause, Square, X } from 'lucide-react';
import type { BrushCompanionState } from './brush-companion-state';
import './voice-controls.css';

export type VoiceControlState = 'idle' | 'loading' | 'preparing' | 'listening' | 'finishing' | 'drawing' | 'paused';

type Props = {
  state: VoiceControlState;
  catchingUp?: boolean;
  seconds: number;
  disabled: boolean;
  shortcutEnabled?: boolean;
  canCancel: boolean;
  onToggle: () => void;
  onCancel: () => void;
  brushState?: BrushCompanionState;
  motionMode?: 'system' | 'draw' | 'still';
};

const COPY: Record<VoiceControlState, { title: string; label: string; helper: string }> = {
  idle: { title: '开始边说边画', label: '开始边说边画', helper: '你接着说，我一边听一边画。新想法，不用等画完。' },
  loading: { title: '正在准备画纸', label: '正在准备画纸', helper: '马上就可以开始说话' },
  preparing: { title: '正在打开麦克风', label: '正在打开麦克风', helper: '准备好，就能边说边画' },
  listening: { title: '继续说，我会接着画', label: '停止说话，画完已听到的内容', helper: '画还在继续，也可以接着说' },
  finishing: { title: '正在整理刚才的话', label: '正在整理刚才的话', helper: '麦克风已暂停，刚才的话会接着画完' },
  drawing: { title: '正在一笔一笔画', label: '正在一笔一笔画', helper: '正在画完刚才的话' },
  paused: { title: '画笔暂时停了一下', label: '等待处理刚才听到的内容', helper: '文字已经保留，可以重试或取消' },
};

export default function VoiceControls({ state, catchingUp = false, seconds, disabled, shortcutEnabled = true, canCancel, onToggle, onCancel, brushState = 'resting', motionMode = 'system' }: Props) {
 const {t}=useLanguage();
  const descriptionId = useId();
  const microphoneButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!shortcutEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const button = microphoneButton.current;
      const target = event.target;
      if (target instanceof Element && !button?.contains(target) && (
        target.closest('input,textarea,select,button,a[href],[role="textbox"],[role="button"],[role="slider"],[role="checkbox"],[role="switch"],[role="combobox"],[role="menuitem"],[role="tab"],[role="dialog"]') ||
        (target instanceof HTMLElement && target.isContentEditable)
      )) return;
      // Own Space on the microphone too, so its native key-up click cannot toggle twice.
      event.preventDefault();
      if (!event.repeat && button && !button.disabled) button.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcutEnabled]);
  const parallel = brushState === 'thinking-drawing';
  const waiting = (brushState === 'preparing' || parallel) && ['listening', 'drawing', 'finishing'].includes(state);
  const copy = catchingUp && state === 'listening'
    ? { title: '正在跟上你的话…', label: COPY[state].label, helper: '声音暂存在电脑上，会接着画' }
    : waiting && parallel
    ? { title: '一边画，一边想下一笔', label: COPY[state].label, helper: state === 'listening' ? '新想法正在安排，继续说就好' : '小画家还在画，下一笔也在准备' }
    : waiting
    ? { title: '想一想，马上落笔', label: COPY[state].label, helper: state === 'listening' ? '麦克风还开着，可以接着说' : '想法收到了，正在安排这一笔' }
    : COPY[state];
  const listening = state === 'listening';
  const processing = state === 'loading' || state === 'preparing' || state === 'finishing' || state === 'drawing';
  const elapsed = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const timer = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return <section className={`voice-controls voice-controls--${state}`} data-motion={motionMode} data-allow-motion={motionMode === 'draw' || undefined} data-waiting={waiting || undefined} aria-label={t("说话画画")}>
    <button
      ref={microphoneButton}
      type="button"
      className="voice-controls__main"
      onClick={onToggle}
      disabled={disabled}
      aria-label={t(copy.label)}
      title={`${t(listening ? '全部说完后，再点这里停止' : copy.title)} (Space)`}
      aria-keyshortcuts={shortcutEnabled ? 'Space' : undefined}
      aria-describedby={descriptionId}
      aria-pressed={listening}
    >
      <span className="voice-controls__circle" aria-hidden="true">
        {waiting && <span className="voice-controls__thinking-orbit" />}
        {listening ? <Square className="voice-controls__stop" size={25} fill="currentColor" strokeWidth={0} />
          : processing ? <LoaderCircle className="voice-controls__spinner" size={31} strokeWidth={1.8} />
            : state === 'paused' ? <Pause size={29} strokeWidth={1.8} />
              : <Mic size={32} strokeWidth={1.8} />}
      </span>
      <span className="voice-controls__title" aria-live="polite" aria-atomic="true">{t(copy.title)}</span>
    </button>
    <p className="voice-controls__helper" id={descriptionId}>
      {listening && <><span className="voice-controls__timer">{timer}</span><span aria-hidden="true"> · </span></>}{t(copy.helper)}
    </p>
    {canCancel && <button type="button" className="voice-controls__cancel" onClick={onCancel} aria-label={t("立即取消录音和待画内容")}>
      <X size={13} aria-hidden="true" /><span>{t("取消")}</span>
    </button>}
  </section>;
}
