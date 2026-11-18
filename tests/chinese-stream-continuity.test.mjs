import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url), directory = new URL('../.sites-runtime/', import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL('chinese-stream-continuity-test.mjs', directory);
const built = await build({ stdin: { contents: "export * from './lib/chinese-rolling-speech';export * from './lib/chinese-hypothesis';export * from './lib/conversation';", resolveDir: root.pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, built.outputFiles[0].text); after(() => unlink(file));
const { ChineseRollingSpeech, reconcileChineseHypothesis: reconcile, stripChineseCommitted: strip, upsertVoiceEntry } = await import(file.href);
const tick = () => new Promise(resolve => setImmediate(resolve));
const voice = (seconds = .4, frequency = 220, dc = 0) => Int16Array.from({ length: Math.round(seconds * 16000) }, (_, i) => Math.round(dc + 1800 * Math.sin(2 * Math.PI * frequency * i / 16000))).buffer;
const quiet = (seconds = .6, dc = 0) => new Int16Array(Math.round(seconds * 16000)).fill(dc).buffer;
function rolling(name = 'zh') {
  const pending = [], updates = [], diagnostics = []; let failures = 0, conversation = [];
  const session = new ChineseRollingSpeech(name, pcm => new Promise(resolve => pending.push({ samples: pcm.length, resolve })), update => {
    updates.push(update); conversation = upsertVoiceEntry(conversation, update);
  }, () => failures++, 0, value => diagnostics.push(value));
  return { session, pending, updates, diagnostics, failures: () => failures, conversation: () => conversation,
    async reply(text) { assert.ok(pending.length, 'ASR pending'); pending.shift().resolve(text); await tick(); },
    stable: () => updates.at(-1)?.stableText ?? '', clauses: () => updates.flatMap(update => update.segments.map(segment => segment.text)),
  };
}

for (const dc of [0, 150, 2000]) test(`first internal pause survives audio buffered during HTTP (DC=${dc})`, async () => {
  const r = rolling(); r.session.feed(voice(.4, 220, dc));
  r.session.feed(quiet(.6, dc)); r.session.feed(voice(.4, 330, dc));
  await r.reply('画一座城堡。');
  // The next request stops at the first completed pause instead of including sentence two.
  assert.equal(r.pending[0].samples, 14400);
  await r.reply('画一座城堡。');
  assert.equal(r.stable(), '画一座城堡。'); assert.equal(r.pending[0].samples, 8000);
  await r.reply('旁边有一片森林。');
  assert.equal(r.updates.at(-1).partial, '旁边有一片森林。');
  r.session.feed(quiet(.6, dc)); await r.reply('旁边有一片森林。');
  assert.equal(r.stable(), '画一座城堡。旁边有一片森林。');
  assert.deepEqual(r.clauses(), ['画一座城堡。', '旁边有一片森林。']);
  assert.equal(r.conversation().at(-1).text, r.stable());
  assert.equal(r.failures(), 0); r.session.cancel();
});

test('three queued utterances drain in order while painting is irrelevant', async () => {
  const r = rolling(); r.session.feed(voice());
  r.session.feed(quiet()); r.session.feed(voice()); r.session.feed(quiet()); r.session.feed(voice());
  await r.reply('画一座城堡。'); assert.equal(r.pending[0].samples, 14400);
  await r.reply('画一座城堡。'); assert.equal(r.pending[0].samples, 16000);
  await r.reply('城堡旁边有森林。'); assert.equal(r.pending[0].samples, 8000);
  await r.reply('森林里有小熊。'); r.session.finish(); await r.reply('森林里有小熊。');
  assert.deepEqual(r.clauses(), ['画一座城堡。', '城堡旁边有森林。', '森林里有小熊。']);
  assert.equal(r.stable(), r.clauses().join('')); assert.equal(r.updates.at(-1).done, true);
});

test('finish drains internal pauses instead of joining a later ASR tail to an earlier utterance', async () => {
  const r = rolling(); r.session.feed(voice()); r.session.feed(quiet()); r.session.feed(voice()); r.session.finish();
  await r.reply('画一只猫。'); assert.equal(r.pending[0].samples, 14400);
  await r.reply('画一只猫。'); await r.reply('画一只狗。');
  assert.equal(r.stable(), '画一只猫。画一只狗。'); assert.equal(r.updates.at(-1).done, true);
});

test('a pause spanning retained overlap is found before the next utterance', async () => {
  const r = rolling(); r.session.feed(voice()); r.session.feed(voice(11.4)); r.session.feed(quiet()); r.session.feed(voice());
  await r.reply('画一座城堡。'); assert.equal(r.pending[0].samples, 192000);
  await r.reply('画一座城堡。');
  // Retained audio begins at10s; first pause completes at12.3s.
  assert.equal(r.pending[0].samples, 36800);
  await r.reply('画一座城堡。'); await r.reply('旁边有森林。');
  r.session.finish(); await r.reply('旁边有森林。');
  assert.deepEqual(r.clauses(), ['画一座城堡。', '旁边有森林。']);
});

test('an incomplete relation crosses an internal pause without becoming a separate drawing', async () => {
  const r = rolling(); r.session.feed(voice()); r.session.feed(quiet()); r.session.feed(voice());
  await r.reply('在小猫的'); await r.reply('在小猫的');
  assert.equal(r.stable(), ''); assert.equal(r.updates.at(-1).partial, '在小猫的');
  await r.reply('左边画一朵花。'); r.session.finish(); await r.reply('左边画一朵花。');
  assert.deepEqual(r.clauses(), ['在小猫的左边画一朵花。']);
});

for (const fragment of ['画一只小猫。', '在小猫的', '画一个红色的球，不对，应该是蓝色']) test(`empty paused redecode retains earlier words: ${fragment}`, async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply(fragment); r.session.feed(quiet()); await r.reply('');
  assert.equal(r.stable() + r.updates.at(-1).partial, fragment);
  r.session.finish(); assert.equal(r.pending.length, 0); assert.equal(r.stable(), fragment); assert.equal(r.updates.at(-1).done, true);
});

test('empty explicit final redecode preserves a pending draft', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一座城堡。'); r.session.finish(); await r.reply('');
  assert.equal(r.stable(), '画一座城堡。'); assert.equal(r.updates.at(-1).done, true);
});

test('empty first recognition does not create text or freeze a later valid hypothesis', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply(''); r.session.feed(voice()); await r.reply('画一朵花。');
  r.session.finish(); await r.reply('画一朵花。'); assert.deepEqual(r.clauses(), ['画一朵花。']);
});

