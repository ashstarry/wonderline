import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const output = new URL('../.sites-runtime/story-sparks-component.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../components/StorySparks.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace("import './studio-extras.css';", ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
await writeFile(output, compiled);
after(() => unlink(output));
const { default: StorySparks, STORY_SPARKS, nextSparkIndex } = await import(output.href);

test('all eighteen story sparks have matching English and Chinese text', () => {
  assert.deepEqual(Object.keys(STORY_SPARKS), ['where', 'who', 'next']);
  for (const cards of Object.values(STORY_SPARKS)) {
    assert.equal(cards.length, 6);
    for (const card of cards) {
      assert.match(card.en, /\?$/); assert.match(card.zh, /？$/);
      assert.ok(card.en.length < 100 && card.zh.length < 60);
    }
  }
});

test('shuffle always changes the displayed suggestion and stays inside its category', () => {
  for (const cards of Object.values(STORY_SPARKS)) {
    for (let current = 0; current < cards.length; current++) {
      const seen = new Set();
      for (const random of [0, .2, .4, .6, .8, .999999, 1]) {
        const result = nextSparkIndex(current, cards.length, random);
        assert.ok(result >= 0 && result < cards.length);
        assert.notEqual(result, current); seen.add(result);
      }
      assert.equal(seen.size, cards.length - 1);
    }
  }
});

test('shuffle handles unavailable or out-of-range randomness safely', () => {
  for (const random of [NaN, Infinity, -1, 5]) assert.ok(Number.isInteger(nextSparkIndex(0, 6, random)));
  assert.equal(nextSparkIndex(0, 1, .5), 0);
});

test('English panel explains continuing to talk, with no submit or generate control', () => {
  const html = renderToStaticMarkup(createElement(StorySparks, { open: false, language: 'en', onClose() {} }));
  assert.match(html, /Story sparks/); assert.match(html, /Keep talking while we draw/);
  assert.match(html, /Another idea/); assert.doesNotMatch(html, /提交|生成|submit|Generate drawing/);
});

test('Chinese panel is localized, retains accessible dialog and pressed category controls', () => {
  const html = renderToStaticMarkup(createElement(StorySparks, { open: false, language: 'zh', onClose() {} }));
  assert.match(html, /故事灵感/); assert.match(html, /画笔还在画，你可以接着说/);
  assert.match(html, /<dialog/); assert.match(html, /aria-labelledby=/); assert.match(html, /aria-describedby=/);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
});

test('story spark interaction has no network, model, microphone, storage or drawing dependency', () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|AudioContext|localStorage|requestImagine|startStreaming|onSubmit|onDraw/);
  assert.match(source, /onCancel=/);
});
