import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const directory = new URL('../.sites-runtime/', import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL('chinese-speech-boundary-test.mjs', directory);
const result = await build({ entryPoints: [new URL('../lib/chinese-speech-boundary.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, result.outputFiles[0].text); after(() => unlink(file));
const { selectChineseSpeechBoundary: select, splitChineseSpeechClauses: split, isIncompleteChineseSpeech: incomplete } = await import(file.href);

const unfinished = [
  '', ' ', '嗯', '嗯嗯啊', '呃，嗯', '画', '我要画', '给我画', '请画', '我想画个',
  '画一', '画一个', '画两只', '画三个', '画一朵', '画一只小', '画一只很大', '画一只蓝色',
  '画一只蓝色的', '给小猫', '把小猫', '把小猫放在', '把小猫移到', '把小猫挪到', '让小猫',
  '小猫在', '它的旁边有', '旁边有一只', '它抱着', '它拿着', '它戴着', '它变成', '它应该是',
  '在小猫旁边', '在城堡前面', '然后', '接着', '而且', '还有', '不是红色', '不对', '我是说',
  '把小猫放在，嗯', '画一个。', '幫我畫', '畫兩隻', '把小貓放在', '還有', '不是紅色',
  '画一匹', '画一头', '画一位', '画一艘', '画一栋', '画一顶', '画一根', '画一束', '画一排',
  '画一支', '画一杯', '画一枚', '画一盆', '画一串', '画一篮', '画一扇', '画两盏', '画三朵',
  '画一只会', '画一个可以', '画一个喜欢', '它应该像', '它看起来像',
  '然后在房子', '然后在房子旁边', '然后在天空', '然后在天空画', '接着在图书馆旁边',
  '再在大树后面', '另外在游乐园前面', '在灯塔旁边', '然后在桥梁右边', '房子旁边',
  '图书馆右边', '畫一架', '画一架', '画三个气球和一架', '画三。个气球和一架',
];
for (const text of unfinished) test(`pause keeps incomplete grammar: ${JSON.stringify(text)}`, () => {
  assert.equal(incomplete(text), true);
  assert.equal(select(text, text, { paused: true }).committed, '');
});

const complete = [
  '画一只猫', '画个太阳', '给我画一座城堡', '湖边有一座小木屋', '小猫在树下', '把小猫放在右边',
  '把小猫放大', '把城堡缩小', '把它往左移一点点', '给花涂成红色', '不要画小狗', '删除小狗',
  '画一片群山', '山下有个寺庙', '画一只龙它正在喷火', '这是一个小朋友', '让它举起手',
  '不是红色而是蓝色', '不对应该画一个金鱼', '改成粉色', '画一只蓝色小狗', '画一个数字三',
  '画一个标着3的气球', '帮我画一个叫小小的孩子', '畫一隻小狗', '把小貓移到左邊',
  '畫一朵紅色的小花', 'Draw a puppy在左边', '画一个 UFO', '画个圆😊',
  '画一幅画像', '画一座雕像', '画一片草地', '给小狗一顶帽子', '画一艘飞船', '画一匹白马',
  '画一位公主', '画一栋房屋', '画一盏灯', '画一扇窗户', '画一串葡萄', '画一滴雨水',
  '画一头粉色大象', '画一位戴帽子的孩子', '画一只会画画的小猫', '画一个喜欢画画的小朋友',
  '然后在房子旁边画一棵树', '接着在图书馆旁边放一朵花', '在天空画三个气球', '再在大树后面画小狗',
  '然后在桥梁右边画一艘船', '在灯塔旁边画一艘船', '画三个气球和一架直升机',
];
for (const text of complete) test(`pause releases complete phrase without adding a timer: ${text}`, () => {
  const value = select('', text, { paused: true });
  assert.equal(value.committed, text);
  assert.equal(value.pending, '');
  assert.equal(value.reason, 'pause');
});

test('an isolated complete noun phrase does not anticipate unseen continuation', () => {
  assert.equal(select('画一只小猫', '画一只小猫').committed, '');
  assert.equal(select('画一只小猫', '画一只小猫旁边的小狗').committed, '');
});

const boundaryCases = [
  ['画一只小猫然后', '画一只小猫然后画一只小狗', '画一只小猫'],
  ['画一只小猫', '画一只小猫然后画一只小狗', '画一只小猫'],
  ['画一个太阳再画', '画一个太阳再画一朵花', '画一个太阳'],
  ['画一只小狗接着', '画一只小狗接着画一只猫', '画一只小狗'],
  ['画一座城堡另外', '画一座城堡另外加一点星星', '画一座城堡'],
  ['画一只猫。', '画一只猫。', '画一只猫。'],
  ['画一只猫', '画一只猫。', ''],
  ['画一只猫然后画一只狗', '画一只猫，然后画一只狗。', '画一只猫，'],
  ['画一只猫，', '画一只猫，在它旁边画花', '画一只猫，'],
  ['画一只猫再画一只狗还有', '画一只猫再画一只狗还有一只羊', '画一只猫再画一只狗'],
  ['画一只猫画一只狗', '画一只猫画一只狗', '画一只猫'],
  ['画一片草地天上有', '画一片草地天上有太阳', '画一片草地'],
  ['畫一隻小貓然後', '畫一隻小貓然後畫一條魚', '畫一隻小貓'],
  ['画一只小猫，', '画一只小狗，旁边有花', ''],
  ['画个圆😊然后', '画个圆😊然后画个方块', '画个圆😊'],
];
for (const [previous, current, expected] of boundaryCases) test(`stable prefix: ${previous} → ${current}`, () => {
  const value = select(previous, current);
  assert.equal(value.committed, expected);
  assert.equal(value.committed + value.pending, current);
});

test('pause releases earlier stable clauses but retains their incomplete successor', () => {
  const text = '画一只小猫。然后把小猫放在';
  const result = select(text, text, { paused: true });
  assert.equal(result.committed, '画一只小猫。');
  assert.equal(result.pending, '然后把小猫放在');
});

test('negative repairs do not detach from the original instruction', () => {
  const text = '画一个红色的球，不对，应该是蓝色';
  assert.deepEqual(split(text), [text]);
  assert.equal(select(text, text).committed, '');
  assert.equal(select(text, text, { paused: true }).committed, text);
  for (const repair of ['画一只猫，不，画一只狗', '画一只猫，不对，画一只狗', '画个球，不是红色，而是蓝色']) {
    assert.deepEqual(split(repair), [repair]);
    assert.equal(select(repair, repair, { paused: true }).committed, repair);
  }
});

test('list commas never detach a classifier or adjective prefix', () => {
  const text = '画一只红色的，穿裙子的，小猫';
  assert.deepEqual(split(text), [text]);
  assert.equal(select(text, text).committed, '');
});

test('nested drawing predicates are not treated as an independent next object', () => {
  for (const text of ['画一个会画一只小猫的小朋友', '画一个喜欢画一朵花的小朋友', '画一只正在画一朵花的小猫']) {
    assert.deepEqual(split(text), [text]);
    assert.equal(select(text, text).committed, '');
  }
});

test('attached noun locations do not become isolated components', () => {
  for (const text of ['然后在房子旁边画一棵树', '图书馆右边画一朵花', '再在大树后面画一只小狗', '画家旁边画一朵花', '城堡前面画一个公主']) {
    assert.deepEqual(split(text), [text]);
    assert.equal(select(text, text).committed, '');
  }
});

test('actual continuous audio hypotheses keep the house-to-tree location together', () => {
  // Captured Fish ASR outputs, not invented correct punctuation. Earlier
  // implementation incorrectly emitted "然后在房子" before "旁边画一棵树".
  const trace = [
    '华一。', '画一座小。', '画一座小房。', '画一座小房子，然。', '画一座小房子，然后再。',
    '画一座小房子，然后在房子旁边。', '画一座小房子，然后在房子旁边画。',
    '画一座小房子，然后在房子旁边画一棵。', '画一座小房子，然后在房子旁边画一棵树。',
    '画一座小房子，然后在房子旁边画一棵树，再画一。', '画一座小房子，然后在房子旁边画一棵树，再画一只。',
    '画一座小房子，然后在房子旁边画一棵树，再画一只小狗。',
    '画一座小房子，然后在房子旁边画一棵树，再画一只小狗。',
  ];
  let previous = '';
  const allowable = new Set(['', '画一座小房子，', '画一座小房子，然后在房子旁边画一棵树，', trace.at(-1)]);
  const results = [];
  for (const current of trace) {
    const result = select(previous, current);
    assert.ok(allowable.has(result.committed), `unexpected fragment: ${result.committed}`);
    assert.equal(result.committed + result.pending, current);
    results.push(result); previous = current;
  }
  assert.equal(results[4].committed, '画一座小房子，');
  assert.equal(results[9].committed, '画一座小房子，然后在房子旁边画一棵树，');
  assert.deepEqual(results.at(-1).clauses, ['画一座小房子，', '然后在房子旁边画一棵树，', '再画一只小狗。']);
});

test('quantity interrupted by ASR punctuation stays attached to its classifier', () => {
  for (const text of ['然后在天空画三。个气球和一架', '在树旁边画两。只猫和一只']) {
    assert.equal(select(text, text, { paused: true }).committed, '');
  }
  assert.deepEqual(split('然后在天空画三。个气球和一架直升机。'), ['然后在天空画三。个气球和一架直升机。']);
  // Misrecognition of 一架 as the valid noun 衣架 cannot be solved by a
  // boundary heuristic without guessing or a special-case vocabulary.
  const wronglyRecognised = '画三。个气球和衣架。';
  assert.equal(select(wronglyRecognised, wronglyRecognised, { final: true }).committed, wronglyRecognised);
});

test('decimal values and quoted connectors are not clause boundaries', () => {
  for (const text of ['把小狗放大到1.5倍', '画一只1.2米高的小熊', '画个写着“你好，然后再见”的牌子', '画一个叫「然后」的小人', '画一个写着"你好，再见"的牌子']) {
    assert.deepEqual(split(text), [text]);
    assert.equal(select(text, text).committed, '');
  }
  assert.deepEqual(split('画个写着“你好，然后再见”的牌子，然后画只猫'), ['画个写着“你好，然后再见”的牌子，', '然后画只猫']);
});

test('provider settled prefix can release a clause without a second hypothesis', () => {
  const text = '画一只小猫。然后画一条鲸鱼';
  assert.equal(select('', text, { settledText: '画一只小猫。' }).committed, '画一只小猫。');
  assert.equal(select('', text, { settledText: '画一只小狗。' }).committed, '');
});

test('a provider settled prefix is not permission to cut through a word', () => {
  assert.equal(select('', '画一只小猫旁边的小狗', { settledText: '画一只小猫' }).committed, '');
});

test('explicit microphone finish never drops a fragment, filler or unstabilised last phrase', () => {
  for (const text of [...unfinished, ...complete]) {
    const value = select('', text, { final: true });
    assert.equal(value.committed, text);
    assert.equal(value.pending, '');
    assert.equal(value.clauses.join(''), text);
  }
});

test('genuine repeated drawing commands are not deduplicated by a boundary helper', () => {
  const text = '画一只猫。画一只猫。';
  assert.equal(select(text, text).committed, text);
  assert.deepEqual(split(text), ['画一只猫。', '画一只猫。']);
});

test('stutters and sound tags remain exact text rather than semantic correction', () => {
  const text = '嗯，画一个，一个小狗。[笑声]然后画一朵花';
  const value = select('', text, { final: true });
  assert.equal(value.committed, text);
  assert.equal(value.clauses.join(''), text);
});

test('an earlier committed clause is stable under growing and revising its pending tail', () => {
  const prefix = '画一只小猫。';
  let previous = prefix;
  for (const tail of ['然后把', '然后把小猫放在', '然后把小猫放在左边', '然后把小猫放在右边']) {
    const current = prefix + tail;
    const value = select(previous, current);
    assert.equal(value.committed, prefix);
    previous = current;
  }
});

test('every pair of successive character prefixes conserves source and commits stable content only', () => {
  const scenarios = [
    '画一只小猫然后画一只小狗接着画一朵花。',
    '画一条美人鱼。它右边有一条小金鱼。',
    '画一个男孩，把他的手举起来，然后给他戴顶帽子。',
    '画一个蓝色的，不对，是红色的球。',
    '画一片群山山下有一个寺庙寺庙里有一位和尚。',
    '画一个足球场，然后天上有个直升机在直播。',
    '画个城堡。城堡前面有个公主。然后画一条龙。',
    '畫一隻小貓然後畫一條鯨魚。',
    '画一个UFO，然后在旁边画个小熊😊。',
  ];
  for (const text of scenarios) {
    let previous = '';
    for (const char of text) {
      const current = previous + char, value = select(previous, current);
      assert.equal(value.committed + value.pending, current);
      assert.equal(value.clauses.join(''), value.committed);
      assert.ok(current.startsWith(value.committed));
      assert.ok(!/[\ud800-\udbff]$/u.test(value.committed));
      previous = current;
    }
    assert.equal(select(previous, previous, { final: true }).committed, text);
  }
});

test('local boundary microbenchmark has no timer/network wait and reports CPU-only timing', t => {
  const text = '画一个小男孩然后在他旁边画一只小狗接着给小狗画一个红色的球。';
  for (let i = 0; i < 100; i++) select(text, text);
  const samples = [];
  for (let i = 0; i < 5000; i++) { const start = performance.now(); select(text, text); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  t.diagnostic(JSON.stringify({ calls: samples.length, medianMs: samples[2500], p95Ms: samples[4750], maxMs: samples.at(-1), note: 'Local CPU only; not ASR, endpoint or first-stroke latency.' }));
  assert.ok(samples.every(Number.isFinite));
});

test('a character and its spoken role or action stay in one drawing segment', () => {
  for (const phrase of ['有两个地魔，他们是守门员。','画一只小猫，它正在跳舞。','有兩個小朋友，她們在操場上跑步。']) {
    assert.deepEqual(split(phrase), [phrase]);
    assert.deepEqual(select('', phrase, { final: true }).clauses, [phrase]);
  }
  assert.equal(select('有两个地魔。', '有两个地魔，他们是。').committed, '');
  assert.deepEqual(split('有两个地魔，他们是守门员。然后画足球。'), ['有两个地魔，他们是守门员。', '然后画足球。']);
  assert.deepEqual(split('画一只猫，旁边有朵花。'), ['画一只猫，', '旁边有朵花。']);
});
