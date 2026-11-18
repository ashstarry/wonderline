import { PICTURE_BOOK_LIMIT, validPictureThumbnail, type PictureBookEntry } from './picture-book';

export const STORY_TITLE_LIMIT = 80;
export const STORY_CAPTION_LIMIT = 600;
export const STORY_PAGE_SECONDS = 6;
export type StoryPage = { id: string; title: string; thumbnail: string; caption: string };
export type StoryLanguage = 'en' | 'zh';

/** These are display copies. No scene, transcript, or picturebook is rewritten. */
export function storyText(value: string, limit: number, trim = true): string {
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  const clean = trim ? normalized.trim() : normalized;
  const end = Math.max(0, Math.floor(limit));
  const clipped = clean.slice(0, end);
  return /[\uD800-\uDBFF]$/.test(clipped) ? clipped.slice(0, -1) : clipped;
}

export function pictureStoryPage(entry: PictureBookEntry): StoryPage {
  // Stable display text already has omissions applied. Do not include partial
  // ASR hypotheses, or apply original transcript offsets a second time.
  const caption = entry.conversation.map(part => part.text.trim()).filter(Boolean).join('\n');
  return { id: entry.id, title: storyText(entry.scene.title, STORY_TITLE_LIMIT), thumbnail: entry.thumbnail, caption: storyText(caption, STORY_CAPTION_LIMIT) };
}

export function reconcileStoryPages(pages: readonly StoryPage[], entries: readonly PictureBookEntry[]): StoryPage[] {
  const pictures = new Map(entries.map(entry => [entry.id, entry]));
  const used = new Set<string>();
  return pages.flatMap(page => {
    const entry = pictures.get(page.id);
    if (!entry || used.has(page.id) || used.size >= PICTURE_BOOK_LIMIT) return [];
    used.add(page.id);
    return [{ ...pictureStoryPage(entry), caption: storyText(page.caption, STORY_CAPTION_LIMIT) }];
  });
}

export function toggleStoryPage(pages: readonly StoryPage[], entry: PictureBookEntry): StoryPage[] {
  if (pages.some(page => page.id === entry.id)) return pages.filter(page => page.id !== entry.id);
  if (pages.length >= PICTURE_BOOK_LIMIT) return [...pages];
  return [...pages, pictureStoryPage(entry)];
}

export function moveStoryPage(pages: readonly StoryPage[], id: string, offset: -1 | 1): StoryPage[] {
  const index = pages.findIndex(page => page.id === id), destination = index + offset;
  const next = [...pages];
  if (index < 0 || destination < 0 || destination >= pages.length || (offset !== -1 && offset !== 1)) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function editStoryCaption(pages: readonly StoryPage[], id: string, caption: string): StoryPage[] {
  return pages.map(page => page.id === id ? { ...page, caption: storyText(caption, STORY_CAPTION_LIMIT, false) } : page);
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
export function storyDownloadName(title: string): string {
  const name = storyText(title, 48).replace(/[<>:"/\\|?*]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '');
  return `${name || 'Wonderline-story'}.html`;
}

/** Script-free, self-contained reader. The only images allowed are the small
 * validated PNG previews; no source scene, hidden transcript, or keys leave. */
export function exportStoryHtml(title: string, pages: readonly StoryPage[], language: StoryLanguage): string {
  if (!pages.length || pages.length > PICTURE_BOOK_LIMIT || new Set(pages.map(page => page.id)).size !== pages.length) throw new Error('Invalid story pages');
  if (pages.some(page => !validPictureThumbnail(page.thumbnail))) throw new Error('Invalid story image');
  const zh = language === 'zh';
  const safeTitle = escapeHtml(storyText(title, STORY_TITLE_LIMIT) || (zh ? '我的小故事' : 'My little story'));
  const pageLabel = (index: number) => zh ? `第 ${index + 1} 页` : `Page ${index + 1}`;
  const articles = pages.map((page, index) => `<article id="page-${index + 1}" aria-labelledby="title-${index + 1}">
    <div class="page-count">${index + 1} / ${pages.length}</div>
    <h2 id="title-${index + 1}">${escapeHtml(storyText(page.title, STORY_TITLE_LIMIT) || pageLabel(index))}</h2>
    <figure><img src="${page.thumbnail}" alt="${escapeHtml(storyText(page.title, STORY_TITLE_LIMIT) || pageLabel(index))}"><figcaption>${escapeHtml(storyText(page.caption, STORY_CAPTION_LIMIT))}</figcaption></figure>
    <nav aria-label="${zh ? '翻页' : 'Turn pages'}">${index ? `<a href="#page-${index}">← ${zh ? '上一页' : 'Previous'}</a>` : '<span></span>'}<a href="#cover">${zh ? '回到封面' : 'Back to cover'}</a>${index < pages.length - 1 ? `<a href="#page-${index + 2}">${zh ? '下一页' : 'Next'} →</a>` : '<span></span>'}</nav>
  </article>`).join('\n');
  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><title>${safeTitle} · Wonderline</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#f4f0e5;color:#435c43;font-family:ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif;line-height:1.6}header,article{width:min(900px,100%);margin:0 auto 28px;padding:32px;background:#fffdf5;border:1px solid #dde4d0;border-radius:22px}header{text-align:center;padding:52px 24px}h1{font-size:clamp(26px,5vw,44px);line-height:1.25;overflow-wrap:anywhere}h2{font-size:20px;margin:4px 0 20px;overflow-wrap:anywhere}header p,.page-count{font-size:13px;color:#73836b}.contents{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:26px}a{color:#486942;text-decoration:none;border:1px solid #d5dfc5;border-radius:12px;padding:10px 14px;background:#f0f5e5;min-height:44px}.contents a{min-width:44px}a:focus-visible{outline:3px solid #738f5d;outline-offset:3px}figure{margin:0}img{display:block;width:100%;max-height:65vh;object-fit:contain;background:#f9f2df;border-radius:12px}figcaption{white-space:pre-wrap;overflow-wrap:anywhere;font-size:clamp(16px,2.6vw,22px);margin:22px 0;line-height:1.7}nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:24px;font-size:13px}footer{text-align:center;color:#7c8871;font-size:12px}@media(max-width:480px){body{padding:12px}header,article{padding:20px;border-radius:16px}nav a{padding:9px 8px;font-size:12px}}@media print{body{padding:0;background:white}header,article{border:0;border-radius:0;break-after:page;box-shadow:none;margin:0;padding:20mm 10mm;max-width:none;min-height:230mm}nav,.contents,footer{display:none}img{max-height:160mm}figcaption{font-size:18px;line-height:1.5}}
</style></head><body><header id="cover"><p>Wonderline · ${zh ? '故事小剧场' : 'Story theatre'}</p><h1>${safeTitle}</h1><p>${zh ? '用小画册里的预览图，装订一段自己的故事。' : 'A little story, made from your picturebook previews.'}</p><div class="contents" aria-label="${zh ? '故事页码' : 'Story pages'}">${pages.map((_, index) => `<a href="#page-${index + 1}" aria-label="${pageLabel(index)}">${index + 1}</a>`).join('')}</div></header>
${articles}<footer>${zh ? '保存在这个文件里，离线也能打开。' : 'Kept inside this file. Opens offline, too.'}</footer></body></html>`;
}
