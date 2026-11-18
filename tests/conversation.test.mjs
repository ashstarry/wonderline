import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/conversation-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../lib/conversation.ts', import.meta.url), 'utf8');
await writeFile(temporary, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { upsertVoiceEntry, appendTextEntry, interruptVoiceEntry, restoreConversation, serializeConversation, recentInstructions, omitVoiceRanges } = await import(temporary.href);
after(() => unlink(temporary));
const update = (sessionId, revision, stableText, partial = '', done = false) => ({ sessionId, revision, stableText, partial, done });

test('closing and reopening the microphone appends a session without clearing earlier speech or typed messages', () => {
  let entries = upsertVoiceEntry([], update('first', 1, '画一个男孩。', '让他'), 10);
  entries = upsertVoiceEntry(entries, update('first', 2, '画一个男孩。让他戴帽子。', '', true), 20);
  entries = appendTextEntry(entries, '旁边画一只狗。', 'typed-1', 30);
  entries = upsertVoiceEntry(entries, update('second', 1, '', '把男孩的手'), 40);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].text, '画一个男孩。让他戴帽子。');
  assert.equal(entries[0].status, 'saved');
  assert.equal(entries[1].kind, 'text');
  assert.equal(entries[2].partial, '把男孩的手');
  entries = upsertVoiceEntry(entries, update('second', 2, '把男孩的手举起来。', '', true), 50);
  assert.deepEqual(entries.map(entry => entry.text), ['画一个男孩。让他戴帽子。', '旁边画一只狗。', '把男孩的手举起来。']);
});

test('partial hypotheses replace only the same session tail and stable text is never duplicated', () => {
  const first = upsertVoiceEntry([], update('a', 1, '画一座山。', '山上有'), 10);
  const second = upsertVoiceEntry(first, update('a', 2, '画一座山。', '山上有一棵树'), 20);
  assert.equal(first[0].partial, '山上有');
  assert.equal(second.length, 1);
  assert.equal(second[0].text, '画一座山。');
  assert.equal(second[0].partial, '山上有一棵树');
  const third = upsertVoiceEntry(second, update('a', 3, '画一座山。山上有一棵树。', ''), 30);
  assert.equal(third[0].text, '画一座山。山上有一棵树。');
  assert.equal(third[0].partial, '');
  assert.equal(third[0].createdAt, 10);
});

test('duplicate done events and stale revisions cannot repeat or overwrite saved words', () => {
  const first = upsertVoiceEntry([], update('a', 3, '一只鲸鱼。', '蓝色'), 10);
  assert.equal(upsertVoiceEntry(first, update('a', 2, '一只猫。'), 20), first);
  const final = upsertVoiceEntry(first, update('a', 3, '一只鲸鱼。蓝色的。', '', true), 30);
  assert.equal(upsertVoiceEntry(final, update('a', 3, '一只鲸鱼。蓝色的。', '', true), 40), final);
  assert.equal(upsertVoiceEntry(final, update('a', 4, '不该出现的迟到结果。', '', true), 50), final);
});

test('empty terminal stable text preserves previous committed speech', () => {
  const first = upsertVoiceEntry([], update('a', 1, '一只鲸鱼。'), 10);
  const final = upsertVoiceEntry(first, update('a', 2, '', '', true), 20);
  assert.equal(final[0].text, '一只鲸鱼。');
  assert.equal(final[0].status, 'saved');
  assert.deepEqual(upsertVoiceEntry([], update('silent', 1, '', '', true), 30), []);
});

test('cancel or connection failure retains an unconfirmed tail and ignores late results', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '画一个月亮。', '旁边有一'), 10);
  entries = interruptVoiceEntry(entries, 'a', 20);
  assert.equal(entries[0].text, '画一个月亮。');
  assert.equal(entries[0].partial, '旁边有一');
  assert.equal(entries[0].status, 'unconfirmed');
  assert.equal(upsertVoiceEntry(entries, update('a', 2, '迟到的结果。', '', true)), entries);
  const next = upsertVoiceEntry(entries, update('b', 1, '还有星星。'), 30);
  assert.equal(next[0], entries[0]);
  assert.equal(next.length, 2);
});

test('typed submission IDs prevent retry duplicates without suppressing intentionally repeated messages', () => {
  const first = appendTextEntry([], '再画一只。', 'text-1', 10);
  assert.equal(appendTextEntry(first, '再画一只。', 'text-1', 20), first);
  const next = appendTextEntry(first, '再画一只。', 'text-2', 30);
  assert.equal(next.length, 2);
  assert.equal(appendTextEntry(next, '  ', 'text-3', 40), next);
});

