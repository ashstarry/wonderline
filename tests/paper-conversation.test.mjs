import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const runtime = new URL('../.sites-runtime/', import.meta.url);
const moduleFile = new URL('paper-conversation-test.mjs', runtime);
const dependencyFile = new URL('paper-conversation-dependency.mjs', runtime);
await mkdir(runtime, { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
await writeFile(dependencyFile, compile(await readFile(new URL('../lib/conversation.ts', import.meta.url), 'utf8')));
await writeFile(moduleFile, compile((await readFile(new URL('../lib/paper-conversation.ts', import.meta.url), 'utf8')).replace("'./conversation'", "'./paper-conversation-dependency.mjs'")));
const { LEGACY_PAPER_ID, paperIdFor, restorePaperConversations, serializePaperConversations } = await import(moduleFile.href);
const { appendTextEntry, upsertVoiceEntry, restoreConversation, serializeConversation } = await import(dependencyFile.href);
after(() => Promise.all([unlink(moduleFile), unlink(dependencyFile)]));
const words = (text, id = text) => appendTextEntry([], text, id, 10);

test('old history entries use a stable legacy paper ID', () => {
  assert.equal(paperIdFor(undefined), LEGACY_PAPER_ID);
  assert.equal(paperIdFor({}), LEGACY_PAPER_ID);
  assert.equal(paperIdFor({ paperId: '  ' }), LEGACY_PAPER_ID);
  assert.equal(paperIdFor({ paperId: 'paper-a' }), 'paper-a');
});

test('round trip restores the selected history paper, even when the saved active paper differs', () => {
  const first = words('画一只猫。');
  const second = words('画一朵花。');
  const raw = serializePaperConversations(new Map([['a', first], ['b', []]]), 'b', second, ['a', 'b']);
  assert.deepEqual(restorePaperConversations(raw, [], 'a').entries, first);
  assert.deepEqual(restorePaperConversations(raw, [], 'b').entries, second);
  assert.deepEqual(restoreConversation(raw), second, 'top-level entries stay compatible with the old reader');
});

test('empty new paper remains empty through reload, undo and redo without resurrecting old phrases', () => {
  const old = words('旧纸上的鲸鱼。');
  const raw = serializePaperConversations(new Map([['a', old]]), 'b', [], ['a', 'b']);
  const history = [{ paperId: 'a', phrase: '旧纸上的鲸鱼。' }, { paperId: 'b', phrase: '换一张空白纸' }];
  assert.deepEqual(restorePaperConversations(raw, history, 'b').entries, []);
  assert.deepEqual(restorePaperConversations(raw, history, 'a').entries, old);
  assert.deepEqual(restorePaperConversations(raw, history, 'b').entries, []);
  assert.deepEqual(restorePaperConversations(raw, history, 'unwritten-paper').entries, []);
  const inconsistent = JSON.stringify({ version: 2, paperId: 'b', entries: old, papers: { b: [] } });
  assert.deepEqual(restorePaperConversations(inconsistent, history, 'b').entries, [], 'explicit empty map beats stale top-level fallback');
});

test('legacy logs migrate only to the legacy paper and saved empty logs remain authoritative', () => {
  const old = words('以前说过的话。');
  const history = [{ phrase: '不应复活的历史。' }];
  const restored = restorePaperConversations(serializeConversation(old), history, LEGACY_PAPER_ID);
  assert.deepEqual(restored.entries, old);
  assert.deepEqual(restorePaperConversations(serializeConversation(old), history, 'new-paper').entries, []);
  assert.deepEqual(restorePaperConversations(serializeConversation([]), history, LEGACY_PAPER_ID).entries, []);
  assert.deepEqual(restorePaperConversations(JSON.stringify(old), history, LEGACY_PAPER_ID).entries, old);
});

test('missing or corrupt logs recover only the selected paper phrases from history', () => {
  const history = [{ phrase: '从湖边开始' }, { phrase: '老纸上的月亮。' }, { paperId: 'new', phrase: '换一张空白纸' }, { paperId: 'new', phrase: '新纸上的太阳。' }];
  for (const raw of [null, '{broken']) {
    assert.deepEqual(restorePaperConversations(raw, history, LEGACY_PAPER_ID).entries.map(entry => entry.text), ['老纸上的月亮。']);
    assert.deepEqual(restorePaperConversations(raw, history, 'new').entries.map(entry => entry.text), ['新纸上的太阳。']);
  }
});

test('saving prunes abandoned branches but keeps the active paper and does not mutate the source map', () => {
  const first = words('保留。');
  const abandoned = words('被新分支替代。');
  const previousActive = words('之前的版本。');
  const current = words('当前最新文字。');
  const papers = new Map([['a', first], ['abandoned', abandoned], ['current', previousActive]]);
  const raw = serializePaperConversations(papers, 'current', current, ['a']);
  assert.deepEqual(Object.keys(JSON.parse(raw).papers), ['a', 'current']);
  assert.equal(papers.size, 3);
  assert.equal(papers.get('current'), previousActive);
  assert.deepEqual(restorePaperConversations(raw, [], 'current').entries, current);
});

test('v2 active-log fallback sanitizes entries and interrupts a listening microphone after reload', () => {
  const listening = upsertVoiceEntry([], { sessionId: 'voice', revision: 1, stableText: '一个男孩。', partial: '戴着', done: false }, 10);
  const raw = JSON.stringify({ version: 2, paperId: 'a', entries: [...listening, null, { id: 'invalid' }], papers: {} });
  const restored = restorePaperConversations(raw, [], 'a');
  assert.equal(restored.entries.length, 1);
  assert.equal(restored.entries[0].status, 'unconfirmed');
  assert.equal(restored.entries[0].partial, '戴着');
  assert.deepEqual(restorePaperConversations(raw, [], 'b').entries, []);
});
