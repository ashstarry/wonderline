'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, Clapperboard, Plus, Trash2, Undo2, X } from 'lucide-react';
import { addPicture, loadPictureBook, storePictureBook, PictureBookError, PICTURE_BOOK_KEY, PICTURE_BOOK_LIMIT, type PictureBookDraft, type PictureBookEntry, type PictureBookState, type PictureBookFailure } from '../lib/picture-book';
import './studio-extras.css';

export type PictureBookProps = {
  open: boolean; language: 'en' | 'zh'; disabled?: boolean;
  onClose: () => void; onCapture: () => Promise<PictureBookDraft>; onOpen: (entry: PictureBookEntry) => void;
  onTheatre?: () => void;
};
const words = {
  en: {
    title: 'My picturebook', subtitle: 'Little worlds to come back to.', keep: 'Keep this picture', keeping: 'Keeping…',
    empty: 'Your picturebook starts with a picture.', emptyHint: 'Keep a favourite, then come back and add to its story.',
    local: 'Saved only in this browser. Clearing browser data removes these pictures.', close: 'Close picturebook',
    open: 'Open picture', remove: 'Remove picture', removed: 'Picture removed.', undo: 'Undo', saved: 'A little world, safely kept.',
    busy: 'Finish this drawing before keeping or opening a picture.', untitled: 'My little world', full: 'Your picturebook has 12 pictures. Remove one to make room.',
    invalid: 'This picturebook could not be opened. The saved copy has been left untouched.',
    'too-large': 'This picture is too big for the picturebook. Use Save to download it instead.',
    unavailable: 'There is not enough browser space, or storage is unavailable. Your previous pictures are safe. Use Save to download this picture.',
    changed: 'Your picturebook changed in another tab. Close and open it again before making changes.',
    capture: 'This picture could not be kept just now. Your drawing is still here.',
  },
  zh: {
    title: '我的小画册', subtitle: '把小小的世界，慢慢收藏。', keep: '收下这幅画', keeping: '正在收藏…',
    empty: '小画册，等着你的第一幅画。', emptyHint: '收下一幅喜欢的画，下次回来接着讲故事。',
    local: '画册只保存在这个浏览器中。清除浏览器数据会移除这些画。', close: '关闭小画册',
    open: '打开这幅画', remove: '移除这幅画', removed: '这幅画已移出画册。', undo: '撤销', saved: '这个小世界，收好啦。',
    busy: '等这一笔画好并停止录音后，就可以收藏或打开画作。', untitled: '我的小世界', full: '画册里已经有 12 幅画了。先移出一幅，腾个位置吧。',
    invalid: '暂时无法打开画册，之前保存的内容没有改动。',
    'too-large': '这幅画太大，暂时放不进画册。请用「保存」下载保留。',
    unavailable: '浏览器空间不足，或暂时无法存储。之前的画还在，请用「保存」下载这幅画。',
    changed: '另一个标签页更新了画册，请关掉再打开画册后继续。',
    capture: '刚才没能收下这幅画，你的画仍然在画纸上。',
  },
} as const;

