import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';
const file = new URL('../.sites-runtime/paper-viewport-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
await writeFile(file, ts.transpileModule(await readFile(new URL('../lib/paper-viewport.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { fitPaperViewport, retainPaperExtent, DEFAULT_PAPER, isPaperViewport } = await import(file.href);
after(() => unlink(file));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} should equal ${b}`);

test('wide screens expand the horizontal sheet without changing existing drawing coordinates', () => {
  assert.deepEqual(fitPaperViewport(1600, 640), { x: -300, y: 0, width: 1600, height: 640 });
  assert.deepEqual(fitPaperViewport(1000, 640), DEFAULT_PAPER);
  const paper = fitPaperViewport(1920, 1080);
  near(paper.width / paper.height, 1920 / 1080);
  near(paper.x + paper.width / 2, 500);
  near(paper.y + paper.height / 2, 320);
  assert.equal(paper.height, 640);
});

test('portrait screens expand vertically and retain the full old sheet', () => {
  const paper = fitPaperViewport(400, 800);
  assert.deepEqual(paper, { x: 0, y: -680, width: 1000, height: 2000 });
  assert.equal(paper.width / paper.height, .5);
  const used = { x: -200, y: -50, width: 1400, height: 740 };
  const expanded = fitPaperViewport(400, 800, used);
  assert.deepEqual(expanded, { x: -200, y: -1080, width: 1400, height: 2800 });
  assert.ok(expanded.x <= used.x && expanded.y <= used.y);
  assert.ok(expanded.x + expanded.width >= used.x + used.width && expanded.y + expanded.height >= used.y + used.height);
  assert.deepEqual(used, { x: -200, y: -50, width: 1400, height: 740 });
});

test('invalid screen or saved paper inputs use a finite, safe fallback', () => {
  for (const dimensions of [[0, 600], [1000, -1], [NaN, 640], [1000, Infinity]]) assert.deepEqual(fitPaperViewport(...dimensions), DEFAULT_PAPER);
  for (const base of [null, {}, { ...DEFAULT_PAPER, x: NaN }, { ...DEFAULT_PAPER, width: -10 }, { x: 9999, y: 0, width: 2, height: 640 }]) {
    assert.deepEqual(fitPaperViewport(1000, 640, base), DEFAULT_PAPER);
    assert.equal(isPaperViewport(base), false);
  }
  const custom = { x: -100, y: -50, width: 1200, height: 740 };
  assert.deepEqual(fitPaperViewport(0, 0, custom), custom);
});

test('extreme ratios are capped safely while preserving the original extent and center', () => {
  for (const dimensions of [[Number.MAX_VALUE, Number.MIN_VALUE], [Number.MIN_VALUE, Number.MAX_VALUE], [1e100, 1], [1, 1e100]]) {
    const paper = fitPaperViewport(...dimensions);
    assert.ok(isPaperViewport(paper));
    assert.ok(paper.width >= 1000 && paper.height >= 640);
    near(paper.x + paper.width / 2, 500);
    near(paper.y + paper.height / 2, 320);
  }
});

test('undo to a smaller paper keeps the camera and old ink within the eraser viewport', () => {
  const used = { x: -400, y: -80, width: 1800, height: 800 };
  const retained = retainPaperExtent(used, DEFAULT_PAPER);
  assert.deepEqual(retained, used);
  assert.deepEqual(fitPaperViewport(1440, 640, retained), fitPaperViewport(1440, 640, used));
  const expanded = retainPaperExtent(used, { x: -200, y: -200, width: 1600, height: 1100 });
  assert.deepEqual(expanded, { x: -400, y: -200, width: 1800, height: 1100 });
  assert.ok(isPaperViewport(expanded));
});
