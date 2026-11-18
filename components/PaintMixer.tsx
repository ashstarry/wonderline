'use client';

import { useId, useState, type CSSProperties } from 'react';
import { Check, ChevronDown, Droplet, RotateCcw, Undo2 } from 'lucide-react';
import type { Language } from '../lib/ui-language';
import { addPaintDrop, MAX_DROPS_PER_COLOR, MAX_PAINT_DROPS, mixPaint, PAINT_COLORS, PAINT_POTS, paintCounts, undoPaintDrop, type PaintColor, type PaintDrops } from '../lib/paint-mixer';
import './paint-mixer.css';

const COPY = {
  en: { title: 'Mix & play', hint: 'Tap a color. See what happens.', result: 'Your mix', empty: 'Add a little color', undo: 'Undo drop', clear: 'Start over', use: 'Use this color', full: 'Full', colors: { red: 'Red', yellow: 'Yellow', blue: 'Blue', white: 'White' } },
  zh: { title: '混色玩一玩', hint: '点一点颜色，看看会变成什么。', result: '你调的颜色', empty: '加一点颜色', undo: '退回一滴', clear: '重新调', use: '用这个颜色', full: '满了', colors: { red: '红色', yellow: '黄色', blue: '蓝色', white: '白色' } },
};

type Props = { language: Language; disabled?: boolean; onUse: (hex: string) => void };

export default function PaintMixer({ language, disabled = false, onUse }: Props) {
  const [drops, setDrops] = useState<PaintDrops>([]);
  const copy = COPY[language];
  const counts = paintCounts(drops);
  const color = mixPaint(drops);
  const descriptionId = useId();
  const dropLabel = (key: PaintColor) => language === 'zh'
    ? `加一滴${copy.colors[key]}，已有 ${counts[key]} 滴，最多 ${MAX_DROPS_PER_COLOR} 滴`
    : `Add a drop of ${copy.colors[key].toLowerCase()}. ${counts[key]} of ${MAX_DROPS_PER_COLOR} drops.`;
  const recipe = PAINT_COLORS.filter(key => counts[key]).map(key => `${copy.colors[key]} ${counts[key]}`).join(language === 'zh' ? '，' : ', ');

  return <details className="paint-mixer" data-paint-mixer="true">
    <summary role="button"><span><Droplet size={16} aria-hidden="true" />{copy.title}</span><ChevronDown size={15} aria-hidden="true" /></summary>
    <div className="paint-mixer-body">
      <p id={descriptionId}>{copy.hint}</p>
      <div className="paint-mixer-pots" role="group" aria-label={copy.title} aria-describedby={descriptionId}>
        {PAINT_COLORS.map(key => <button key={key} type="button" className="paint-mixer-pot" data-mixer-color={key}
          style={{ '--mix-pot-color': PAINT_POTS[key] } as CSSProperties}
          disabled={disabled || counts[key] >= MAX_DROPS_PER_COLOR || drops.length >= MAX_PAINT_DROPS}
          aria-label={dropLabel(key)} title={`${copy.colors[key]}${counts[key] >= MAX_DROPS_PER_COLOR ? ` · ${copy.full}` : ''}`}
          onClick={() => { if (!disabled) setDrops(previous => addPaintDrop(previous, key)); }}>
          <span className="paint-mixer-drop" aria-hidden="true"><svg viewBox="0 0 32 34"><path d="M16 3 C13 10 5 14 5 22 A11 10 0 0 0 27 22 C27 14 19 10 16 3Z" /><path d="M10 22 Q10 27 15 28" className="paint-mixer-shine" /></svg><b>{counts[key]}</b></span>
          <span>{copy.colors[key]}</span>
        </button>)}
      </div>
      <div className="paint-mixer-result">
        <svg viewBox="0 0 116 62" className="paint-mixer-puddle" aria-hidden="true"><path d="M11 35 C6 17 28 7 48 13 C62 5 99 11 103 29 C117 43 95 57 77 49 C58 61 18 55 11 35Z" fill={color || '#f1efe6'} /><path d="M26 26 Q35 19 45 21" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".48" /></svg>
        <div role="status" aria-live="polite" aria-atomic="true"><span>{color ? copy.result : copy.empty}</span>{color && <><small aria-hidden="true">{language === 'zh' ? `${drops.length} 滴` : `${drops.length} ${drops.length === 1 ? 'drop' : 'drops'}`}</small><span className="paint-mixer-sr-only">{recipe}</span></>}</div>
      </div>
      <div className="paint-mixer-actions">
        <button type="button" disabled={disabled || !drops.length} onClick={() => { if (!disabled) setDrops(undoPaintDrop); }}><Undo2 size={15} aria-hidden="true" />{copy.undo}</button>
        <button type="button" disabled={disabled || !drops.length} onClick={() => { if (!disabled) setDrops([]); }}><RotateCcw size={15} aria-hidden="true" />{copy.clear}</button>
      </div>
      <button type="button" className="paint-mixer-use" disabled={disabled || !color} onClick={() => { if (!disabled && color) onUse(color); }}><Check size={16} aria-hidden="true" />{copy.use}</button>
    </div>
  </details>;
}
