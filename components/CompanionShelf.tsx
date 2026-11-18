'use client';
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Heart, Mic, Pencil, Plus, RefreshCw, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { COMPANION_LIMIT, COMPANION_NAME_LIMIT, companionScene, type Companion } from '../lib/story-companions';
import SceneCanvas from './SceneCanvas';
import './studio-extras.css';
import './companion-shelf.css';

export type CompanionShelfProps = {
  open: boolean;
  language: 'en' | 'zh';
  entries: Companion[];
  canPick: boolean;
  disabled: boolean;
  onClose: () => void;
  onRecall: (id: string) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string, previousName: string) => boolean;
  onUndoRemove?: () => void;
  onPickFromCanvas: () => void;
  error?: string;
  notice?: string;
};

const words = {
  en: {
    title: 'My companions', subtitle: 'New worlds. The same little friend.', close: 'Close companions',
    voice: 'A name is the start of a story.', voiceFirst: 'While your friend is being drawn, say “His name is Coco”.',
    voiceNext: 'On another page, try “Coco is on the moon”. Keep talking while we draw.',
    empty: 'Who will your first companion be?', emptyHint: 'A little bear, an imaginary creature, or someone only you can dream up.',
    keep: 'Add a companion', pickHint: 'Tap a character in your picture, then give them a name.',
    noCandidates: 'Draw a friend first, then give them a name.', busy: 'You can look around while the picture takes shape. These buttons will be ready shortly.',
    recall: 'Bring to this page', remove: 'Forget this companion', confirm: 'Forget', cancel: 'Keep',
    rename: 'Rename', name: 'Companion’s name', saveName: 'Save name', cancelRename: 'Cancel',
    privacy: 'Companions stay in this browser. Clearing browser data removes them.',
    full: 'Your eight friends are here. Make a little room before keeping another.',
    next: 'The same shapes and colours, in each new page’s art style.', undo: 'Undo forget',
  },
  zh: {
    title: '我的伙伴', subtitle: '新的世界，熟悉的小伙伴。', close: '关闭我的伙伴',
    voice: '一个名字，就是故事的开始。', voiceFirst: '伙伴还在画，就可以说「它叫豆豆」。',
    voiceNext: '换一张纸，试着说「豆豆到了月球」。画笔还在画，你可以接着讲。',
    empty: '谁会成为你的第一位伙伴？', emptyHint: '一只小熊、一个幻想生物，或者只有你想得到的朋友。',
    keep: '添加伙伴', pickHint: '点一下画里的角色，再给它起个名字。',
    noCandidates: '先画出一位朋友，再给它起名字吧。', busy: '画面还在慢慢长出来，你可以先看看伙伴。这些按钮稍后就能用了。',
    recall: '来到这张画里', remove: '忘记这位伙伴', confirm: '忘记', cancel: '留下',
    rename: '改名', name: '伙伴的名字', saveName: '保存名字', cancelRename: '取消',
    privacy: '伙伴只保存在这个浏览器中。清除浏览器数据会移除它们。',
    full: '八位伙伴都到齐啦，先腾出一点位置，再认识新朋友吧。',
    next: '保留伙伴的样子和颜色，跟随新画纸的画风。', undo: '撤销忘记',
  },
} as const;

const CompanionPreview = memo(function CompanionPreview({ entry }: { entry: Companion }) {
  const scene = useMemo(() => companionScene(entry), [entry]);
  const viewport = useMemo(() => { const bounds = entry.bounds, pad = Math.max(bounds.width, bounds.height) * .12; return { x: bounds.x - pad, y: bounds.y - pad, width: bounds.width + pad * 2, height: bounds.height + pad * 2 }; }, [entry]);
  return <SceneCanvas scene={scene} viewport={viewport} style={entry.style} motionMode="still" soundEnabled={false} />;
});

