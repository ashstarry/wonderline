'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, Film, Pause, Play, X } from 'lucide-react';
import { loadPictureBook, PictureBookError, PICTURE_BOOK_KEY, type PictureBookEntry } from '../lib/picture-book';
import { editStoryCaption, exportStoryHtml, moveStoryPage, reconcileStoryPages, STORY_CAPTION_LIMIT, STORY_PAGE_SECONDS, STORY_TITLE_LIMIT, storyDownloadName, storyText, toggleStoryPage, type StoryPage } from '../lib/story-theatre';
import './studio-extras.css';
import './story-theatre.css';

export type StoryTheatreProps = { open: boolean; language: 'en' | 'zh'; onClose: () => void };
const words = {
  en: {
    title: 'Story theatre', subtitle: 'Your pictures. Your order. Your story.', close: 'Close story theatre',
    choose: 'Choose your pages', chooseHint: 'Tap pictures in the order you want to tell your story.', selected: 'Your story pages',
    show: 'Tell my story', back: 'Arrange pages', previous: 'Previous page', next: 'Next page', earlier: 'Move earlier', later: 'Move later',
    storyTitle: 'Give your story a name', untitled: 'My little story', picture: 'My little world', caption: 'Words for this page',
    captionHint: 'These words belong to your story draft. Your saved pictures stay the same.',
    download: 'Save storybook', downloaded: 'Storybook download prepared.', downloadFailed: 'The download could not start. Your story is still here.',
    privacy: 'Story edits stay in this tab until you reload. Download to keep them. Images use picturebook previews.',
    empty: 'Your stage is waiting for a picture.', emptyHint: 'Keep a picture in My picturebook, then come back to make a story.',
    none: 'Choose a picture to begin.', auto: 'Turn pages for me', pause: 'Pause page turning', finished: 'The end. Your story is ready for another telling.',
    page: 'Page', removed: 'Removed from this story only.',
    invalid: 'The picturebook could not be opened. Your saved copy has been left untouched.',
    unavailable: 'The browser could not open your picturebook. Close this window and try again.',
    changed: 'Your picturebook changed in another tab. Close and reopen the theatre to use the latest pictures.',
  },
  zh: {
    title: '故事小剧场', subtitle: '排一排你的画，讲一段自己的故事。', close: '关闭故事小剧场',
    choose: '选几幅画，变成故事', chooseHint: '按你想讲的顺序，点选画册里的画。', selected: '我的故事顺序',
    show: '开始讲故事', back: '调整故事页', previous: '上一页', next: '下一页', earlier: '往前一页', later: '往后一页',
    storyTitle: '给故事起个名字', untitled: '我的小故事', picture: '我的小世界', caption: '这一页的故事',
    captionHint: '只改小剧场里的故事文字，收藏的画和原来的话都不变。',
    download: '保存故事书', downloaded: '故事书已准备好下载。', downloadFailed: '刚才没能开始下载，你的故事还在这里。',
    privacy: '故事修改保留到本标签页刷新前，下载后就能留下。图片使用小画册预览图。',
    empty: '小舞台，等着你的第一幅画。', emptyHint: '先在「我的小画册」收下一幅画，再回来把它变成故事。',
    none: '点一幅画，故事就开始了。', auto: '帮我自动翻页', pause: '暂停自动翻页', finished: '故事讲完啦，还可以从头再讲一次。',
    page: '第', removed: '只从这段故事中移出了这幅画。',
    invalid: '暂时无法打开画册，之前保存的内容没有改动。',
    unavailable: '浏览器暂时无法打开画册，请关掉小剧场后再试。',
    changed: '另一个标签页更新了画册，请关掉再打开小剧场，使用最新的画。',
  },
} as const;