test('reload restores every session and changes an interrupted microphone to unconfirmed', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '画一只猫。', '', true), 10);
  entries = upsertVoiceEntry(entries, update('b', 1, '戴帽子。', '帽子是'), 20);
  const restored = restoreConversation(serializeConversation(entries));
  assert.equal(restored.length, 2);
  assert.equal(restored[0].status, 'saved');
  assert.equal(restored[1].status, 'unconfirmed');
  assert.equal(restored[1].partial, '帽子是');
  assert.equal(restored[1].text, '戴帽子。');
});

test('storage retains long transcripts and more than the undo-history limit', () => {
  let entries = [];
  for (let i = 0; i < 80; i++) entries = appendTextEntry(entries, `${i}：${'想象'.repeat(800)}`, `entry-${i}`, i);
  assert.deepEqual(restoreConversation(serializeConversation(entries)), entries);
  assert.equal(entries.length, 80);
});

test('archived batches and active entries recover in order without duplicating overlap', () => {
  const old = upsertVoiceEntry([], update('a', 1, '月亮。', '星星'), 10)[0];
  const final = upsertVoiceEntry([old], update('a', 2, '月亮。星星。', '', true), 20)[0];
  const typed = appendTextEntry([], '还有云朵。', 'typed', 30)[0];
  const restored = restoreConversation({ version: 1, archived: [[old], { entries: [typed] }], entries: [final, null, { id: 'invalid' }] });
  assert.equal(restored.length, 2);
  assert.equal(restored[0].text, '月亮。星星。');
  assert.equal(restored[0].status, 'saved');
  assert.equal(restored[1].text, '还有云朵。');
});

test('legacy scene history migrates spoken or typed phrases while omitting demo, reset and manual actions', () => {
  const history = ['从湖边开始', '画一条鲸鱼', '换一张空白纸', '重新从湖边开始', '手绘一笔'].map(phrase => ({ phrase }));
  history.push({ phrase: '任意手绘操作标签', source: 'manual' }, { phrase: '给它画顶帽子' });
  assert.deepEqual(restoreConversation(null, history).map(entry => entry.text), ['画一条鲸鱼', '给它画顶帽子']);
  assert.deepEqual(restoreConversation('{broken', history).map(entry => entry.text), ['画一条鲸鱼', '给它画顶帽子']);
  // A saved empty log is authoritative and must not resurrect old demo/history.
  assert.deepEqual(restoreConversation(serializeConversation([]), history), []);
});

test('recent API instructions use the latest stable speech, never unconfirmed tails, and do not mutate the whole log', () => {
  let entries = [];
  for (let i = 0; i < 7; i++) entries = appendTextEntry(entries, `第${i}个想法。`, `typed-${i}`, i);
  entries = upsertVoiceEntry(entries, update('voice', 1, '把它举起来。', '不要保存这个猜测'), 20);
  assert.deepEqual(recentInstructions(entries), ['第3个想法。', '第4个想法。', '第5个想法。', '第6个想法。', '把它举起来。']);
  assert.equal(entries.length, 8);
  assert.equal(entries[7].partial, '不要保存这个猜测');
});

test('long recent sessions preserve their final instruction rather than only their opening words', () => {
  const whole = `${'画一些云朵。'.repeat(800)}最后把男孩的右手举起来。`;
  const entries = upsertVoiceEntry([], update('long', 1, whole, '', true), 10);
  const recent = recentInstructions(entries);
  assert.equal(recent.length, 5);
  assert.ok(recent.every(text => text.length <= 600));
  assert.ok(recent.at(-1).endsWith('最后把男孩的右手举起来。'));
  assert.equal(entries[0].text, whole);
  const symbols = appendTextEntry([], `${'🌈'.repeat(1900)}画一朵花`, 'symbols', 10);
  assert.ok(recentInstructions(symbols).every(text => text.length <= 600 && !/[\uD800-\uDBFF]$/.test(text)));
  assert.ok(recentInstructions(symbols).at(-1).endsWith('画一朵花'));
});


test('omitting a confirmed sentence preserves meaningful words, later speech, partials and other sessions', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '画太阳。咕噜咕噜。画小花。', '还有'), 10);
  entries = upsertVoiceEntry(entries, update('b', 1, '咕噜咕噜。', '', true), 11);
  entries = appendTextEntry(entries, '咕噜咕噜。', 'text', 12);
  const omitted = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 4, end: 9 }], 20);
  assert.equal(omitted[0].text, '画太阳。画小花。');
  assert.equal(omitted[0].partial, '还有');
  assert.deepEqual(omitted[0].omittedRanges, [{ start: 4, end: 9 }]);
  assert.equal(omitted[1], entries[1]);
  assert.equal(omitted[2], entries[2]);
  assert.equal(entries[0].text, '画太阳。咕噜咕噜。画小花。', 'source state stays immutable');
});