export default function CompanionShelf({ open, language, entries, canPick, disabled, onClose, onRecall, onRemove, onRename, onUndoRemove, onPickFromCanvas, error, notice }: CompanionShelfProps) {
  const text = words[language];
  const dialog = useRef<HTMLDialogElement>(null), closing = useRef(onClose);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; previousName: string } | null>(null);
  const [draftName, setDraftName] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>()), lastEditingId = useRef<string | null>(null);
  const titleId = useId(), descriptionId = useId();
  const full = entries.length >= COMPANION_LIMIT;
  closing.current = onClose;

  useEffect(() => {
    if (!open) { dialog.current?.close(); return; }
    const active = document.activeElement as HTMLElement | null, node = dialog.current;
    setRemovingId(null);
    setEditing(null);
    if (node && !node.open) node.showModal();
    return () => { node?.close(); if (active?.isConnected) active.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (editing) { nameInput.current?.focus(); nameInput.current?.select(); }
    else if (lastEditingId.current) renameButtons.current.get(lastEditingId.current)?.focus();
    lastEditingId.current = editing?.id ?? null;
  }, [editing]);
  useEffect(() => { if (editing && !entries.some(entry => entry.id === editing.id)) setEditing(null); }, [entries, editing]);

  if (!open) return null;
  return <dialog ref={dialog} className="studio-extra-dialog companion-shelf" aria-labelledby={titleId} aria-describedby={descriptionId}
    onKeyDown={event => event.stopPropagation()}
    onCancel={event => { event.preventDefault(); closing.current(); }}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closing.current(); } }}>
    <div className="studio-extra-heading"><div><span className="studio-extra-eyebrow"><Heart size={17} aria-hidden="true"/>{entries.length} / {COMPANION_LIMIT}</span><h2 id={titleId}>{text.title}</h2><p id={descriptionId}>{text.subtitle}</p></div><button type="button" className="studio-extra-close" aria-label={text.close} onClick={onClose} autoFocus><X size={20}/></button></div>
    <div className="companion-voice-guide"><Mic size={23} strokeWidth={1.6} aria-hidden="true"/><div><h3>{text.voice}</h3><p>{text.voiceFirst}</p><p>{text.voiceNext}</p></div></div>
    <div className="studio-extra-feedback" aria-live="polite">{error ? <p role="alert">{error}</p> : notice ? <p>{notice}</p> : null}{onUndoRemove && <button type="button" className="studio-extra-undo" disabled={disabled} onClick={onUndoRemove}><Undo2 size={14}/>{text.undo}</button>}</div>
    {disabled && !canPick && <p className="studio-extra-hint">{text.busy}</p>}
    {entries.length > 0 ? <div className="companion-grid">{entries.map(entry => <article className="companion-card" key={entry.id}>
      <div className="companion-portrait" aria-hidden="true"><CompanionPreview entry={entry}/></div>
      <div className="companion-card-heading"><h3>{entry.name}</h3><button type="button" className="companion-remove" disabled={disabled} aria-label={`${text.remove}: ${entry.name}`} aria-expanded={removingId === entry.id} onClick={() => { setEditing(null); setRemovingId(removingId === entry.id ? null : entry.id); }}><Trash2 size={16}/></button></div>
      {editing?.id === entry.id ? <form className="companion-rename-form" onSubmit={event => {
        event.preventDefault();
        if (!disabled && draftName.trim() && onRename(entry.id, draftName, editing.previousName)) setEditing(null);
      }}>
        <label htmlFor={`${titleId}-name`}>{text.name}</label>
        <input ref={nameInput} id={`${titleId}-name`} value={draftName} maxLength={COMPANION_NAME_LIMIT} disabled={disabled} autoComplete="off" spellCheck={false}
          onChange={event => setDraftName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setEditing(null); } }}/>
        <div><button type="submit" disabled={disabled || !draftName.trim()}>{text.saveName}</button><button type="button" onClick={() => setEditing(null)}>{text.cancelRename}</button></div>
      </form> : <button ref={node => { if (node) renameButtons.current.set(entry.id, node); else renameButtons.current.delete(entry.id); }} type="button" className="companion-rename" disabled={disabled} aria-label={`${text.rename}: ${entry.name}`} onClick={() => { setRemovingId(null); setDraftName(entry.name); setEditing({id:entry.id,previousName:entry.name}); }}><Pencil size={13} aria-hidden="true"/>{text.rename}</button>}
      <p className="companion-voice-example">{language === 'zh' ? `「${entry.name}到了月球。」` : `“${entry.name} is on the moon.”`}</p>
      {removingId === entry.id ? <div className="companion-forget"><p>{language === 'zh' ? `忘记${entry.name}吗？` : `Forget ${entry.name}?`}</p><div><button type="button" disabled={disabled} onClick={() => setRemovingId(null)}>{text.cancel}</button><button type="button" disabled={disabled} onClick={() => { if (!disabled) { onRemove(entry.id); setRemovingId(null); } }}>{text.confirm}</button></div></div> : <button type="button" className="companion-recall" disabled={disabled} onClick={() => { if (!disabled) onRecall(entry.id); }}>{text.recall}<ArrowRight size={16} aria-hidden="true"/></button>}
    </article>)}</div> : <div className="companion-empty"><Heart size={38} strokeWidth={1.2} aria-hidden="true"/><h3>{text.empty}</h3><p>{text.emptyHint}</p></div>}
    <div className="companion-add"><button type="button" className="studio-extra-primary" disabled={full || !canPick} onClick={() => { if (!full && canPick) onPickFromCanvas(); }}><Plus size={17} aria-hidden="true"/>{text.keep}</button><p>{full ? text.full : canPick ? text.pickHint : text.noCandidates}</p></div>
    <p className="companion-shelf-ending">{text.next}</p><p className="picture-book-privacy">{text.privacy}</p>
  </dialog>;
}