export default function StoryTheatre({ open, language, onClose }: StoryTheatreProps) {
  const text = words[language];
  const dialog = useRef<HTMLDialogElement>(null), stage = useRef<HTMLElement>(null), titleInput = useRef<HTMLInputElement>(null), closing = useRef(onClose), pagesRef = useRef<StoryPage[]>([]);
  const [pictures, setPictures] = useState<PictureBookEntry[]>([]), [pages, setPages] = useState<StoryPage[]>([]);
  const [title, setTitle] = useState(''), [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<'arrange' | 'show'>('arrange'), [index, setIndex] = useState(0), [playing, setPlaying] = useState(false);
  const [failure, setFailure] = useState<'invalid' | 'unavailable' | 'changed' | null>(null);
  const [notice, setNotice] = useState<'downloaded' | 'downloadFailed' | 'removed' | null>(null);
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const titleId = useId(), descriptionId = useId(), storyTitleId = useId(), captionId = useId(), captionHintId = useId();
  closing.current = onClose; pagesRef.current = pages;
  const locked = failure !== null;
  const current = mode === 'show' ? pages[index] : pages.find(page => page.id === activeId) ?? pages[0];
  const currentIndex = current ? pages.findIndex(page => page.id === current.id) : -1;
  const pageLabel = (number: number) => language === 'zh' ? `第 ${number} 页` : `Page ${number}`;
  const pictureTitle = (value: string) => !value || value === '轻轻画' ? text.picture : value;

  useEffect(() => {
    if (!open) { setPlaying(false); dialog.current?.close(); return; }
    const active = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    setFailure(null); setNotice(null); setPlaying(false); setMode('arrange'); setIndex(0);
    try {
      const entries = loadPictureBook(localStorage).entries;
      setPictures([...entries].sort((a, b) => a.createdAt - b.createdAt));
      const next = reconcileStoryPages(pagesRef.current, entries);
      pagesRef.current = next; setPages(next);
      setActiveId(previous => next.some(page => page.id === previous) ? previous : next[0]?.id ?? null);
    } catch (error) {
      setPictures([]);
      setFailure(error instanceof PictureBookError && error.reason === 'invalid' ? 'invalid' : 'unavailable');
    }
    if (node && !node.open) node.showModal();
    const changed = (event: StorageEvent) => {
      if (event.key === PICTURE_BOOK_KEY || event.key === null) { setFailure('changed'); setPlaying(false); setMode('arrange'); }
    };
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('storage', changed); node?.close(); if (active?.isConnected) active.focus(); };
  }, [open]);

  useEffect(() => {
    if (!open || mode !== 'show' || !playing || locked || pages.length < 2) return;
    if (index >= pages.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex(value => Math.min(value + 1, pages.length - 1)), STORY_PAGE_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [open, mode, playing, index, pages.length, locked]);
  useEffect(() => {
    if (!open) return;
    if (mode === 'show') stage.current?.focus();
    else if (!dialog.current?.contains(document.activeElement)) titleInput.current?.focus();
  }, [open, mode]);
  useEffect(() => {
    if (!open) return;
    const hide = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [open]);
  useEffect(() => {
    const urls = downloads.current;
    return () => { for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); } urls.clear(); };
  }, []);

  function choose(entry: PictureBookEntry) {
    if (locked) return;
    const removing = pages.some(page => page.id === entry.id);
    const next = toggleStoryPage(pages, entry);
    setPages(next); setNotice(removing ? 'removed' : null);
    if (!removing) setActiveId(entry.id);
    else if (activeId === entry.id) setActiveId(next[0]?.id ?? null);
  }
  function turn(offset: -1 | 1) { setPlaying(false); setIndex(value => Math.max(0, Math.min(pages.length - 1, value + offset))); }
  function keyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // The dialog owns its keyboard; Space must never reach the microphone.
    event.stopPropagation();
    if (mode !== 'show' || locked || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); if (!event.repeat) turn(event.key === 'ArrowLeft' ? -1 : 1); }
    if ((event.key === ' ' || event.key === 'Enter') && !target.closest('button,a')) { event.preventDefault(); if (!event.repeat) turn(1); }
  }
  function download() {
    if (locked || !pages.length) return;
    let url: string | null = null;
    try {
      const html = exportStoryHtml(title || text.untitled, pages, language);
      url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = storyDownloadName(title || text.untitled);
      document.body.appendChild(link); link.click(); link.remove();
      const captured = url;
      downloads.current.set(captured, setTimeout(() => { URL.revokeObjectURL(captured); downloads.current.delete(captured); }, 30000));
      setNotice('downloaded');
    } catch { if (url) URL.revokeObjectURL(url); setNotice('downloadFailed'); }
  }

  return <dialog ref={dialog} className="studio-extra-dialog story-theatre" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={keyDown}
    onCancel={event => { event.preventDefault(); setPlaying(false); closing.current(); }}>
    <div className="studio-extra-heading"><div><span className="studio-extra-eyebrow"><Film size={17}/>Wonderline</span><h2 id={titleId}>{text.title}</h2><p id={descriptionId}>{text.subtitle}</p></div><button className="studio-extra-close" aria-label={text.close} onClick={() => { setPlaying(false); onClose(); }} autoFocus><X size={20}/></button></div>
    {failure && <p className="story-theatre-warning" role="alert">{text[failure]}</p>}
    {!pictures.length && !locked ? <div className="picture-book-empty"><BookOpen size={48} strokeWidth={1.2}/><h3>{text.empty}</h3><p>{text.emptyHint}</p></div> : !locked && <>
      {mode === 'arrange' ? <>
        <label className="story-theatre-title" htmlFor={storyTitleId}>{text.storyTitle}<input ref={titleInput} id={storyTitleId} value={title} placeholder={text.untitled} maxLength={STORY_TITLE_LIMIT} onChange={event => setTitle(storyText(event.target.value, STORY_TITLE_LIMIT, false))}/></label>
        <section className="story-theatre-chooser" aria-label={text.choose}><h3>{text.choose}</h3><p>{text.chooseHint}</p><div className="story-theatre-pictures">{pictures.map(entry => {
          const order = pages.findIndex(page => page.id === entry.id);
          return <button key={entry.id} className="story-theatre-pick" aria-pressed={order >= 0} aria-label={`${pictureTitle(entry.scene.title)}${order >= 0 ? `, ${pageLabel(order + 1)}` : ''}`} onClick={() => choose(entry)}>
            <img src={entry.thumbnail} alt="" width="320" height="200" loading="lazy"/><span className="story-theatre-picture-title">{pictureTitle(entry.scene.title)}</span>{order >= 0 && <span className="story-theatre-order" aria-hidden="true">{order + 1}</span>}
          </button>;
        })}</div></section>
        {pages.length ? <section className="story-theatre-editor" aria-label={text.selected}>
          <div className="story-theatre-strip">{pages.map((page, order) => <button key={page.id} aria-pressed={current?.id === page.id} onClick={() => setActiveId(page.id)} aria-label={`${pageLabel(order + 1)}: ${pictureTitle(page.title)}`}><span>{order + 1}</span>{current?.id === page.id && <Check size={14}/>}</button>)}</div>
          {current && <div className="story-theatre-page-editor"><div className="story-theatre-edit-image"><img src={current.thumbnail} alt={pictureTitle(current.title)} width="320" height="200"/><div className="story-theatre-reorder"><button disabled={currentIndex <= 0} aria-label={text.earlier} onClick={() => setPages(moveStoryPage(pages, current.id, -1))}><ArrowLeft size={18}/>{text.earlier}</button><button disabled={currentIndex >= pages.length - 1} aria-label={text.later} onClick={() => setPages(moveStoryPage(pages, current.id, 1))}>{text.later}<ArrowRight size={18}/></button></div></div><div className="story-theatre-caption-editor"><label htmlFor={captionId}>{text.caption}</label><textarea id={captionId} rows={5} maxLength={STORY_CAPTION_LIMIT} value={current.caption} aria-describedby={captionHintId} onChange={event => setPages(editStoryCaption(pages, current.id, event.target.value))}/><p id={captionHintId}>{text.captionHint}</p></div></div>}
        </section> : <p className="story-theatre-prompt">{text.none}</p>}
      </> : <div className="story-theatre-show">
        <h3>{title.trim() || text.untitled}</h3>
        {current && <figure ref={stage} className="story-theatre-stage" tabIndex={0} aria-label={`${pageLabel(index + 1)}: ${pictureTitle(current.title)}`}><img src={current.thumbnail} alt={pictureTitle(current.title)} width="320" height="200"/><figcaption>{current.caption}</figcaption></figure>}
        <div className="story-theatre-navigation"><button disabled={index <= 0} onClick={() => turn(-1)} aria-label={text.previous}><ArrowLeft size={21}/><span>{text.previous}</span></button><span aria-live="polite">{index + 1} / {pages.length}</span><button disabled={index >= pages.length - 1} onClick={() => turn(1)} aria-label={text.next}><span>{text.next}</span><ArrowRight size={21}/></button></div>
        <div className="story-theatre-playback"><button disabled={pages.length < 2} aria-pressed={playing} onClick={() => { if (!playing && index >= pages.length - 1) setIndex(0); setPlaying(value => !value); }}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? text.pause : text.auto}</button>{index === pages.length - 1 && <p>{text.finished}</p>}</div>
      </div>}
      <div className="story-theatre-actions">{mode === 'arrange' ? <button className="studio-extra-primary" disabled={!pages.length} onClick={() => { setMode('show'); setIndex(0); setPlaying(false); setNotice(null); }}><Play size={18}/>{text.show}</button> : <button className="story-theatre-secondary" onClick={() => { setMode('arrange'); setPlaying(false); setActiveId(current?.id ?? null); }}><ArrowLeft size={18}/>{text.back}</button>}<button className="story-theatre-secondary" disabled={!pages.length} onClick={download}><Download size={18}/>{text.download}</button></div>
    </>}
    <div className="story-theatre-notice" aria-live="polite">{notice && <p>{text[notice]}</p>}</div>
    <p className="picture-book-privacy">{text.privacy}</p>
  </dialog>;
}
