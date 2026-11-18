'use client';
import { useLanguage } from './LanguageProvider';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Palette, X } from 'lucide-react';
import './color-palette.css';

export const QUICK_COLORS = [
  { name: '森林绿', value: '#486b4c' },
  { name: '珊瑚红', value: '#cf785e' },
  { name: '天空蓝', value: '#638ea8' },
  { name: '向日葵黄', value: '#d5ab48' },
];

const PALETTE_COLORS = [
  { name: '石墨黑', value: '#3d423e' },
  { name: '奶油白', value: '#fffdf3' },
  { name: '可可棕', value: '#956449' },
  { name: '草莓红', value: '#d85a67' },
  { name: '桃子粉', value: '#eda3b5' },
  { name: '橘子橙', value: '#e99448' },
  { name: '阳光黄', value: '#ebc75c' },
  { name: '嫩叶绿', value: '#9ebc6c' },
  { name: '森林绿', value: '#486b4c' },
  { name: '薄荷青', value: '#66b6ac' },
  { name: '晴空蓝', value: '#639dd1' },
  { name: '葡萄紫', value: '#a18ac4' },
];
const STORAGE_KEY = 'softspoken-recent-colors-v1';
const validColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const clamp = (number: number, min = 0, max = 1) => Math.max(min, Math.min(max, number));
type Hsv = { h: number; s: number; v: number };

function fromHex(hex: string, previousHue = 135): Hsv {
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = previousHue;
  if (delta) h = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  return { h, s: max ? delta / max : 0, v: max };
}

function toHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

type Props = { value: string; onChange: (hex: string) => void; disabled?: boolean };

