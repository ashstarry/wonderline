import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const file = new URL('../.sites-runtime/speech-annotations-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const built = await build({ stdin: { contents: "export * from './lib/speech-annotations'; export * from './lib/rolling-speech'; export * from './lib/chinese-rolling-speech';", resolveDir: root.pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, built.outputFiles[0].text); after(() => unlink(file));
const { stripAsrSoundEvents: strip, RollingSpeech, ChineseRollingSpeech } = await import(file.href);

const removed = [
  '[music]', '(background music)', '[outro jingle]', '(instrumental music)', '[intro music]', '[music playing]', '[on-hold music]', '[hold music]',
  '[applause]', '(clapping)', '[laughter]', '(laughs)', '[laughing]', '[cough]', '(coughs)', '[coughing]',
  '(sneeze)', '[sneezes]', '[sneezing]', '(clears throat)', '[throat-clearing]', '[clearing throat]', '[footsteps]',
  '[breathing]', '(inhales)', '[exhales]', '(sighs)', '[smacks lips]', '[lip smacking]', '[background noise]',
  '[silence]', '[static]', '[rustling]', '[humming]', '[whistling]',
  '[音乐]', '（背景音乐）', '【片尾音乐】', '(掌声)', '[鼓掌]', '（笑声）', '[咳嗽声]', '【打喷嚏】',
  '[喷嚏声]', '(清嗓子)', '[清嗓声]', '（脚步声）', '[呼吸声]', '[叹气]', '【咂嘴声】', '[背景杂音]',
  '[  BACKGROUND   MUSIC  ]', '[throat_clearing]',
];
for (const annotation of removed) test(`removes only the explicit event ${annotation}`, () => {
  assert.equal(strip(annotation), '');
  assert.equal(strip(`Draw a cat. ${annotation} Add a flower.`), 'Draw a cat. Add a flower.');
  assert.equal(strip(`画一只猫。${annotation}旁边画一朵花。`), '画一只猫。旁边画一朵花。');
});

const untouched = [
  '', 'Draw a sneezing bear.', 'Draw a coughing dragon with music notes.', 'Draw a laughing child.',
  'The music is coming from a rainbow radio.', 'Draw a trumpet. The dog is humming.',
  '画一个打喷嚏的小熊。', '画一个正在咳嗽的小龙。', '小朋友在唱歌，旁边是音乐盒。', '音乐在森林里飘荡。',
  'Um, uh, draw a cat. No, make it a dog.', '嗯，啊，画一只猫，不对，画小狗。',
  'Draw the queen and the key.', 'This is a red horse. Actually it should be green.',
  'Twinkle, twinkle, little star.', '一闪一闪亮晶晶，满天都是小星星。',
  '[snowman]', '(red)', '【花园】', '(left of the tree)', '[music notes]', '[sneezing bear]', '[咳嗽的小龙]',
  '[music and laughter]', '[a very loud and unusual sound]', '[unknown]', '[background [music]]',
  '[music)', '(music]', 'Draw a cat [sneeze with glitter]', 'Draw a cat [snow', 'Draw a cat [music notes',
  'Draw a cat [m', 'Draw a cat [mu', 'Draw a cat [', '画一朵花[音',
  'Draw "[music]" on the sign.', "Draw '[music]' on the sign.", 'Draw `[music]` on the sign.',
  'Draw “(sneeze)” on the sign.', '画一个写着“【音乐】”的牌子。', '在招牌上写出[音乐]。',
  'Write [music] on the sign.', 'Spell [cough] with colorful letters.', 'Type [music].',
  'Add the text [music] on a card.', 'Label it [music].', 'Draw a box named [music].',
  'Write [snee', '在纸上写上[背景音', 'Draw a sign saying "[music]',
  '  Draw  a  cat.  ', 'Draw a cat.\nThen a dog.',
];
for (const text of untouched) test(`preserves literal/creative speech: ${text.slice(0, 65)}`, () => assert.equal(strip(text), text));

test('removes adjacent events without joining English words or spacing Chinese characters', () => {
  assert.equal(strip('Draw[music]a cat.'), 'Draw a cat.');
  assert.equal(strip('Draw [music][cough] a cat.'), 'Draw a cat.');
  assert.equal(strip('Draw[music] [cough]a cat.'), 'Draw a cat.');
  assert.equal(strip('画[音乐][咳嗽]一只猫。'), '画一只猫。');
  assert.equal(strip('画 [音乐] 一只猫。'), '画一只猫。');
  assert.equal(strip('Draw a cat [music], then a dog.'), 'Draw a cat, then a dog.');
  assert.equal(strip('Draw a cat.[music] Add a dog.'), 'Draw a cat. Add a dog.');
  assert.equal(strip('[music] [cough].'), '');
});

test('quote parsing does not confuse contractions or possessives with literal quotation', () => {
  assert.equal(strip("Let's draw a cat. [music] It's small."), "Let's draw a cat. It's small.");
  assert.equal(strip('It’s a cat. [cough] Draw a dog.'), 'It’s a cat. Draw a dog.');
  assert.equal(strip("The dogs' ball is red. [music] Draw a cat."), "The dogs' ball is red. Draw a cat.");
  assert.equal(strip('Draw "[music]". [cough] Add a sun.'), 'Draw "[music]". Add a sun.');
  assert.equal(strip('Write a sign. [music] Add a dog.'), 'Write a sign. Add a dog.');
});

test('unfinished known tags are suppressed without waiting or suppressing unknown suffixes', () => {
  for (const label of ['music', 'background music', 'sneezing', 'clears throat', 'outro jingle']) {
    for (let n = 3; n <= label.length; n++) assert.equal(strip(`Draw a cat. [${label.slice(0, n)}`), 'Draw a cat.');
  }
  for (const prefix of ['背景', '背景音', '打喷', '清嗓']) assert.equal(strip(`画一只猫。[${prefix}`), '画一只猫。');
  assert.equal(strip('Draw a cat. [snow'), 'Draw a cat. [snow');
  assert.equal(strip('Draw a cat. [musical castle'), 'Draw a cat. [musical castle');
  assert.equal(strip('Draw a cat. [snee draft'), 'Draw a cat. [snee draft');
});

test('bounded label matching preserves very long or nested unknown bracket text', () => {
  const long = `Draw [${'music '.repeat(10000)}] and a cat.`;
  assert.equal(strip(long), long);
  const nested = `${'['.repeat(10000)}music${']'.repeat(10000)}`;
  assert.equal(strip(nested), nested);
  const many = 'Draw [music] a flower. '.repeat(2000);
  assert.equal(strip(many), 'Draw a flower. '.repeat(2000));
});

test('sanitization is idempotent and does not revise untagged speech', () => {
  for (const text of [...untouched, ...removed, 'Draw [music] a cat. [cough]', '画[音乐]一只猫。[背景音']) assert.equal(strip(strip(text)), strip(text));
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const voice = (seconds = .6) => Int16Array.from({ length: Math.round(seconds * 16000) }, (_, i) => Math.round(1800 * Math.sin(2 * Math.PI * 220 * i / 16000))).buffer;
function rolling(Session, id) {
  const pending = [], updates = [];
  const session = new Session(id, () => new Promise(resolve => pending.push(text => resolve(strip(text)))), update => updates.push(update), () => assert.fail('recognition failed'));
  return { session, updates, async reply(text) { assert.ok(pending.length); pending.shift()(text); await tick(); },
    text: () => updates.at(-1)?.stableText ?? '', clauses: () => updates.flatMap(update => update.segments.map(segment => segment.text)) };
}

for (const Session of [RollingSpeech, ChineseRollingSpeech]) {
  test(`${Session.name}: noise-only ASR responses emit no drawing segments`, async () => {
    const r = rolling(Session, 'noise'); r.session.feed(voice()); r.session.finish();
    await r.reply('[background music] [sneezing]'); await r.reply('[background music] [sneezing]');
    assert.equal(r.text(), ''); assert.deepEqual(r.clauses(), []); assert.equal(r.updates.at(-1).done, true);
    assert.ok(r.updates.every(update => update.partial === ''));
  });
  test(`${Session.name}: removing events before assembly keeps stable, partial and segment text aligned`, async () => {
    const chinese = Session === ChineseRollingSpeech;
    const first = chinese ? '画一只小猫。' : 'Draw a cat.';
    const second = chinese ? '旁边画一朵花。' : 'Add a flower.';
    const separator = chinese ? '' : ' ';
    const r = rolling(Session, 'speech'); r.session.feed(voice());
    await r.reply(`${first}[snee`);
    assert.equal(r.updates.at(-1).partial, first);
    r.session.feed(voice()); await r.reply(`${first} [sneezing] ${second}`);
    r.session.finish(); await r.reply(`${first} [sneezing] ${second}`);
    assert.equal(r.text(), first + separator + second);
    assert.equal(r.clauses().join(separator), first + separator + second);
    assert.ok(r.updates.every(update => !/snee|\[|\]/.test(update.stableText + update.partial)));
  });
}
