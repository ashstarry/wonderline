import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const source = await readFile(new URL('../components/PaperInspiration.tsx', import.meta.url), 'utf8');
const styles = await readFile(new URL('../components/paper-inspiration.css', import.meta.url), 'utf8');
const file = new URL(`../.sites-runtime/paper-inspiration-test-${process.pid}.mjs`, import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
await writeFile(file, ts.transpileModule(source.replaceAll(/import '\.\/[^']+\.css';/g, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
}).outputText);
after(() => unlink(file));
const { default: PaperInspiration, paperIdeasFor } = await import(file.href);
const render = overrides => renderToStaticMarkup(createElement(PaperInspiration, { visible: true, language: 'en', onDismiss() {}, ...overrides }));

test('the blank-page opening is three questions, without a modal, list, or automatic drawing', () => {
  const html = render({});
  assert.equal((html.match(/class="paper-idea-question"/g) || []).length, 3);
  assert.equal((html.match(/class="paper-idea-sketch /g) || []).length, 3);
  assert.match(html, /Who lives inside a cloud\?/);
  assert.match(html, /What if a bear had wings\?/);
  assert.match(html, /What flower would you grow on the moon\?/);
  assert.doesNotMatch(html, /<dialog|<select|<ul|<ol|<img|aria-modal/);
});
test('the dismissed opening is immediately inert and hidden to assistive technology', () => {
  const html = render({ visible: false });
  assert.match(html, /aria-hidden="true" inert=""/);
  assert.doesNotMatch(html, /is-visible/);
  assert.match(styles, /transition:opacity \.3s ease,visibility 0s linear \.3s/);
  assert.match(styles, /pointer-events:none/);
});
test('shown opening exposes keyboard buttons with accessible names', () => {
  const html = render({});
  assert.equal((html.match(/<button /g) || []).length, 5);
  assert.equal((html.match(/aria-pressed="false"/g) || []).length, 3);
  assert.match(html, /aria-label="Let the page be blank"/);
  assert.match(html, /A little more wonder/);
  assert.doesNotMatch(html, /inert=""|autoFocus|tabindex="-1"/);
});
test('Chinese inspiration is fully localized', () => {
  const html = render({ language: 'zh' });
  for (const phrase of ['一点小灵感', '谁住在云朵里面', '小熊长出了翅膀', '一朵怎样的花', '再想一点点', '让画纸留白']) assert.ok(html.includes(phrase));
  assert.doesNotMatch(html, /What if|Who lives|wonder|Let the page/);
});
test('a companion invitation uses the actual saved name, safely escaped', () => {
  const html = render({ companionName: '<b>Toby</b>' });
  assert.match(html, /What is &lt;b&gt;Toby&lt;\/b&gt; like today/);
  assert.doesNotMatch(html, /<b>Toby<\/b>|What if a bear/);
  assert.match(render({ language: 'zh', companionName: '豆豆' }), /豆豆今天会是什么样子/);
  assert.match(render({ companionName: '  ' }), /What if a bear/);
});
test('every shuffle changes all three questions and always keeps them open ended', () => {
  for (const language of ['en', 'zh']) for (let round = 0; round < 30; round++) {
    const before = paperIdeasFor(round, language), after = paperIdeasFor(round + 1, language);
    assert.equal(before.length, 3);
    for (let index = 0; index < 3; index++) {
      assert.notEqual(before[index].text, after[index].text);
      assert.ok(before[index].text.length < 90);
      assert.ok(before[index].followup.length > 8 && before[index].followup.length < 70);
      assert.notEqual(before[index].followup, before[index].text);
      assert.notEqual(before[index].followup, after[index].followup);
    }
  }
});
test('the compact companion invitation also changes when another thought is requested', () => {
  for (let round = 0; round < 9; round++) {
    const current = paperIdeasFor(round, 'en', 'Toby')[1];
    assert.ok(current.text.includes('Toby'));
    assert.notEqual(current.followup, paperIdeasFor(round + 1, 'en', 'Toby')[1].followup);
    assert.notEqual(current.text, paperIdeasFor(round + 1, 'en', 'Toby')[1].text);
  }
});
test('reduced motion and small paper have explicit alternatives', () => {
  assert.match(render({ reducedMotion: true }), /is-reduced-motion/);
  assert.match(styles, /prefers-reduced-motion:reduce/);
  assert.match(styles, /@container paper-inspiration \(max-height:300px\)/);
  assert.match(styles, /@container paper-inspiration \(max-height:180px\)/);
  assert.match(styles, /@container paper-inspiration \(max-width:420px\)/);
  assert.doesNotMatch(styles, /infinite|backdrop-filter/);
});
test('an explicit inspiration visit over artwork uses a separate wash, without filtering the scene', () => {
  assert.match(render({ overArtwork: true }), /is-over-artwork/);
  assert.doesNotMatch(render({}), /is-over-artwork/);
  assert.match(styles, /\.paper-inspiration\.is-over-artwork:before\{[^}]*rgba\(255,249,235,\.99\)/);
  assert.doesNotMatch(styles, /filter:/);
});
test('inspiration has no network, scene, storage, voice, or model ownership', () => {
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|WebSocket|localStorage|requestImagine|startStreaming|getUserMedia|setScene\(|AudioContext/);
  assert.doesNotMatch(source, /from ['"]\.\.\/lib\//);
});