export default function ColorPalette({ value, onChange, disabled = false }: Props) {
 const {t}=useLanguage();
  const color = validColor(value) ? value.toLowerCase() : QUICK_COLORS[0].value;
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState(() => fromHex(color));
  const [recent, setRecent] = useState<string[]>([]);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 276, ready: false });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(color);
  const hsvRef = useRef(hsv);
  const recentRef = useRef<string[]>([]);
  const pointerRef = useRef<number | null>(null);
  const openRef = useRef(false);
  const lastEmittedRef = useRef<string | null>(null);
  const previousColorRef = useRef(color);
  const titleId = useId(), instructionsId = useId(), popupId = useId();

  const remember = useCallback((next: string) => {
    if (!validColor(next)) return;
    const normalized = next.toLowerCase();
    const choices = [normalized, ...recentRef.current.filter(item => item !== normalized)].slice(0, 6);
    recentRef.current = choices;
    setRecent(choices);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(choices)); } catch { /* Drawing works without browser storage. */ }
  }, []);

  const close = useCallback((restoreFocus = false) => {
    if (!openRef.current) return;
    remember(selectedRef.current);
    pointerRef.current = null;
    openRef.current = false;
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, [remember]);

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(stored)) return;
      const choices = [...new Set(stored.filter(validColor).map(item => item.toLowerCase()))].slice(0, 6);
      recentRef.current = choices;
      setRecent(choices);
    } catch { /* Ignore malformed or unavailable storage. */ }
  }, []);

  useEffect(() => {
    selectedRef.current = color;
    if (lastEmittedRef.current !== color) {
      const next = fromHex(color, hsvRef.current.h);
      hsvRef.current = next;
      setHsv(next);
    }
    lastEmittedRef.current = null;
    if (previousColorRef.current !== color && !openRef.current) remember(color);
    previousColorRef.current = color;
  }, [color, remember]);

  useEffect(() => { if (disabled) close(); }, [disabled, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      const width = Math.min(276, window.innerWidth - 16);
      const desiredLeft = anchor.right + 10;
      const left = desiredLeft + width <= window.innerWidth - 8 ? desiredLeft : anchor.left - width - 10 >= 8 ? anchor.left - width - 10 : clamp(desiredLeft, 8, window.innerWidth - width - 8);
      const height = Math.min(popup.getBoundingClientRect().height, window.innerHeight - 16);
      const top = clamp(anchor.top - 72, 8, Math.max(8, window.innerHeight - height - 8));
      setPosition({ left, top, width, ready: true });
    };
    positionPopup();
    const observer = new ResizeObserver(positionPopup);
    if (popupRef.current) observer.observe(popupRef.current);
    window.addEventListener('resize', positionPopup);
    window.addEventListener('scroll', positionPopup, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', positionPopup);
      window.removeEventListener('scroll', positionPopup, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && position.ready) popupRef.current?.querySelector<HTMLButtonElement>('.palette-color')?.focus({ preventScroll: true });
  }, [open, position.ready]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !popupRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open, close]);

  function change(next: Hsv) {
    hsvRef.current = next;
    setHsv(next);
    const hex = toHex(next);
    selectedRef.current = hex;
    lastEmittedRef.current = hex;
    onChange(hex);
  }

  function choose(hex: string) {
    change(fromHex(hex, hsvRef.current.h));
    remember(hex);
  }

  function padColor(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    change({ ...hsvRef.current, s: clamp((event.clientX - rect.left) / rect.width), v: 1 - clamp((event.clientY - rect.top) / rect.height) });
  }

  function padDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    padColor(event);
  }

  function padEnd(event: PointerEvent<HTMLDivElement>) {
    if (pointerRef.current !== event.pointerId) return;
    if (event.type === 'pointerup') padColor(event);
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    remember(selectedRef.current);
  }

  function padKey(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const current = hsvRef.current;
    if (event.key === 'ArrowLeft') change({ ...current, s: clamp(current.s - step) });
    else if (event.key === 'ArrowRight') change({ ...current, s: clamp(current.s + step) });
    else if (event.key === 'ArrowUp') change({ ...current, v: clamp(current.v + step) });
    else if (event.key === 'ArrowDown') change({ ...current, v: clamp(current.v - step) });
    else return;
    event.preventDefault();
    remember(selectedRef.current);
  }

  const colorStyle = (hex: string) => ({ '--palette-color': hex } as CSSProperties);
  return <>
    <button ref={triggerRef} type="button" className="color-palette-trigger" aria-label={t("打开调色盘")} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined} disabled={disabled} title={t("挑一个颜色，也可以自己调")} onClick={() => {
      if (open) { close(true); return; }
      setPosition(current => ({ ...current, ready: false }));
      openRef.current = true;
      setOpen(true);
    }}>
      <span className="color-palette-icon"><Palette size={20} strokeWidth={1.6} /><i style={{ backgroundColor: color }} /></span>
      <span>{t("调色盘")}</span>
    </button>
    {open && createPortal(<div ref={popupRef} id={popupId} role="dialog" aria-labelledby={titleId} className="color-palette-popup" style={{ left: position.left, top: position.top, width: position.width, visibility: position.ready ? 'visible' : 'hidden' }}>
      <div className="color-palette-heading"><h2 id={titleId}>{t("调一个喜欢的颜色")}</h2><button type="button" aria-label={t("收起调色盘")} onClick={() => close(true)}><X size={17} /></button></div>
      <div className="color-palette-presets" role="group" aria-label={t("常用颜色")}>
        {PALETTE_COLORS.map(choice => <button type="button" className="palette-color" key={choice.value} aria-label={t(choice.name)} title={t(choice.name)} aria-pressed={color === choice.value} style={colorStyle(choice.value)} onClick={() => choose(choice.value)}>{color === choice.value && <Check size={16} strokeWidth={2.4} />}</button>)}
      </div>
      <div className="color-palette-label"><span>{t("在这里调深浅")}</span><span aria-hidden="true">{t("轻轻点，慢慢调")}</span></div>
      <div ref={padRef} role="slider" tabIndex={0} aria-label={t("颜色浓淡与明暗")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)} aria-valuetext={t('浓淡 {s}%，明暗 {v}%',{s:Math.round(hsv.s*100),v:Math.round(hsv.v*100)})} aria-describedby={instructionsId} className="color-palette-pad" style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }} onPointerDown={padDown} onPointerMove={event => { if (pointerRef.current === event.pointerId) padColor(event); }} onPointerUp={padEnd} onPointerCancel={padEnd} onLostPointerCapture={() => { if (pointerRef.current !== null) { pointerRef.current = null; remember(selectedRef.current); } }} onKeyDown={padKey}>
        <span className="color-palette-selector" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: color }} />
      </div>
      <span id={instructionsId} className="palette-sr-only">{t("左右方向键调浓淡，上下方向键调明暗。按住 Shift 可以调得更快。")}</span>
      <label className="color-palette-hue-label"><span className="palette-sr-only">{t("选择彩虹上的颜色")}</span><input type="range" min="0" max="359" step="1" value={Math.round(hsv.h)} aria-label={t("选择彩虹上的颜色")} style={{ '--hue-color': `hsl(${hsv.h} 100% 50%)` } as CSSProperties} onChange={event => change({ ...hsvRef.current, h: Number(event.target.value) })} onPointerUp={() => remember(selectedRef.current)} onPointerCancel={() => remember(selectedRef.current)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) remember(selectedRef.current); }} onBlur={() => remember(selectedRef.current)} /></label>
      {recent.length > 0 && <div className="color-palette-recents"><span>{t("刚刚用过")}</span><div role="group" aria-label={t("最近用过的颜色")}>{recent.map((hex, index) => <button type="button" key={hex} className="palette-color" aria-label={t('最近的颜色 {n}',{n:index+1})} aria-pressed={color === hex} style={colorStyle(hex)} onClick={() => choose(hex)}>{color === hex && <Check size={12} strokeWidth={2.4} />}</button>)}</div></div>}
      <div className="color-palette-preview" aria-label={t("当前颜色预览")}><svg viewBox="0 0 150 32" aria-hidden="true"><path d="M8 22 C28 3 42 6 31 20 S61 25 76 14 S105 7 103 19 S127 25 142 12" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" /><path d="M8 23 C28 4 42 7 31 21 S61 26 76 15 S105 8 103 20 S127 26 142 13" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" opacity=".25" /></svg><button type="button" onClick={() => close(true)}>{t("画这个颜色")}<Check size={14} /></button></div>
    </div>, document.body)}
  </>;
}
