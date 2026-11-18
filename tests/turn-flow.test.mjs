import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/turn-flow-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../lib/turn-flow.ts', import.meta.url), 'utf8');
await writeFile(temporary, ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText);
const { TurnFeedbackGate, inputIsBusy } = await import(temporary.href);
after(() => unlink(temporary));

test('duplicate ASR updates and partial-to-stable delivery belong to the same input', () => {
  const gate = new TurnFeedbackGate();
  gate.beginSession();
  assert.equal(gate.observe('画一个', '太阳'), true);
  const version = gate.version;
  assert.equal(gate.observe('画一个', '太阳'), false);
  assert.equal(gate.observe('画一个太阳。', ''), false);
  assert.equal(gate.observe('画 一个 太阳！', '\n'), false);
  assert.equal(gate.version, version);
});

test('opening a new microphone session leaves feedback until actual new words arrive', () => {
  const gate = new TurnFeedbackGate();
  gate.observe('画一个太阳', '');
  const previous = gate.version;
  gate.beginSession();
  assert.equal(gate.version, previous);
  assert.equal(gate.isCurrent(previous), true);
  assert.equal(gate.observe('', ''), false);
  assert.equal(gate.observe('，。…', '\n ！？'), false);
  assert.equal(gate.isCurrent(previous), true);
  // The child can intentionally repeat the same idea in a later recording.
  assert.equal(gate.observe('画一个太阳', ''), true);
  assert.equal(gate.version, previous + 1);
  assert.equal(gate.observe('画一个太阳', ''), false);
});

test('fresh partial speech makes a late failure from the previous request obsolete', () => {
  const gate = new TurnFeedbackGate();
  gate.observe('画一只小熊', '');
  const failedRequestVersion = gate.version;
  assert.equal(gate.isCurrent(failedRequestVersion), true);
  assert.equal(gate.observe('画一只小熊', '那画一个月亮吧'), true);
  assert.equal(gate.isCurrent(failedRequestVersion), false);
  const newVersion = gate.version;
  assert.equal(gate.observe('画一只小熊。那画一个月亮吧。', ''), false);
  assert.equal(gate.isCurrent(newVersion), true);
});

test('empty updates neither advance feedback nor forget the last meaningful fingerprint', () => {
  const gate = new TurnFeedbackGate();
  gate.observe('', '小猫');
  const version = gate.version;
  assert.equal(gate.observe('', ''), false);
  assert.equal(gate.observe('！', '…'), false);
  assert.equal(gate.observe('小猫', ''), false);
  assert.equal(gate.version, version);
});

test('meaningful Chinese, non-Latin letters, numbers, and emoji remain recognizable', () => {
  const gate = new TurnFeedbackGate();
  for (const value of ['小熊', 'ねこ', 'شمس', '2', '🐻']) {
    const version = gate.version;
    assert.equal(gate.observe(value, ''), true);
    assert.equal(gate.version, version + 1);
    assert.equal(gate.observe(`「${value}」`, '。'), false);
  }
  assert.equal(gate.observe('café', ''), true);
  assert.equal(gate.observe('cafe\u0301', ''), false);
});

test('a corrected meaningful partial is new input while intentional typing always advances', () => {
  const gate = new TurnFeedbackGate();
  gate.observe('画一只', '小熊');
  const previous = gate.version;
  assert.equal(gate.observe('画一只', '小猫'), true);
  assert.equal(gate.isCurrent(previous), false);
  const beforeTyping = gate.version;
  gate.advance();
  gate.advance();
  assert.equal(gate.version, beforeTyping + 2);
});

const idle = { painting: false, pendingCount: 0, paused: false };
const service = { painting: false, pendingCount: 2, paused: true };

test('active audio operations and batch requests stay busy even with a paused queue', () => {
  for (const phase of ['recording', 'requesting', 'uploading', 'finishing']) {
    assert.equal(inputIsBusy(phase, false, undefined), true, phase);
    assert.equal(inputIsBusy(phase, false, service), true, `${phase} with service pause`);
  }
  assert.equal(inputIsBusy('off', true, service), true);
});

test('service-paused work allows reopening the microphone after stop or drain', () => {
  assert.equal(inputIsBusy('off', false, service), false);
  assert.equal(inputIsBusy('draining', false, service), false);
  assert.equal(inputIsBusy('draining', false, { ...service, pendingCount: 0 }), false);
  assert.equal(inputIsBusy('off', false, idle), false);
  assert.equal(inputIsBusy('off', false, null), false);
  assert.equal(inputIsBusy('off', false, undefined), false);
});

test('in-flight painting and nonpaused pending work still prevent overlapping input operations', () => {
  for (const phase of ['off', 'draining']) {
    assert.equal(inputIsBusy(phase, false, { ...service, painting: true }), true);
    assert.equal(inputIsBusy(phase, false, { ...idle, painting: true }), true);
    assert.equal(inputIsBusy(phase, false, { ...idle, pendingCount: 1 }), true);
  }
  assert.equal(inputIsBusy('draining', false, idle), true);
  assert.equal(inputIsBusy('draining', false, null), true);
});
