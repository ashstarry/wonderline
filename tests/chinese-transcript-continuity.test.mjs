import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const built = await build({ stdin: {
  contents: `export * from './lib/chinese-rolling-speech';
export * from './lib/conversation';
export * from './lib/transcript-omission';
export * from './lib/content-filter-transcript';`, resolveDir: root.pathname,
}, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const voice = (seconds = .4, dc = 0) => Int16Array.from({ length: Math.round(seconds * 16000) },
  (_, i) => Math.round(dc + 1500 * Math.sin(2 * Math.PI * 280 * i / 16000))).buffer;
const quiet = (seconds = .6, dc = 0) => new Int16Array(Math.round(seconds * 16000)).fill(dc).buffer;

// Exercise the same boundary between server recognition and the visible page:
// observe source positions before screening, then replace the conversation.
// No model, browser, saved user transcript, or secret is needed.
function pageChain(initial = []) {
  let entries = initial;
  const index = new api.VoiceTranscriptIndex(), frames = [], delivered = [], sessions = [];
  function start(id) {
    const pending = [], errors = [];
    const session = new api.ChineseRollingSpeech(id,
      (_pcm, signal) => new Promise(resolve => pending.push({ resolve, signal })), update => {
        index.observe(update);
        const screened = api.filterVoiceTranscript(entries, update, index);
        entries = screened.conversation;
        delivered.push(...screened.allowed);
        frames.push({ update, display: entries.map(entry => entry.text + entry.partial) });
      }, () => errors.push('speech failed'));
    sessions.push(session);
    return { session, pending, errors,
      async reply(text) {
        assert.ok(pending.length, 'recognition request should already be running');
        pending.shift().resolve(text); await tick();
      },
    };
  }
  return { start, frames, delivered, index, entries: () => entries,
    omit(targets) { entries = api.omitVoiceRanges(entries, index.validTargets(targets)); },
    close() { sessions.forEach(session => session.cancel()); },
  };
}

for (const dc of [0, 1800]) test(`the displayed Chinese transcript accumulates three utterances while recognition is busy (DC ${dc})`, async () => {
  const page = pageChain(), r = page.start('continuous');
  try {
    r.session.feed(voice(.4, dc));
    r.session.feed(quiet(.6, dc)); r.session.feed(voice(.4, dc));
    r.session.feed(quiet(.6, dc)); r.session.feed(voice(.4, dc));
    await r.reply('画一座城堡。');
    assert.deepEqual(page.frames.at(-1).display, ['画一座城堡。']);
    await r.reply('画一座城堡。');
    assert.equal(page.delivered.length, 1, 'first drawing instruction is ready before microphone stop');
    await r.reply('旁边画一片森林。');
    await r.reply('森林里有一只小熊。');
    r.session.finish(); await r.reply('森林里有一只小熊。');
    const expected = ['画一座城堡。', '旁边画一片森林。', '森林里有一只小熊。'];
    assert.deepEqual(page.delivered.map(segment => segment.text), expected);
    assert.equal(new Set(page.delivered.map(segment => segment.id)).size, expected.length);
    assert.deepEqual(page.frames.at(-1).display, [expected.join('')]);
    assert.equal(page.entries()[0].partial, '');
    assert.equal(page.entries()[0].status, 'saved');
    assert.ok(page.frames.slice(2).every(frame => frame.display[0].startsWith(expected[0])), 'later partials never erase committed first utterance');
    const targets = page.index.targets(page.delivered), stable = page.frames.at(-1).update.stableText;
    assert.deepEqual(targets.map(target => stable.slice(target.start, target.end)), expected);
    assert.equal(page.index.validTargets(targets).length, expected.length);
    assert.deepEqual(r.errors, []);
  } finally { page.close(); }
});

test('an unfinished Chinese relation survives a buffered pause without being separately drawn or overwritten', async () => {
  const page = pageChain(), r = page.start('relation');
  try {
    r.session.feed(voice()); r.session.feed(quiet()); r.session.feed(voice());
    await r.reply('在小猫的'); await r.reply('在小猫的');
    assert.deepEqual(page.frames.at(-1).display, ['在小猫的']);
    assert.equal(page.delivered.length, 0);
    await r.reply('左边画一朵花。');
    assert.deepEqual(page.frames.at(-1).display, ['在小猫的左边画一朵花。']);
    r.session.finish(); await r.reply('左边画一朵花。');
    assert.deepEqual(page.delivered.map(segment => segment.text), ['在小猫的左边画一朵花。']);
    assert.equal(page.entries()[0].text, '在小猫的左边画一朵花。');
    assert.equal(page.index.targets(page.delivered).length, 1);
  } finally { page.close(); }
});

test('a delayed drawing rollback removes only its earlier Chinese sentence, not new speech or future updates', async () => {
  const page = pageChain(), r = page.start('rollback');
  try {
    r.session.feed(voice()); await r.reply('画一只小猫。');
    r.session.feed(quiet()); await r.reply('画一只小猫。');
    const firstTarget = page.index.targets(page.delivered);
    r.session.feed(voice()); await r.reply('画一棵大树。');
    page.omit(firstTarget);
    assert.equal(page.entries()[0].text, '');
    assert.equal(page.entries()[0].partial, '画一棵大树。');
    r.session.feed(quiet()); await r.reply('画一棵大树。');
    r.session.feed(voice()); await r.reply('天上有太阳。');
    r.session.finish(); await r.reply('天上有太阳。');
    assert.equal(page.entries()[0].text, '画一棵大树。天上有太阳。');
    assert.deepEqual(page.delivered.map(segment => segment.text), ['画一只小猫。', '画一棵大树。', '天上有太阳。']);
    assert.equal(page.index.targets(page.delivered).length, 3, 'source coordinates remain cumulative despite display omission');
  } finally { page.close(); }
});

test('microphone restart adds a new Chinese record while retaining the completed previous record', async () => {
  const page = pageChain();
  try {
    const first = page.start('first');
    first.session.feed(voice()); await first.reply('画一座小房子。');
    first.session.finish(); await first.reply('画一座小房子。');
    const second = page.start('second');
    second.session.feed(voice()); await second.reply('房子旁边有一朵花。');
    assert.deepEqual(page.frames.at(-1).display, ['画一座小房子。', '房子旁边有一朵花。']);
    second.session.finish(); await second.reply('房子旁边有一朵花。');
    assert.deepEqual(page.entries().map(entry => entry.text), ['画一座小房子。', '房子旁边有一朵花。']);
    assert.deepEqual(page.delivered.map(segment => segment.id), ['first:1', 'second:1']);
    assert.deepEqual(page.index.targets(page.delivered).map(target => target.entryId), ['voice:first', 'voice:second']);
  } finally { page.close(); }
});

test('unconfirmed recognition corrections still replace the draft without painting both guesses', async () => {
  const page = pageChain(), r = page.start('revision');
  try {
    r.session.feed(voice()); await r.reply('画一只小猫。');
    r.session.feed(voice()); await r.reply('画一只小狗。');
    assert.deepEqual(page.frames.at(-1).display, ['画一只小狗。']);
    assert.equal(page.delivered.length, 0);
    r.session.finish(); await r.reply('画一只小狗。');
    assert.deepEqual(page.delivered.map(segment => segment.text), ['画一只小狗。']);
    assert.equal(page.entries()[0].text, '画一只小狗。');
  } finally { page.close(); }
});