export default function PictureBook({ open, language, disabled = false, onClose, onCapture, onOpen, onTheatre }: PictureBookProps) {
  const text = words[language];
  const [book, setBook] = useState<PictureBookState>({ entries: [], raw: null });
  const bookRef = useRef(book), dialog = useRef<HTMLDialogElement>(null), closing = useRef(onClose);
  const [failure, setFailure] = useState<PictureBookFailure | 'capture' | null>(null);
  const [notice, setNotice] = useState<'saved' | 'removed' | null>(null), [pending, setPending] = useState(false);
  const [undo, setUndo] = useState<PictureBookEntry[] | null>(null);
  const generation = useRef(0), openRef = useRef(open), disabledRef = useRef(disabled), pendingRef = useRef(false);
  const titleId = useId(), descriptionId = useId();
  closing.current = onClose; openRef.current = open; disabledRef.current = disabled;
  const replace = (next: PictureBookState) => { bookRef.current = next; setBook(next); };

  useEffect(() => {
    if (!open) { generation.current++; dialog.current?.close(); return; }
    const active = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    setFailure(null); setNotice(null); setUndo(null); pendingRef.current = false; setPending(false);
    try { const next = loadPictureBook(localStorage); bookRef.current = next; setBook(next); }
    catch (error) { setFailure(error instanceof PictureBookError ? error.reason : 'unavailable'); }
    if (node && !node.open) node.showModal();
    const changed = (event: StorageEvent) => { if (event.key === PICTURE_BOOK_KEY || event.key === null) { generation.current++; setFailure('changed'); setUndo(null); } };
    window.addEventListener('storage', changed);
    return () => { generation.current++; window.removeEventListener('storage', changed); node?.close(); active?.focus(); };
  }, [open]);

  const locked = failure === 'invalid' || failure === 'changed' || failure === 'unavailable';
  function persist(entries: PictureBookEntry[]): boolean {
    try { replace(storePictureBook(localStorage, entries, bookRef.current.raw)); setFailure(null); return true; }
    catch (error) { setFailure(error instanceof PictureBookError ? error.reason : 'unavailable'); return false; }
  }
  async function keep() {
    if (pendingRef.current || disabledRef.current || locked || !openRef.current) return;
    if (bookRef.current.entries.length >= PICTURE_BOOK_LIMIT) { setFailure('full'); return; }
    pendingRef.current = true; setPending(true); setNotice(null); setFailure(null);
    const epoch = ++generation.current;
    try {
      const draft = await onCapture();
      if (!openRef.current || epoch !== generation.current || disabledRef.current) return;
      const entries = addPicture(bookRef.current.entries, draft, crypto.randomUUID());
      if (persist(entries)) { setUndo(null); setNotice('saved'); }
    } catch (error) { if (epoch === generation.current && openRef.current) setFailure(error instanceof PictureBookError ? error.reason : 'capture'); }
    finally { if (epoch === generation.current) { pendingRef.current = false; setPending(false); } }
  }
  function remove(id: string) {
    if (pendingRef.current || locked) return;
    const before = bookRef.current.entries;
    if (persist(before.filter(entry => entry.id !== id))) { setUndo(before); setNotice('removed'); }
  }
  function restore() {
    if (!undo || pendingRef.current || locked) return;
    if (persist(undo)) { setUndo(null); setNotice(null); }
  }
  return <dialog ref={dialog} className="studio-extra-dialog picture-book" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); closing.current(); }}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closing.current(); } }}>
    <div className="studio-extra-heading"><div><span className="studio-extra-eyebrow"><BookOpen size={17}/>{book.entries.length} / {PICTURE_BOOK_LIMIT}</span><h2 id={titleId}>{text.title}</h2><p id={descriptionId}>{text.subtitle}</p></div><button className="studio-extra-close" aria-label={text.close} onClick={onClose} autoFocus><X size={20}/></button></div>
    <div className="picture-book-actions"><button className="studio-extra-primary" disabled={disabled || pending || locked || book.entries.length >= PICTURE_BOOK_LIMIT} onClick={() => void keep()}><Plus size={18}/>{pending ? text.keeping : text.keep}</button>{onTheatre&&<button className="studio-extra-primary picture-book-theatre" disabled={disabled||pending||locked||!book.entries.length} onClick={onTheatre}><Clapperboard size={18}/>{language==='zh'?'排成一个故事':'Make a story'}</button>}</div>
    {disabled && <p className="studio-extra-hint">{text.busy}</p>}
    {book.entries.length >= PICTURE_BOOK_LIMIT && <p className="studio-extra-hint">{text.full}</p>}
    <div className="studio-extra-feedback" aria-live="polite">{failure ? <p role="alert">{text[failure]}</p> : notice ? <p>{text[notice]}{undo && <button className="studio-extra-undo" onClick={restore}><Undo2 size={14}/>{text.undo}</button>}</p> : null}</div>
    {!book.entries.length && !locked ? <div className="picture-book-empty"><BookOpen size={48} strokeWidth={1.2}/><h3>{text.empty}</h3><p>{text.emptyHint}</p></div> : <div className="picture-book-grid">{book.entries.map(entry => <article className="picture-book-card" key={entry.id}>
      <button className="picture-book-open" disabled={disabled || pending || locked} onClick={() => { if (!disabledRef.current && !pendingRef.current && !locked) { onOpen(entry); onClose(); } }} aria-label={`${text.open}: ${entry.scene.title || text.untitled}`}>
        <img src={entry.thumbnail} alt="" width="320" height="200" loading="lazy"/><span>{entry.scene.title === '轻轻画' ? text.untitled : entry.scene.title || text.untitled}</span>
      </button><div className="picture-book-card-footer"><time dateTime={new Date(entry.createdAt).toISOString()}>{new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' }).format(entry.createdAt)}</time><button className="picture-book-remove" disabled={pending || locked} onClick={() => remove(entry.id)} aria-label={`${text.remove}: ${entry.scene.title || text.untitled}`}><Trash2 size={17}/></button></div>
    </article>)}</div>}
    <p className="picture-book-privacy">{text.local}</p>
  </dialog>;
}