for (const second of ['旁边有一片森林。', '画一只小狗。']) test(`confirmed speech survives a whole unmatched later clause: ${second}`, async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一只小猫。'); r.session.feed(voice()); await r.reply('画一只小猫。');
  r.session.feed(voice()); await r.reply(second);
  assert.equal(r.stable(), '画一只小猫。'); assert.equal(r.updates.at(-1).partial, second);
  r.session.feed(quiet()); await r.reply(second);
  assert.deepEqual(r.clauses(), ['画一只小猫。', second]); assert.equal(r.stable(), '画一只小猫。' + second); r.session.cancel();
});

test('exact known suffix reconnects an abbreviated window without replaying its prefix', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一座城堡。旁边有一');
  r.session.feed(voice()); await r.reply('旁边有一片森林。'); r.session.finish(); await r.reply('旁边有一片森林。');
  assert.deepEqual(r.clauses(), ['画一座城堡。', '旁边有一片森林。']);
});

for (const [first, second] of [
  ['画一只小猫。', '画一只小狗。'],
  ['华一。', '画一座小房子。'],
  ['画一个红色的球。', '画一个蓝色的球。'],
  ['画一只猫。', '旁边有森林。'],
]) test(`unconfirmed ASR revisions remain revisions without acoustic evidence: ${first} -> ${second}`, async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply(first); r.session.feed(voice()); await r.reply(second);
  assert.equal(r.stable(), ''); assert.equal(r.updates.at(-1).partial, second);
  r.session.finish(); await r.reply(second); assert.equal(r.stable(), second);
});

test('a spoken self-correction remains one complete thought', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一个红色的球');
  r.session.feed(voice()); await r.reply('画一个红色的球，不对，应该是蓝色'); r.session.feed(quiet()); await r.reply('画一个红色的球，不对，应该是蓝色');
  assert.deepEqual(r.clauses(), ['画一个红色的球，不对，应该是蓝色']); r.session.cancel();
});

test('strict stripping accepts punctuation refinements but never fuzzy eats a new noun', () => {
  assert.equal(strip('画一只小猫，旁边有花。', '画一只小猫。'), '旁边有花。');
  assert.equal(strip('画一只小狗。', '画一只小猫。'), undefined);
  assert.equal(strip('旁边有森林。', '画一座城堡。'), undefined);
  assert.equal(reconcile('画一只小猫。', '画一只小狗。', '画一只小猫。').text, '画一只小猫。画一只小狗。');
});

test('continuous cumulative Chinese still commits before the microphone is stopped', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一只小猫');
  r.session.feed(voice()); await r.reply('画一只小猫，然后画一朵花');
  assert.deepEqual(r.clauses(), ['画一只小猫，']); assert.equal(r.updates.at(-1).done, false);
  r.session.feed(voice()); await r.reply('画一只小猫。然后画一朵花。天上有太阳');
  assert.deepEqual(r.clauses(), ['画一只小猫，', '然后画一朵花。']); r.session.cancel();
});

test('diagnostics contain only lengths, offsets, boolean state and a branch', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('私人的句子。');
  assert.deepEqual(Object.keys(r.diagnostics[0]).sort(), ['windowStart', 'windowEnd', 'paused', 'cutAtPause', 'rawLength', 'committedLength', 'partialLength', 'branch'].sort());
  assert.equal(JSON.stringify(r.diagnostics).includes('私人'), false); assert.equal(r.diagnostics[0].windowEnd, 6400); r.session.cancel();
});
