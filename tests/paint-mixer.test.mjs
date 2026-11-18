import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const dir = new URL(`../.sites-runtime/paint-mixer-${process.pid}/`, import.meta.url);
await mkdir(dir, { recursive: true });
const source = await readFile(new URL('../components/PaintMixer.tsx', import.meta.url), 'utf8');
const modelSource = await readFile(new URL('../lib/paint-mixer.ts', import.meta.url), 'utf8');
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
await writeFile(new URL('paint-mixer.mjs', dir), compile(modelSource));
await writeFile(new URL('PaintMixer.mjs', dir), compile(source.replace("import './paint-mixer.css';", '').replace("'../lib/paint-mixer'", "'./paint-mixer.mjs'")));
after(() => rm(dir, { recursive: true, force: true }));
const { default: PaintMixer } = await import(new URL('PaintMixer.mjs', dir));
const { PAINT_COLORS, PAINT_POTS, MAX_DROPS_PER_COLOR, MAX_PAINT_DROPS, paintCounts, addPaintDrop, undoPaintDrop, mixPaint } = await import(new URL('paint-mixer.mjs', dir));
const recipe = (r, y, b, w) => ['red', 'yellow', 'blue', 'white'].flatMap((color, i) => Array([r, y, b, w][i]).fill(color));
const channels = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

test('empty paint has no selected color; each pure pot retains its intended color', () => {
  assert.equal(mixPaint([]), null);
  for (const color of PAINT_COLORS) {
    assert.equal(mixPaint([color]), PAINT_POTS[color]);
    assert.equal(mixPaint(Array(MAX_DROPS_PER_COLOR).fill(color)), PAINT_POTS[color]);
  }
});

test('RYB toy makes orange, green, purple and brown instead of additive screen mixing', () => {
  assert.equal(mixPaint(['red', 'yellow']), '#e99448');
  assert.equal(mixPaint(['yellow', 'blue']), '#74a55e');
  assert.equal(mixPaint(['red', 'blue']), '#9d77ba');
  assert.equal(mixPaint(['red', 'yellow', 'blue']), '#966a4f');
});

test('all 2,401 bounded recipes yield valid order-independent colors without mutating the recipe', () => {
  let combinations = 0;
  for (let r = 0; r <= 6; r++) for (let y = 0; y <= 6; y++) for (let b = 0; b <= 6; b++) for (let w = 0; w <= 6; w++) {
    const drops = Object.freeze(recipe(r, y, b, w));
    const hex = mixPaint(drops);
    assert.equal(hex, mixPaint([...drops].reverse()));
    if (drops.length) assert.match(hex, /^#[a-f0-9]{6}$/);
    else assert.equal(hex, null);
    assert.deepEqual(paintCounts(drops), { red: r, yellow: y, blue: b, white: w });
    combinations++;
  }
  assert.equal(combinations, 2401);
});

test('adding white lightens every pigment recipe progressively while retaining the hue family', () => {
  for (let r = 0; r <= 6; r++) for (let y = 0; y <= 6; y++) for (let b = 0; b <= 6; b++) {
    if (!r && !y && !b) continue;
    let previous = channels(mixPaint(recipe(r, y, b, 0)));
    for (let w = 1; w <= 6; w++) {
      const current = channels(mixPaint(recipe(r, y, b, w)));
      current.forEach((channel, i) => assert.ok(channel >= previous[i]));
      previous = current;
    }
  }
});

test('doubling equal recipes does not darken paint or change its hue', () => {
  for (let r = 0; r <= 3; r++) for (let y = 0; y <= 3; y++) for (let b = 0; b <= 3; b++) for (let w = 0; w <= 3; w++) {
    assert.equal(mixPaint(recipe(r, y, b, w)), mixPaint(recipe(r * 2, y * 2, b * 2, w * 2)));
  }
});

test('drops are capped per color and in total; rejected drops preserve state', () => {
  let drops = [];
  for (const color of PAINT_COLORS) {
    for (let i = 0; i < MAX_DROPS_PER_COLOR; i++) drops = addPaintDrop(drops, color);
    assert.equal(addPaintDrop(drops, color), drops);
  }
  assert.equal(drops.length, MAX_PAINT_DROPS);
  assert.equal(addPaintDrop(drops, 'red'), drops);
  assert.equal(addPaintDrop(drops, 'invalid'), drops);
});

test('undo removes exactly the most recent drop and restores its previous mixture', () => {
  const first = Object.freeze(['red', 'yellow']);
  const second = addPaintDrop(first, 'blue');
  assert.deepEqual(undoPaintDrop(second), first);
  assert.equal(mixPaint(undoPaintDrop(second)), mixPaint(first));
  assert.deepEqual(first, ['red', 'yellow']);
  const empty = Object.freeze([]);
  assert.equal(undoPaintDrop(empty), empty);
});

test('guarded counts keep malformed and excessive drops from producing invalid colors', () => {
  assert.deepEqual(paintCounts(Array(50).fill('red')), { red: 6, yellow: 0, blue: 0, white: 0 });
  assert.equal(mixPaint(['invalid', 'white', 'invalid']), PAINT_POTS.white);
});

test('mixer starts collapsed, gives all four colors named controls, and cannot use an empty mix', () => {
  let emitted = 0;
  const html = renderToStaticMarkup(createElement(PaintMixer, { language: 'en', onUse() { emitted++; } }));
  assert.match(html, /Mix &amp; play/);
  assert.match(html, /<details[^>]*>/); assert.doesNotMatch(html, /<details[^>]*\sopen[=> ]/);
  for (const color of PAINT_COLORS) assert.match(html, new RegExp(`Add a drop of ${color}\\.`));
  assert.match(html, /class="paint-mixer-use" disabled=""/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.equal(emitted, 0);
});

test('Chinese copy is complete and disabling the toy disables every action', () => {
  const html = renderToStaticMarkup(createElement(PaintMixer, { language: 'zh', disabled: true, onUse() { throw new Error('Unexpected emit'); } }));
  for (const label of ['混色玩一玩', '红色', '黄色', '蓝色', '白色', '退回一滴', '重新调', '用这个颜色']) assert.ok(html.includes(label));
  const buttons = html.match(/<button\b[^>]*>/g);
  assert.equal(buttons.length, 7);
  assert.ok(buttons.every(button => button.includes('disabled=""')));
});

test('toy has no network, model, speech, canvas, sound, persistence or timer dependency', () => {
  assert.doesNotMatch(source + modelSource, /fetch\(|XMLHttpRequest|WebSocket|AudioContext|localStorage|sessionStorage|requestImagine|startStreaming|setTimeout|setInterval|requestAnimationFrame|onDraw|onSubmit/);
  assert.equal((source.match(/onUse\(color\)/g) || []).length, 1);
  assert.match(source, /if \(!disabled && color\) onUse\(color\)/);
});
