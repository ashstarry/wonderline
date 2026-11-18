import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

// Exercise the presentation independently of the full canvas engine and storage.
// Those have their own geometry/mask tests; this stub exposes preview settings.
const source = await readFile(new URL('../components/CompanionShelf.tsx', import.meta.url), 'utf8');
const file = new URL('../.sites-runtime/companion-shelf-test-component.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compiled = ts.transpileModule(source.replaceAll(/import '\.\/[^']+\.css';/g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText.replace(/import \{[^;]+ from '\.\.\/lib\/story-companions';/, 'const COMPANION_LIMIT = 8, COMPANION_NAME_LIMIT = 24; const companionScene = entry => ({ title: entry.name, objects: [entry.object] });')
  .replace("import SceneCanvas from './SceneCanvas';", `import { createElement } from 'react'; const SceneCanvas = props => createElement('svg', { 'data-preview': props.scene.title, 'data-motion': props.motionMode, 'data-sound': String(props.soundEnabled), 'data-style': props.style, viewBox: props.viewport ? [props.viewport.x, props.viewport.y, props.viewport.width, props.viewport.height].join(' ') : undefined });`);
await writeFile(file, compiled);
after(() => unlink(file));
const { default: CompanionShelf, CompanionSpark, companionSparkText } = await import(file.href);
const noop = () => {};
const base = { open: true, language: 'en', entries: [], canPick: false, disabled: false, onClose: noop, onRecall: noop, onRemove: noop, onPickFromCanvas: noop };
const entry = (id, name = 'Coco') => ({ id, name, style: 'watercolor', object: { id: `object-${id}`, kind: 'cat' }, bounds: { x: 240, y: 160, width: 80, height: 120 }, erasures: [] });
const render = props => renderToStaticMarkup(createElement(CompanionShelf, { ...base, ...props }));

test('a closed shelf mounts no preview engines or hidden form', () => {
  assert.equal(render({ open: false, entries: [entry('one')], canPick: true }), '');
});
test('voice workflow and direct canvas pick replace the nested save form', () => {
  const html = render({ canPick: true });
  assert.ok(html.indexOf('While your friend is being drawn') < html.indexOf('Add a companion'));
  assert.match(html, /Coco is on the moon/);
  assert.match(html, /Keep talking while we draw/);
  assert.match(html, /Tap a character in your picture/);
  assert.doesNotMatch(html, /<details|<select|<option|<form|<input/);
  assert.match(html, /Companions stay in this browser/);
});
test('Chinese workflow and labels are localized without changing names', () => {
  const html = render({ language: 'zh', entries: [entry('one', '豆豆')], canPick: true });
  for (const phrase of ['我的伙伴', '伙伴还在画，就可以说', '它叫豆豆', '换一张纸', '画笔还在画', '豆豆到了月球', '添加伙伴', '点一下画里的角色', '只保存在这个浏览器中']) assert.ok(html.includes(phrase));
  assert.doesNotMatch(html, /My companions|Bring to this page|Remember this friend/);
});
test('saved previews use original medium and bounds, stay still, and produce no sound', () => {
  const html = render({ entries: [entry('one')] });
  assert.match(html, /data-style="watercolor"/);
  assert.match(html, /data-motion="still"/);
  assert.match(html, /data-sound="false"/);
  assert.match(html, /viewBox="225.6 145.6 108.8 148.8"/);
});
test('the shelf previews saved friends only and never requires an object dropdown', () => {
  const html = render({ entries: [entry('cat'), entry('bear')], canPick: true });
  assert.equal((html.match(/data-preview=/g) || []).length, 2);
  assert.doesNotMatch(html, /<select|<option|companion-candidate-preview/);
});
test('scene mutation lock preserves direct picking when the parent permits it', () => {
  const html = render({ disabled: true, entries: [entry('one')], canPick: true });
  assert.match(html, /class="companion-recall" disabled=""/);
  assert.match(html, /class="companion-remove" disabled=""/);
  assert.doesNotMatch(html, /class="studio-extra-primary" disabled=""/);
  assert.doesNotMatch(html, /class="studio-extra-close"[^>]*disabled/);
});
test('the parent can lock canvas picking independently of saved companion actions', () => {
  const html = render({ disabled: false, entries: [entry('one')], canPick: false });
  assert.match(html, /class="studio-extra-primary" disabled=""/);
  assert.doesNotMatch(html, /class="companion-recall" disabled=""/);
});
test('empty shelf has no unusable naming form and explains the first step', () => {
  const html = render({});
  assert.match(html, /Who will your first companion be/);
  assert.match(html, /Draw a friend first/);
  assert.doesNotMatch(html, /<form|<input/);
});
test('full shelf explains the bounded collection and disables adding another', () => {
  const html = render({ entries: Array.from({ length: 8 }, (_, i) => entry(`c${i}`)), canPick: true });
  assert.match(html, /eight friends/);
  assert.match(html, /class="studio-extra-primary" disabled=""/);
});
test('untrusted display text is escaped, including entry name and feedback', () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const html = render({ entries: [entry('one', unsafe)], canPick: true, error: unsafe });
  assert.doesNotMatch(html, /<img|<script/);
  assert.ok(html.includes('&lt;img'));
  assert.match(html, /role="alert"/);
});
test('forget undo is offered only when parent provides a recoverable removal', () => {
  assert.doesNotMatch(render({ notice: 'Friend forgotten.' }), /Undo forget/);
  assert.match(render({ notice: 'Friend forgotten.', onUndoRemove: noop }), /Undo forget/);
  assert.match(render({ language: 'zh', onUndoRemove: noop }), /撤销忘记/);
});
test('dialog has a named description and an accessible close, without a duplicate naming form', () => {
  const html = render({ canPick: true });
  assert.match(html, /<dialog[^>]*aria-labelledby=/);
  assert.match(html, /aria-describedby=/);
  assert.match(html, /aria-label="Close companions"/);
  assert.doesNotMatch(html, /<label|<select|<input/);
});
test('five bilingual questions leave story decisions open and normalize indices', () => {
  for (const language of ['en', 'zh']) {
    const seen = new Set();
    for (let index = 0; index < 5; index++) {
      const value = companionSparkText('Coco', language, index);
      assert.ok(value.includes('Coco')); assert.match(value, /[?？]$/); seen.add(value);
    }
    assert.equal(seen.size, 5);
    assert.equal(companionSparkText('Coco', language, 5), companionSparkText('Coco', language, 0));
    assert.equal(companionSparkText('Coco', language, -1), companionSparkText('Coco', language, 4));
    for (const invalid of [Infinity, NaN]) assert.equal(companionSparkText('Coco', language, invalid), companionSparkText('Coco', language, 0));
  }
});
test('an explicit story idea request still gets a question without a saved companion', () => {
  assert.match(renderToStaticMarkup(createElement(CompanionSpark, { name: null, language: 'en', onClose: noop })), /Where will your friend go next/);
  assert.match(renderToStaticMarkup(createElement(CompanionSpark, { name: null, language: 'zh', onClose: noop })), /你的小伙伴接下来会去哪里呢/);
});
test('successive spoken requests can start at a different question without a model call', () => {
  const html = index => renderToStaticMarkup(createElement(CompanionSpark, { name: 'Coco', language: 'en', initialIndex: index, onClose: noop }));
  assert.match(html(0), /Where will Coco go next/);
  assert.match(html(1), /Who might Coco meet there/);
  assert.match(html(6), /Who might Coco meet there/);
  assert.match(html(NaN), /Where will Coco go next/);
});
test('optional story spark is non-modal and does not auto-submit', () => {
  const html = renderToStaticMarkup(createElement(CompanionSpark, { name: 'Coco', language: 'en', onClose: noop }));
  assert.match(html, /<aside/); assert.match(html, /Where will Coco go next/);
  assert.match(html, /aria-label="Another idea"/); assert.match(html, /aria-label="Dismiss idea"/);
  assert.doesNotMatch(html, /<dialog|<form|type="submit"/);
});
test('shelf and question UI never invoke a model, access microphone, or own persistence', () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|AudioContext|localStorage|requestImagine|startStreaming|getUserMedia/);
  assert.match(source, /onCancel=/);
  assert.match(source, /onKeyDown=\{event => event\.stopPropagation\(\)\}/);
});
