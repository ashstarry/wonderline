import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const source = await readFile(new URL('../components/CompanionCanvasPicker.tsx', import.meta.url), 'utf8');
const file = new URL('../.sites-runtime/companion-canvas-picker-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = ts.transpileModule(source.replaceAll(/import '\.\/[^']+\.css';/g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace("import { COMPANION_NAME_LIMIT } from '../lib/story-companions';", 'const COMPANION_NAME_LIMIT = 24;');
await writeFile(file, compiled);
after(() => unlink(file));
const { default: Picker, companionPickRect } = await import(file.href);
const viewport = { x: -100, y: -20, width: 1200, height: 680 };
const candidates = [
  { id: 'bear', label: 'Little bear', bounds: { x: 100, y: 100, width: 120, height: 200 } },
  { id: 'princess', label: 'Princess', bounds: { x: 500, y: 120, width: 130, height: 250 } },
];
const props = { active: true, language: 'en', candidates, viewport, disabled: false, onCancel() {}, async onSave() { return true; } };
const render = overrides => renderToStaticMarkup(createElement(Picker, { ...props, ...overrides }));

test('inactive picking renders nothing, including no invisible name dialog', () => {
  assert.equal(render({ active: false, initialObjectId: 'bear' }), '');
});
test('direct canvas picking uses native named buttons for only supplied eligible objects', () => {
  const html = render({});
  assert.equal((html.match(/data-companion-choice=/g) || []).length, 2);
  assert.match(html, /aria-label="Keep as a companion: Little bear"/);
  assert.match(html, /aria-label="Keep as a companion: Princess"/);
  assert.doesNotMatch(html, /<select|<option|<input|<dialog/);
  assert.match(html, /Tap a character to keep as a companion/);
  assert.match(html, /viewBox="-100 -20 1200 680"/);
});
test('an existing eligible selection skips directly to one labeled naming field', () => {
  const html = render({ initialObjectId: 'bear' });
  assert.match(html, /<dialog[^>]*aria-labelledby=/);
  assert.match(html, /aria-describedby=/);
  assert.equal((html.match(/<input /g) || []).length, 1);
  assert.equal((html.match(/<label /g) || []).length, 1);
  assert.match(html, /maxLength="24"/);
  assert.match(html, /aria-label="Back to the picture"/);
  assert.match(html, /Choose another/);
  assert.match(html, /class="companion-name-save" type="submit" disabled=""/);
  assert.doesNotMatch(html, /<select|<option/);
});
test('selection-first naming presents only the already chosen character, with no second selection step', () => {
  for (const [language, title, label] of [['en', 'What’s their name?', 'Their name'], ['zh', '它叫什么名字？', '伙伴的名字']]) {
    const html = render({ selectionFirst: true, initialObjectId: 'bear', language });
    assert.match(html, /<dialog[^>]*aria-labelledby=/);
    assert.equal((html.match(/<input /g) || []).length, 1);
    assert.ok(html.includes(title));
    assert.ok(html.includes(label));
    assert.match(html, /class="companion-name-close"/);
    assert.match(html, /class="companion-name-back"/);
    assert.doesNotMatch(html, /companion-picker-rings|companion-picker-target|companion-picker-guide|data-companion-choice|Tap a character|点一下画里的角色|<select|<option/);
    const wrapper = html.match(/^<div[^>]*>/)?.[0];
    assert.ok(wrapper.includes('aria-label='));
    assert.doesNotMatch(wrapper, /aria-labelledby=/, 'the removed picker guide must not remain an accessibility label target');
  }
});
test('selection-first busy state keeps a way back without exposing alternate targets', () => {
  const html = render({ selectionFirst: true, initialObjectId: 'bear', disabled: true });
  assert.match(html, /<input[^>]*disabled=""/);
  assert.match(html, /class="companion-name-save"[^>]*disabled=""/);
  assert.doesNotMatch(html, /class="companion-name-(?:close|back)"[^>]*disabled/);
  assert.doesNotMatch(html, /data-companion-choice|companion-picker-guide|companion-picker-rings/);
});
test('selection-first rejects stale or offscreen selections without an invisible paper-blocking overlay', () => {
  for (const initialObjectId of ['removed', 'background', '', null]) {
    assert.equal(render({ selectionFirst: true, initialObjectId }), '');
  }
  assert.equal(render({ selectionFirst: true, initialObjectId: 'bear', candidates: [{ ...candidates[0], bounds: { x: 2000, y: 120, width: 100, height: 100 } }] }), '');
});
test('selection-first back control describes returning to the picture, not a hidden picker', () => {
  for (const [language, close, oldPickerAction] of [['en', 'Back to the picture', 'Choose another'], ['zh', '返回画面', '重新选一个']]) {
    const html = render({ selectionFirst: true, initialObjectId: 'bear', language });
    assert.ok(html.includes(`>${close}</button>`));
    assert.ok(!html.includes(oldPickerAction));
  }
});
test('leaving selection-first naming exits to the ordinary canvas instead of reopening a selection overlay', () => {
  assert.match(source, /const backToPicture\s*=\s*\(\)\s*=>\s*\{\s*if\s*\(inFlight\.current\)\s*return;\s*if\s*\(selectionFirst\)\s*\{\s*onCancel\(\);\s*return;\s*\}/);
  assert.match(source, /className="companion-name-back"[^>]*onClick=\{backToPicture\}/);
  assert.match(source, /onCancel=\{event => \{ event\.preventDefault\(\); backToPicture\(\); \}\}/);
});
test('stale or ineligible initial selection returns to canvas picking, never another character', () => {
  for (const initialObjectId of ['removed', 'background', '', null]) {
    assert.doesNotMatch(render({ initialObjectId }), /<dialog|<input/);
  }
});
test('Chinese direct picking and naming are localized', () => {
  const html = render({ language: 'zh', initialObjectId: 'princess' });
  for (const phrase of ['点一下画里的角色', '它叫什么名字', '伙伴的名字', '保存伙伴', '重新选一个']) assert.ok(html.includes(phrase));
  assert.doesNotMatch(html, /Keep as a companion|What’s their name|Their name|Choose another/);
});
test('busy state disables character choice and saving but keeps cancellation available', () => {
  const html = render({ disabled: true, initialObjectId: 'bear' });
  assert.equal((html.match(/data-companion-choice="[^"]+"[^>]*disabled=""/g) || []).length, 2);
  assert.match(html, /<input[^>]*disabled=""/);
  assert.doesNotMatch(html, /class="companion-name-close"[^>]*disabled/);
});
test('an empty candidate list explains the first step without opening a form', () => {
  const html = render({ candidates: [] });
  assert.match(html, /Draw a character first/);
  assert.doesNotMatch(html, /data-companion-choice|<input|<dialog/);
});
test('candidate labels and supplied errors are escaped, not rendered as HTML', () => {
  const html = render({ candidates: [{ ...candidates[0], label: '<img src=x onerror=evil()>' }], initialObjectId: 'bear', error: '<script>bad()</script>' });
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;script/);
});
test('pick geometry honors translated and expanded paper coordinates', () => {
  const original = structuredClone(candidates[0].bounds), paper = structuredClone(viewport);
  const rect = companionPickRect(original, paper);
  assert.equal(rect.left, 200 / 1200 * 100);
  assert.equal(rect.top, 120 / 680 * 100);
  assert.equal(rect.widthPercent, 10);
  assert.deepEqual(original, candidates[0].bounds);
  assert.deepEqual(paper, viewport);
});
test('partly offscreen bounds clip hit area without changing character geometry', () => {
  const rect = companionPickRect({ x: -160, y: -80, width: 100, height: 100 }, viewport);
  assert.equal(rect.x, -100); assert.equal(rect.y, -20);
  assert.equal(rect.width, 40); assert.equal(rect.height, 40);
  assert.equal(rect.left, 0); assert.equal(rect.top, 0);
});
test('invalid, degenerate, and entirely offscreen bounds cannot become hit targets', () => {
  const cases = [
    { x: 0, y: 0, width: 0, height: 10 }, { x: 0, y: 0, width: -10, height: 10 },
    { x: NaN, y: 0, width: 10, height: 10 }, { x: 0, y: Infinity, width: 10, height: 10 },
    { x: 1200, y: 0, width: 10, height: 10 }, { x: -200, y: 0, width: 10, height: 10 },
    { x: 0, y: 800, width: 10, height: 10 },
  ];
  for (const bounds of cases) assert.equal(companionPickRect(bounds, viewport), null);
  assert.equal(companionPickRect(candidates[0].bounds, { ...viewport, width: 0 }), null);
  assert.doesNotMatch(render({ candidates: cases.map((bounds, index) => ({ id: `${index}`, label: 'Bad geometry', bounds })) }), /data-companion-choice/);
});
test('picker does not own microphone, scene updates, model calls, or storage', () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|AudioContext|localStorage|requestImagine|startStreaming|getUserMedia|setScene\(/);
  assert.match(source, /onCancel=\{event => \{ event\.preventDefault\(\); backToPicture\(\); \}\}/);
  assert.match(source, /onKeyDown=\{event => event\.stopPropagation\(\)\}/);
});
