import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const names = ['story-theatre', 'picture-book', 'scene-validation'];
const files = names.map(name => new URL(`../.sites-runtime/theatre-test-${name}.mjs`, import.meta.url));
const componentFile = new URL('../.sites-runtime/theatre-test-component.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
for (const [index, name] of names.entries()) {
  const compiled = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll("'./scene-validation'", "'./theatre-test-scene-validation.mjs'").replaceAll("'./picture-book'", "'./theatre-test-picture-book.mjs'");
  await writeFile(files[index], compiled);
}
const source = await readFile(new URL('../components/StoryTheatre.tsx', import.meta.url), 'utf8');
await writeFile(componentFile, ts.transpileModule(source.replaceAll(/import '\.\/[^']+\.css';/g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replaceAll("'../lib/picture-book'", "'./theatre-test-picture-book.mjs'").replaceAll("'../lib/story-theatre'", "'./theatre-test-story-theatre.mjs'"));
after(() => Promise.all([...files, componentFile].map(file => unlink(file))));
const { storyText, pictureStoryPage, reconcileStoryPages, toggleStoryPage, moveStoryPage, editStoryCaption, exportStoryHtml, storyDownloadName, STORY_PAGE_SECONDS, STORY_TITLE_LIMIT, STORY_CAPTION_LIMIT } = await import(files[0].href);
const { default: StoryTheatre } = await import(componentFile.href);
const thumbnail = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE2kAAAAASUVORK5CYII=';
const entry = (id = 'one') => ({ id, createdAt: 100, scene: { title: 'A little garden', objects: [{ id: 'tree', kind: 'tree', x: 200, y: 150, scale: 1, color: '#339955' }] }, style: 'crayon', thumbnail, conversation: [{ id: 'voice:one', kind: 'voice', text: 'A tree grows here.', partial: 'a scary unfinished hypothesis', status: 'saved', createdAt: 100, updatedAt: 100, omittedRanges: [{ start: 2, end: 5 }] }, { id: 'typed:two', kind: 'text', text: 'A flower beside the tree.', partial: '', status: 'saved', createdAt: 200, updatedAt: 200 }] });
const page = (id = 'one') => pictureStoryPage(entry(id));

test('a story page copies only its preview, title and stable already-filtered words', () => {
  const original = entry(), before = JSON.stringify(original);
  const result = pictureStoryPage(original);
  assert.deepEqual(Object.keys(result).sort(), ['caption', 'id', 'thumbnail', 'title']);
  assert.equal(result.caption, 'A tree grows here.\nA flower beside the tree.');
  assert.doesNotMatch(result.caption, /hypothesis/);
  assert.equal(JSON.stringify(original), before);
  assert.equal(result.thumbnail, thumbnail);
});

test('empty and omitted transcript entries do not resurrect words in a story', () => {
  const original = entry();
  original.conversation = [{ ...original.conversation[0], text: '', partial: 'never include me' }];
  assert.equal(pictureStoryPage(original).caption, '');
});

test('English, Chinese, emoji and line breaks survive display copies', () => {
  assert.equal(storyText('  花园 🌸\r\nHello, 世界!  ', 100), '花园 🌸\nHello, 世界!');
  assert.equal(storyText('🦊', 1), '');
  assert.equal(storyText('A🦊B', 3), 'A🦊');
  assert.equal(storyText('A🦊B', 2), 'A');
});

test('control characters and overlong captions cannot inflate story output', () => {
  assert.equal(storyText('\0A\x07\tB\nC\x7f', 100), 'A\tB\nC');
  const original = entry(); original.scene.title = 't'.repeat(200); original.conversation[0].text = 'a'.repeat(2000);
  assert.equal(pictureStoryPage(original).title.length, STORY_TITLE_LIMIT);
  assert.equal(pictureStoryPage(original).caption.length, STORY_CAPTION_LIMIT);
});

test('selecting pictures follows child-selected order and never edits the gallery', () => {
  const pictures = [entry('one'), entry('two'), entry('three')], before = JSON.stringify(pictures);
  const selected = toggleStoryPage(toggleStoryPage([], pictures[2]), pictures[0]);
  assert.deepEqual(selected.map(page => page.id), ['three', 'one']);
  assert.equal(JSON.stringify(pictures), before);
});

test('deselect removes only that story page; reselect appends to the story', () => {
  const start = [page('one'), page('two'), page('three')];
  const next = toggleStoryPage(start, entry('two'));
  assert.deepEqual(next.map(page => page.id), ['one', 'three']);
  assert.deepEqual(toggleStoryPage(next, entry('two')).map(page => page.id), ['one', 'three', 'two']);
  assert.deepEqual(start.map(page => page.id), ['one', 'two', 'three']);
});

test('story selection remains bounded at twelve pages', () => {
  const pages = Array.from({ length: 12 }, (_, i) => page(`p${i}`));
  assert.deepEqual(toggleStoryPage(pages, entry('extra')), pages);
  assert.equal(toggleStoryPage(pages, entry('p1')).length, 11);
});

test('reorder moves exactly one page, preserving captions and input references', () => {
  const pages = [page('one'), page('two'), page('three')];
  const next = moveStoryPage(pages, 'two', 1);
  assert.deepEqual(next.map(page => page.id), ['one', 'three', 'two']);
  assert.equal(next[2], pages[1]);
  assert.deepEqual(moveStoryPage(next, 'two', -1), pages);
  assert.deepEqual(pages.map(page => page.id), ['one', 'two', 'three']);
});

test('boundary, absent and invalid moves leave all pages in place', () => {
  const pages = [page('one'), page('two')];
  for (const [id, offset] of [['one', -1], ['two', 1], ['missing', 1], ['one', 0], ['one', 99]]) assert.deepEqual(moveStoryPage(pages, id, offset), pages);
});

test('caption editing only changes a display copy and permits normal typing spaces', () => {
  const original = entry(), first = pictureStoryPage(original), other = page('two');
  const result = editStoryCaption([first, other], 'one', 'A new ');
  assert.equal(result[0].caption, 'A new ');
  assert.equal(result[1], other);
  assert.equal(original.conversation[0].text, 'A tree grows here.');
  assert.notEqual(first.caption, 'A new ');
  assert.equal(editStoryCaption(result, 'one', '')[0].caption, '');
});

test('caption edit length and Unicode bounds stay safe', () => {
  assert.equal(editStoryCaption([page()], 'one', 'x'.repeat(800))[0].caption.length, STORY_CAPTION_LIMIT);
  const text = 'a'.repeat(STORY_CAPTION_LIMIT - 1) + '🌸';
  assert.equal(editStoryCaption([page()], 'one', text)[0].caption.length, STORY_CAPTION_LIMIT - 1);
  assert.equal(storyText('  typing ', 80, false), '  typing ');
});

test('reopening preserves selected order and draft caption while refreshing source previews', () => {
  const pages = [page('two'), page('one')]; pages[0].caption = 'My new ending';
  const pictures = [entry('one'), entry('two'), entry('three')]; pictures[1].scene.title = 'Updated title';
  const result = reconcileStoryPages(pages, pictures);
  assert.deepEqual(result.map(page => page.id), ['two', 'one']);
  assert.equal(result[0].caption, 'My new ending');
  assert.equal(result[0].title, 'Updated title');
  assert.equal(pictures[1].conversation[0].text, 'A tree grows here.');
});

test('pictures removed from gallery cannot silently remain in a reopened story', () => {
  assert.deepEqual(reconcileStoryPages([page('one'), page('two')], [entry('two')]).map(page => page.id), ['two']);
  assert.deepEqual(reconcileStoryPages([page()], []), []);
});

test('reconciliation does not auto-add pictures or duplicate selected pages', () => {
  assert.deepEqual(reconcileStoryPages([], [entry()]), []);
  assert.deepEqual(reconcileStoryPages([page(), page()], [entry()]), [page()]);
});

test('reconciliation retains at most twelve pages even with malformed in-memory input', () => {
  const pictures = Array.from({ length: 14 }, (_, i) => entry(`p${i}`));
  assert.equal(reconcileStoryPages(pictures.map(pictureStoryPage), pictures).length, 12);
});

test('offline HTML contains every selected page in chosen order and simple navigation', () => {
  const html = exportStoryHtml('Our garden', [page('second'), page('first')], 'en');
  assert.match(html, /<html lang="en">/); assert.match(html, /Our garden · Wonderline/);
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.ok(html.indexOf('id="page-1"') < html.indexOf('id="page-2"'));
  assert.match(html, /href="#page-2">Next/); assert.match(html, /href="#page-1">← Previous/);
  assert.match(html, /picturebook previews/); assert.match(html, /Opens offline/);
});

test('offline book is script-free and self-contained with restrictive CSP', () => {
  const html = exportStoryHtml('Story', [page()], 'en');
  assert.doesNotMatch(html, /<script|<iframe|<object|<embed|<link|<form|https?:\/\//i);
  assert.match(html, /default-src 'none'/); assert.match(html, /script-src 'none'/); assert.match(html, /img-src data:/);
  const links = [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1]);
  assert.ok(links.every(link => /^#(?:cover|page-\d+)$/.test(link)));
});

test('captions, titles and alt text cannot inject HTML or scripts into export', () => {
  const payload = '</figcaption><script>alert("x")</script><img src=x onerror=alert(1)> & \'quote\'';
  const malicious = { ...page(), title: payload, caption: payload };
  const html = exportStoryHtml(payload, [malicious], 'en');
  assert.doesNotMatch(html, /<script|<img src=x|<\/figcaption><script/i);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /&quot;/); assert.match(html, /&#39;/); assert.match(html, /&amp;/);
  assert.equal((html.match(/<img /g) || []).length, 1);
});

test('style-closing tags, event attributes, SVG and HTML entities remain inert text', () => {
  const payloads = ['</style><script>fetch("https://example.com")</script>', '<svg><animate onbegin="alert(1)"/></svg>', '\" onerror=\"alert(1)', '&lt;script&gt;alert(1)&lt;/script&gt;', '<meta http-equiv="refresh" content="0;url=https://example.com">'];
  for (const payload of payloads) {
    const html = exportStoryHtml(payload, [{ ...page(), caption: payload, title: payload }], 'en');
    assert.equal((html.match(/<style>/g) || []).length, 1);
    assert.equal((html.match(/<\/style>/g) || []).length, 1);
    assert.doesNotMatch(html, /<script|<svg|<animate|<meta http-equiv="refresh"|\bsrc="https?:/i);
    assert.equal((html.match(/<img /g) || []).length, 1);
  }
});

test('twelve caption-heavy pages stay bounded, with no hidden conversation export', () => {
  const pages = Array.from({ length: 12 }, (_, index) => ({ ...page(`p${index}`), title: '&'.repeat(200), caption: '&'.repeat(100000) }));
  const html = exportStoryHtml('&'.repeat(100000), pages, 'en');
  assert.equal((html.match(/<article /g) || []).length, 12);
  assert.ok(html.length < 70000);
  assert.equal([...html.matchAll(/<figcaption>([^<]*)<\/figcaption>/g)].every(match => match[1].length === STORY_CAPTION_LIMIT * 5), true);
});

test('source scene, unconfirmed transcript and original IDs are absent from export', () => {
  const html = exportStoryHtml('Story', [page('private-source-id')], 'en');
  assert.doesNotMatch(html, /private-source-id|omittedRanges|scary unfinished|objects|sessionId|scene:/);
});

test('remote, SVG, malformed and oversized images fail closed', () => {
  for (const value of ['https://example.com/image.png', 'data:image/svg+xml,<svg onload="alert(1)">', 'data:image/png;base64,Zm9v', thumbnail + '" onerror="alert(1)', 'data:image/png;base64,' + 'A'.repeat(400000)]) {
    assert.throws(() => exportStoryHtml('Story', [{ ...page(), thumbnail: value }], 'en'), /Invalid story image/);
  }
});

test('zero, too many or duplicate pages cannot export an invalid book', () => {
  assert.throws(() => exportStoryHtml('Story', [], 'en'), /Invalid story pages/);
  assert.throws(() => exportStoryHtml('Story', [page(), page()], 'en'), /Invalid story pages/);
  assert.throws(() => exportStoryHtml('Story', Array.from({ length: 13 }, (_, i) => page(`p${i}`)), 'en'), /Invalid story pages/);
});

test('Chinese offline book has localized navigation and preserves child text', () => {
  const html = exportStoryHtml('森林里的小狐狸 🦊', [{ ...page(), caption: '小狐狸找到了朋友。\n我们一起回家。' }, page('two')], 'zh');
  assert.match(html, /lang="zh-CN"/); assert.match(html, /森林里的小狐狸 🦊/); assert.match(html, /小狐狸找到了朋友。\n我们一起回家。/);
  assert.match(html, /下一页/); assert.match(html, /上一页/); assert.match(html, /小画册里的预览图/);
});

test('empty titles receive a language-appropriate title and a safe filename', () => {
  assert.match(exportStoryHtml('', [page()], 'en'), /<title>My little story/);
  assert.match(exportStoryHtml('', [page()], 'zh'), /<title>我的小故事/);
  assert.equal(storyDownloadName(''), 'Wonderline-story.html');
  assert.equal(storyDownloadName('../my:story?*'), '-my-story--.html');
  assert.equal(storyDownloadName('森林 🦊'), '森林 🦊.html');
  assert.ok(storyDownloadName('x'.repeat(200)).length <= 53);
  assert.doesNotMatch(storyDownloadName('a\\b/c<d>e|f'), /[\\/<>|]/);
});

test('export includes print rules without automatic printing or autoplay', () => {
  const html = exportStoryHtml('Story', [page()], 'en');
  assert.match(html, /@media print/); assert.match(html, /break-after:page/);
  assert.doesNotMatch(html, /window\.print|autoplay|setInterval|setTimeout|<audio|<video/);
});

test('dialog is localized, accessible and explains local preview-only persistence', () => {
  const en = renderToStaticMarkup(createElement(StoryTheatre, { open: false, language: 'en', onClose() {} }));
  const zh = renderToStaticMarkup(createElement(StoryTheatre, { open: false, language: 'zh', onClose() {} }));
  for (const html of [en, zh]) { assert.match(html, /<dialog/); assert.match(html, /aria-labelledby=/); assert.match(html, /aria-describedby=/); assert.match(html, /aria-live="polite"/); }
  assert.match(en, /Story theatre/); assert.match(en, /until you reload/); assert.match(en, /picturebook previews/);
  assert.match(zh, /故事小剧场/); assert.match(zh, /标签页刷新前/); assert.match(zh, /预览图/);
});

test('theatre uses no network, synthesis, source-scene editing or gallery writes', () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|AudioContext|speechSynthesis|requestImagine|startStreaming|setItem\(|storePictureBook\(|SceneCanvas/);
  assert.match(source, /loadPictureBook\(localStorage\)/);
  assert.match(source, /reconcileStoryPages/);
});

test('playback begins paused, owns Space, stops when hidden and clears timers', () => {
  assert.equal(STORY_PAGE_SECONDS, 6);
  assert.match(source, /\[playing, setPlaying\] = useState\(false\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /document\.hidden\) setPlaying\(false\)/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /index >= pages\.length - 1/);
  assert.match(source, /URL\.revokeObjectURL/);
});
