'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { MapPin, RefreshCw, Sparkles, Users, WandSparkles, X } from 'lucide-react';
import './studio-extras.css';

export const STORY_SPARKS = {
  where: [
    { en: 'Where could a tiny secret door lead?', zh: '一扇小小的秘密门，通向哪里呢？' },
    { en: 'What is hiding beyond the rainbow?', zh: '彩虹的另一边，藏着什么呢？' },
    { en: 'Where would you build a cosy little home?', zh: '你想把温暖的小家，建在哪里呢？' },
    { en: 'What might a garden on the moon look like?', zh: '月亮上的花园，会是什么样子呢？' },
    { en: 'What is at the bottom of a sparkling pond?', zh: '亮晶晶的小池塘底下，会有什么呢？' },
    { en: 'Where does this winding path go next?', zh: '这条弯弯的小路，接下来会通向哪里？' },
  ],
  who: [
    { en: 'Who could arrive with a very tiny suitcase?', zh: '谁会提着小小的行李箱，来到这里呢？' },
    { en: 'Which two unlikely friends could meet here?', zh: '哪两个意想不到的朋友，会在这里相遇呢？' },
    { en: 'Who is peeking out from behind something?', zh: '谁正从什么东西后面，悄悄探出头呢？' },
    { en: 'What would your favourite animal wear today?', zh: '你最喜欢的小动物，今天会穿什么呢？' },
    { en: 'Who might visit from a different little world?', zh: '哪个小世界的客人，会来这里做客呢？' },
    { en: 'Who needs a little home of their own?', zh: '谁需要一个属于自己的小家呢？' },
  ],
  next: [
    { en: 'What could your friends make together?', zh: '朋友们一起，能做出什么呢？' },
    { en: 'What surprise could float down from the sky?', zh: '什么小惊喜，会从天空慢慢飘下来呢？' },
    { en: 'What happens when someone opens that door?', zh: '有人打开那扇门之后，会发生什么呢？' },
    { en: 'What would make this place extra cosy?', zh: '添上一点什么，这里就会更温暖呢？' },
    { en: 'What could someone bring to a little picnic?', zh: '要去小小的野餐，大家会带上什么呢？' },
    { en: 'What new thing could grow here tomorrow?', zh: '到了明天，这里会长出什么新东西呢？' },
  ],
} as const;
export type SparkCategory = keyof typeof STORY_SPARKS;

/** Draw from the other cards only, so Shuffle always changes the suggestion. */
export function nextSparkIndex(current: number, length: number, random = Math.random()): number {
  if (length <= 1) return 0;
  const normalized = Number.isFinite(random) ? Math.max(0, Math.min(0.999999999, random)) : 0;
  return (current + 1 + Math.floor(normalized * (length - 1))) % length;
}

export type StorySparksProps = { open: boolean; language: 'en' | 'zh'; onClose: () => void };
const copy = {
  en: { title: 'Story sparks', subtitle: 'A little nudge for your next idea.', where: 'Where?', who: 'Who?', next: 'What happens next?', another: 'Another idea', close: 'Close story sparks', footer: 'Keep talking while we draw. These are just ideas — your story is yours.' },
  zh: { title: '故事灵感', subtitle: '给下一个想法，一点小小的灵感。', where: '在哪里？', who: '有谁呢？', next: '接下来呢？', another: '再来一个灵感', close: '关闭故事灵感', footer: '画笔还在画，你可以接着说。灵感只是起点，故事由你决定。' },
} as const;

export default function StorySparks({ open, language, onClose }: StorySparksProps) {
  const text = copy[language], [category, setCategory] = useState<SparkCategory>('where');
  const [indices, setIndices] = useState({ where: 0, who: 0, next: 0 });
  const dialog = useRef<HTMLDialogElement>(null), closing = useRef(onClose), titleId = useId(), descriptionId = useId();
  closing.current = onClose;
  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const active = document.activeElement as HTMLElement | null, node = dialog.current;
    if (node && !node.open) node.showModal();
    return () => { node?.close(); active?.focus(); };
  }, [open]);
  const icon = category === 'where' ? <MapPin size={30} strokeWidth={1.5}/> : category === 'who' ? <Users size={30} strokeWidth={1.5}/> : <WandSparkles size={30} strokeWidth={1.5}/>;
  return <dialog ref={dialog} className="studio-extra-dialog story-sparks" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); closing.current(); }}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closing.current(); } }}>
    <div className="studio-extra-heading"><div><span className="studio-extra-eyebrow"><Sparkles size={17}/></span><h2 id={titleId}>{text.title}</h2><p id={descriptionId}>{text.subtitle}</p></div><button className="studio-extra-close" aria-label={text.close} onClick={onClose} autoFocus><X size={20}/></button></div>
    <div className="story-spark-categories" role="group" aria-label={text.title}>{(['where', 'who', 'next'] as const).map(key => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{text[key]}</button>)}</div>
    <div className={`story-spark-card story-spark-card--${category}`} aria-live="polite"><span aria-hidden="true">{icon}</span><p>{STORY_SPARKS[category][indices[category]][language]}</p></div>
    <button className="studio-extra-primary story-spark-shuffle" onClick={() => setIndices(previous => ({ ...previous, [category]: nextSparkIndex(previous[category], STORY_SPARKS[category].length) }))}><RefreshCw size={17}/>{text.another}</button>
    <p className="story-spark-footer">{text.footer}</p>
  </dialog>;
}
