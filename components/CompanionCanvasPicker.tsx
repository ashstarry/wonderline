'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Heart, X } from 'lucide-react';
import { COMPANION_NAME_LIMIT } from '../lib/story-companions';
import type { PaperViewport } from '../lib/paper-viewport';
import type { Scene } from '../lib/scene';
import './companion-canvas-picker.css';

export type CompanionPickCandidate = {
  id: string;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  scene?: Scene;
};
export type CompanionCanvasPickerProps = {
  active: boolean;
  selectionFirst?: boolean;
  language: 'en' | 'zh';
  candidates: CompanionPickCandidate[];
  viewport: PaperViewport;
  initialObjectId?: string | null;
  disabled: boolean;
  onCancel: () => void;
  onSave: (id: string, name: string) => Promise<boolean>;
  error?: string;
};

const words = {
  en: { pick: 'Tap a character to keep as a companion', empty: 'Draw a character first, then give them a name.', cancel: 'Cancel', choose: 'Choose another', close: 'Back to the picture', title: 'What’s their name?', hint: 'Give your friend a name. Bring them into your next story.', label: 'Their name', placeholder: 'A name for your friend', save: 'Save companion', saving: 'Saving your companion…', failed: 'That didn’t save. Please try again.', select: 'Keep as a companion', busy: 'Finishing this part of the picture…' },
  zh: { pick: '点一下画里的角色，把它留下作伙伴', empty: '先画出一位角色，再给它起名字吧。', cancel: '取消', choose: '重新选一个', close: '返回画面', title: '它叫什么名字？', hint: '给朋友起个名字，下一个故事还能一起出发。', label: '伙伴的名字', placeholder: '给伙伴起个名字', save: '保存伙伴', saving: '正在保存伙伴…', failed: '刚才没能保存，请再试一次。', select: '留下作伙伴', busy: '正在画完这一部分…' },
} as const;