test('cumulative ASR and empty terminal events cannot resurrect or double-remove omitted words', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '咕噜。画太阳。'), 10);
  entries = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 0, end: 3 }], 11);
  entries = upsertVoiceEntry(entries, update('a', 2, '咕噜。画太阳。再画小花。', '旁边'), 12);
  assert.equal(entries[0].text, '画太阳。再画小花。');
  entries = upsertVoiceEntry(entries, update('a', 3, '', '', true), 13);
  assert.equal(entries[0].text, '画太阳。再画小花。');
  assert.equal(entries[0].status, 'saved');
  assert.deepEqual(entries[0].omittedRanges, [{ start: 0, end: 3 }]);
});

test('successive, overlapping and duplicate omissions all address original coordinates', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '0123456789'), 10);
  entries = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 2, end: 4 }], 11);
  assert.equal(entries[0].text, '01456789');
  entries = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 6, end: 8 }], 12);
  assert.equal(entries[0].text, '014589');
  entries = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 3, end: 7 }], 13);
  assert.equal(entries[0].text, '0189');
  assert.deepEqual(entries[0].omittedRanges, [{ start: 2, end: 8 }]);
  assert.equal(omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 3, end: 7 }], 14), entries);
  entries = upsertVoiceEntry(entries, update('a', 2, '0123456789ABC'), 15);
  assert.equal(entries[0].text, '0189ABC');
});

test('an entirely omitted session is a persistable tombstone and later words still appear', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '咕噜。'), 10);
  entries = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 0, end: 3 }], 11);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, '');
  assert.equal(entries.filter(entry => entry.text.trim() || entry.partial.trim()).length, 0);
  const restored = restoreConversation(serializeConversation(entries));
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0].omittedRanges, [{ start: 0, end: 3 }]);
  assert.equal(restored[0].text, '');
  assert.ok(!serializeConversation(entries).includes('咕噜'), 'discarded raw text is not stored');
  entries = upsertVoiceEntry(entries, update('a', 2, '咕噜。画一朵花。'), 12);
  assert.equal(entries[0].text, '画一朵花。');
});

test('archived overlap carries omissions forward without restoring an empty sentence', () => {
  const raw = upsertVoiceEntry([], update('a', 1, '咕噜。'), 10)[0];
  const omitted = omitVoiceRanges([raw], [{ entryId: raw.id, start: 0, end: 3 }], 11)[0];
  assert.equal(restoreConversation({ archived: [[raw]], entries: [omitted] })[0].text, '');
  assert.equal(restoreConversation({ archived: [[omitted]], entries: [raw] })[0].text, '');
  const newerRaw = upsertVoiceEntry([raw], update('a', 2, '咕噜。画花。'), 12)[0];
  assert.equal(restoreConversation({ archived: [[omitted]], entries: [newerRaw] })[0].text, '画花。');
});

test('invalid or unresolvable deletion coordinates cannot remove speech', () => {
  const entries = upsertVoiceEntry([], update('a', 1, '画太阳。'), 10);
  assert.equal(omitVoiceRanges(entries, [
    { entryId: 'unknown', start: 0, end: 4 },
    { entryId: 'voice:a', start: -1, end: 4 },
    { entryId: 'voice:a', start: 1.5, end: 4 },
    { entryId: 'voice:a', start: 4, end: 1 },
    { entryId: 'voice:a', start: 0, end: 100 },
  ]), entries);
  const broken = restoreConversation([{ ...entries[0], text: '', partial: '', omittedRanges: [{ start: 1, end: 2 }, { start: 4, end: 100 }] }]);
  assert.equal(broken.length, 0, 'impossible empty tombstone is rejected');
  const sanitized = restoreConversation([{ ...entries[0], omittedRanges: [{ start: -1, end: 3 }, { start: 0, end: Infinity }, { start: 2, end: 20000 }] }]);
  assert.equal(sanitized[0].text, '画太阳。');
  assert.equal(sanitized[0].omittedRanges, undefined);
});

test('a changed ASR prefix cannot reuse old omitted coordinates against unrelated text', () => {
  let entries = upsertVoiceEntry([], update('a', 1, '咕噜。画太阳。'), 10);
  entries = omitVoiceRanges(entries, [{ entryId: 'voice:a', start: 0, end: 3 }], 11);
  assert.equal(upsertVoiceEntry(entries, update('a', 2, '画一只大象和小花。'), 12), entries);
  assert.equal(upsertVoiceEntry(entries, update('a', 3, '短。'), 13), entries);
});