/** A question for the child, never a generated drawing instruction. */
export function companionSparkText(name: string, language: 'en' | 'zh', index: number): string {
  const prompts = language === 'zh' ? [
    `${name}接下来会去哪里呢？`, `${name}会遇见谁呢？`, `${name}会发现什么小惊喜呢？`, `${name}会和朋友一起做出什么呢？`, `${name}想带什么去冒险呢？`,
  ] : [
    `Where will ${name} go next?`, `Who might ${name} meet there?`, `What tiny surprise could ${name} find?`, `What could ${name} make with a friend?`, `What would ${name} take on an adventure?`,
  ];
  const normalized = Number.isFinite(index) ? ((Math.trunc(index) % prompts.length) + prompts.length) % prompts.length : 0;
  return prompts[normalized];
}

export type CompanionSparkProps = { name: string | null; language: 'en' | 'zh'; initialIndex?: number; onClose: () => void };
export function CompanionSpark({ name, language, initialIndex = 0, onClose }: CompanionSparkProps) {
  const [index, setIndex] = useState(() => Number.isFinite(initialIndex) ? ((Math.trunc(initialIndex) % 5) + 5) % 5 : 0);
  const subject = name?.trim() || (language === 'zh' ? '你的小伙伴' : 'your friend');
  return <aside className="companion-spark" aria-label={language === 'zh' ? '伙伴的下一段故事' : 'Your companion’s next story'}>
    <Sparkles size={17} aria-hidden="true"/><p aria-live="polite">{companionSparkText(subject, language, index)}</p>
    <button type="button" onClick={() => setIndex(value => (value + 1) % 5)} aria-label={language === 'zh' ? '再想一个' : 'Another idea'}><RefreshCw size={16}/></button>
    <button type="button" onClick={onClose} aria-label={language === 'zh' ? '收起灵感' : 'Dismiss idea'}><X size={17}/></button>
  </aside>;
}