/** Clip only the interaction area. The original scene geometry is never changed. */
export function companionPickRect(bounds: CompanionPickCandidate['bounds'], viewport: PaperViewport) {
  if (![bounds.x, bounds.y, bounds.width, bounds.height, viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
  const x = Math.max(bounds.x, viewport.x), y = Math.max(bounds.y, viewport.y);
  const right = Math.min(bounds.x + bounds.width, viewport.x + viewport.width), bottom = Math.min(bounds.y + bounds.height, viewport.y + viewport.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y, left: (x - viewport.x) / viewport.width * 100, top: (y - viewport.y) / viewport.height * 100, widthPercent: (right - x) / viewport.width * 100, heightPercent: (bottom - y) / viewport.height * 100 };
}

export default function CompanionCanvasPicker({ selectionFirst=false, active, language, candidates, viewport, initialObjectId, disabled, onCancel, onSave, error }: CompanionCanvasPickerProps) {
  const text = words[language], titleId = useId(), hintId = useId(), nameId = useId(), pickId = useId();
  const [chosenId, setChosenId] = useState<string | null>(() => active && candidates.some(item => item.id === initialObjectId) ? initialObjectId! : null);
  const [name, setName] = useState(''), [saving, setSaving] = useState(false), [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const latest = useRef({ active, candidates, onCancel, onSave, disabled });
  const generation = useRef(0), inFlight = useRef(false);
  const returnFocusId = useRef<string | null>(null);
  latest.current = { active, candidates, onCancel, onSave, disabled };
  const choices = candidates.flatMap(candidate => { const rect = companionPickRect(candidate.bounds, viewport); return rect ? [{ candidate, rect }] : []; });
  const chosen = choices.find(item => item.candidate.id === chosenId)?.candidate;

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setSaving(false); setFailed(false); setName('');
    if (!active) { setChosenId(null); return; }
    const previousFocus = document.activeElement as HTMLElement | null;
    const initial = latest.current.candidates.some(item => item.id === initialObjectId && companionPickRect(item.bounds,viewport)) ? initialObjectId ?? null : null;
    if(selectionFirst&&!initial){latest.current.onCancel();return;}
    setChosenId(initial);
    if (!initial) container.current?.focus();
    return () => { generation.current += 1; if (previousFocus?.isConnected) previousFocus.focus(); };
    // Opening takes a snapshot of the existing selection. Subsequent scene updates
    // must not replace the character the child picked or reset the typed name.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    const node = dialog.current;
    if (!active || !chosen) {
      node?.close();
      if(active && selectionFirst && chosenId !== null){latest.current.onCancel();return;}
      if (active && chosenId !== null) { setChosenId(null); setName(''); setFailed(false); }
      if (active) {
        const previousTarget = Array.from(container.current?.querySelectorAll<HTMLButtonElement>('[data-companion-choice]') ?? []).find(button => button.dataset.companionChoice === returnFocusId.current && !button.disabled);
        (previousTarget ?? container.current)?.focus();
        returnFocusId.current = null;
      }
      return;
    }
    if (node && !node.open) { node.showModal(); input.current?.focus(); }
    return () => node?.close();
  }, [active, chosen?.id, chosenId]);

  const backToPicture = () => {
    if (inFlight.current) return;
    if(selectionFirst){onCancel();return;}
    returnFocusId.current = chosenId;
    setChosenId(null); setName(''); setFailed(false);
  };
  const save = async () => {
    const id = chosen?.id, cleanedName = name.trim(), turn = generation.current;
    if (!id || !cleanedName || inFlight.current || latest.current.disabled || !latest.current.active || !latest.current.candidates.some(item => item.id === id)) return;
    inFlight.current = true; setSaving(true); setFailed(false);
    try {
      const success = await latest.current.onSave(id, cleanedName);
      if (generation.current !== turn || !latest.current.active) return;
      if (success) latest.current.onCancel(); else setFailed(true);
    } catch { if (generation.current === turn && latest.current.active) setFailed(true); }
    finally { if (generation.current === turn) { inFlight.current = false; setSaving(false); } }
  };

  if (!active || selectionFirst&&!choices.some(item=>item.candidate.id===chosenId||item.candidate.id===initialObjectId)) return null;
  return <div ref={container} className="companion-canvas-picker" tabIndex={-1} role="group" aria-label={selectionFirst?text.title:undefined} aria-labelledby={selectionFirst?undefined:pickId}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !chosen && !saving) { event.preventDefault(); onCancel(); } }}>
    {!selectionFirst&&<><svg className="companion-picker-rings" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} preserveAspectRatio="none" aria-hidden="true">
      {choices.map(({ candidate, rect }) => <rect key={candidate.id} x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={8} vectorEffect="non-scaling-stroke" />)}
    </svg>
    {choices.map(({ candidate, rect }) => <button key={candidate.id} type="button" className="companion-picker-target" data-companion-choice={candidate.id}
      aria-label={`${text.select}: ${candidate.label}`} disabled={disabled || saving || Boolean(chosen)}
      style={{ left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.widthPercent}%`, height: `${rect.heightPercent}%` }}
      onClick={() => { if (!disabled && !inFlight.current) { setChosenId(candidate.id); setName(''); setFailed(false); } }}><span className="companion-picker-target-name">{candidate.label}</span></button>)}
    <div className="companion-picker-guide"><Heart size={19} aria-hidden="true"/><p id={pickId} aria-live="polite">{disabled ? text.busy : choices.length ? text.pick : text.empty}</p><button type="button" disabled={saving} onClick={onCancel}>{text.cancel}</button></div></>}
    {chosen && <dialog ref={dialog} className="companion-name-dialog" aria-labelledby={titleId} aria-describedby={hintId}
      onKeyDown={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); backToPicture(); }}>
      <button type="button" className="companion-name-close" disabled={saving} aria-label={text.close} onClick={backToPicture}><X size={19}/></button>
      <Heart className="companion-name-heart" size={27} strokeWidth={1.5} aria-hidden="true"/>
      <h2 id={titleId}>{text.title}</h2><p id={hintId}>{text.hint}</p>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor={nameId}>{text.label}</label><input ref={input} id={nameId} value={name} maxLength={COMPANION_NAME_LIMIT} placeholder={text.placeholder} autoComplete="off" autoCapitalize="words" disabled={disabled || saving} onChange={event => { setName(event.target.value); setFailed(false); }}/>
        {(error || failed) && <p className="companion-name-error" role="alert">{error || text.failed}</p>}
        <button className="companion-name-save" type="submit" disabled={disabled || saving || !name.trim()}>{saving ? text.saving : text.save}</button>
        <button className="companion-name-back" type="button" disabled={saving} onClick={backToPicture}>{selectionFirst?text.close:text.choose}</button>
      </form>
    </dialog>}
  </div>;
}
