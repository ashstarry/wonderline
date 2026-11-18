import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/paper-inspiration-flow.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { InspirationSpeechOnset, isUnmarkedPaper } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const blank = extra => ({ title: 'A new page', objects: [], sky: 'paper', ground: 'none', weather: 'clear', ...extra });

test('quiet microphone startup does not consume the opening', () => {
  const onset = new InspirationSpeechOnset();
  for (let i = 0; i < 20; i++) assert.equal(onset.observe(i % 2 ? .054 : 0, i * 90), false);
  assert.equal(onset.observe(.055, 1900), false);
  assert.equal(onset.observe(.055, 1990), true);
});

test('one microphone click followed by quiet does not count as speech onset', () => {
  const onset = new InspirationSpeechOnset();
  assert.equal(onset.observe(.9, 0), false);
  assert.equal(onset.observe(.01, 90), false);
  assert.equal(onset.observe(.2, 180), false);
  assert.equal(onset.observe(.25, 270), true);
});

test('live and uploaded audio cadences can dismiss without waiting for transcript', () => {
  for (const cadence of [85, 93, 200, 256]) {
    const onset = new InspirationSpeechOnset();
    assert.equal(onset.observe(.1, 1000), false);
    assert.equal(onset.observe(.2, 1000 + cadence), true, `${cadence} ms cadence`);
  }
});

test('a stalled capture callback cannot combine distant sounds', () => {
  const onset = new InspirationSpeechOnset();
  assert.equal(onset.observe(.2, 10), false);
  assert.equal(onset.observe(.2, 461), false);
  assert.equal(onset.observe(.2, 911), true);
});

test('invalid readings break the candidate pair', () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const onset = new InspirationSpeechOnset();
    assert.equal(onset.observe(.2, 0), false);
    assert.equal(onset.observe(invalid, 90), false);
    assert.equal(onset.observe(.2, 180), false);
    assert.equal(onset.observe(.2, 270), true);
  }
  const onset = new InspirationSpeechOnset();
  assert.equal(onset.observe(.2, 0), false);
  assert.equal(onset.observe(.2, NaN), false);
  assert.equal(onset.observe(.2, 180), false);
  assert.equal(onset.observe(.2, 270), true);
});

test('duplicate or backwards timestamps cannot trigger onset by themselves', () => {
  const onset = new InspirationSpeechOnset();
  assert.equal(onset.observe(.2, 100), false);
  assert.equal(onset.observe(.2, 100), false);
  assert.equal(onset.observe(.2, 50), false);
  assert.equal(onset.observe(.2, 140), true);
});

test('onset fires once and only reset permits another opening', () => {
  const onset = new InspirationSpeechOnset();
  assert.equal(onset.observe(.1, 0), false);
  assert.equal(onset.observe(.2, 90), true);
  for (const [level, time] of [[.4, 180], [0, 270], [.3, 360], [.3, 450]]) assert.equal(onset.observe(level, time), false);
  onset.reset();
  assert.equal(onset.observe(.2, 540), false);
  assert.equal(onset.observe(.2, 630), true);
});

test('reset also discards an incomplete pair between microphone sessions', () => {
  const onset = new InspirationSpeechOnset();
  assert.equal(onset.observe(.2, 0), false);
  onset.reset();
  assert.equal(onset.observe(.2, 90), false);
  assert.equal(onset.observe(.2, 180), true);
});

test('only truly unmarked paper receives the automatic opening', () => {
  assert.equal(isUnmarkedPaper(blank()), true);
  assert.equal(isUnmarkedPaper(blank({ erasures: [], paper: { x: 0, y: 0, width: 1200, height: 900 } })), true);
  assert.equal(isUnmarkedPaper(blank({ objects: [{ id: 'bear', kind: 'cat' }] })), false);
  for (const sky of ['day', 'sunset', 'night']) assert.equal(isUnmarkedPaper(blank({ sky })), false);
  for (const ground of ['lake', 'meadow', 'coast']) assert.equal(isUnmarkedPaper(blank({ ground })), false);
  for (const weather of ['rain', 'snow']) assert.equal(isUnmarkedPaper(blank({ weather })), false);
  assert.equal(isUnmarkedPaper(blank({ erasures: [{ id: 'erased-artwork', paths: [], targets: [], width: 30 }] })), false);
});

test('eligibility never modifies a restored drawing', () => {
  const scene = blank({ erasures: [{ id: 'old-erase', paths: ['M0 0L50 50'], targets: [], width: 30 }] });
  const before = structuredClone(scene);
  for (let i = 0; i < 50; i++) isUnmarkedPaper(scene);
  assert.deepEqual(scene, before);
});
