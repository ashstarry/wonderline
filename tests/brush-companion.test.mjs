import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/brush-companion-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../components/brush-companion-state.ts', import.meta.url), 'utf8');
await writeFile(temporary, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { brushCompanionState, brushVoiceAmount, BRUSH_LEVEL_FRESH_MS } = await import(temporary.href);
after(() => unlink(temporary));

test('model preparation remains visible while a previous subject is still drawing', () => {
  const state = { listening: true, preparing: false, drawing: false, blocked: false };
  assert.equal(brushCompanionState(state), 'listening');
  state.preparing = true;
  assert.equal(brushCompanionState(state), 'preparing');
  state.drawing = true;
  assert.equal(brushCompanionState(state), 'thinking-drawing');
  state.preparing = false;
  assert.equal(brushCompanionState(state), 'drawing');
  state.drawing = false;
  assert.equal(brushCompanionState(state), 'listening');
});

test('error, pause, or cancellation can stop all decorative motion regardless of queued work', () => {
  for (const listening of [true, false]) for (const preparing of [true, false]) for (const drawing of [true, false]) {
    assert.equal(brushCompanionState({ listening, preparing, drawing, blocked: true }), 'resting');
  }
  assert.equal(brushCompanionState({ listening: false, preparing: false, drawing: false, blocked: false }), 'resting');
});

test('silence and invalid microphone samples cannot animate the brush; louder valid sound is bounded', () => {
  for (const level of [0, -.5, .01, .035, NaN, Infinity, -Infinity]) assert.equal(brushVoiceAmount(level), 0);
  assert.ok(brushVoiceAmount(.15) > 0);
  assert.ok(brushVoiceAmount(.4) > brushVoiceAmount(.15));
  assert.equal(brushVoiceAmount(1), 1);
  assert.equal(brushVoiceAmount(900), 1);
  assert.ok(BRUSH_LEVEL_FRESH_MS < 300, 'stale captured sound must settle quickly rather than imply continued speaking');
});
