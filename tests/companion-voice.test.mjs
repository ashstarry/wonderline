import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const file = new URL('../.sites-runtime/companion-voice-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const built = await build({ stdin: { contents: "export * from './lib/companion-voice';", resolveDir: root.pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, built.outputFiles[0].text); after(() => unlink(file));
const { parseCompanionSave: save, findCompanionMentions: mentions, parseCompanionRecall: recall, parseCompanionIdeaRequest: idea, parseCompanionRemember: remember } = await import(file.href);

const named = [
  ['His name is Coco', { kind: 'save', name: 'Coco' }],
  ['Her name is Luna. Remember her.', { kind: 'save', name: 'Luna' }],
  ['Its name is Bobo, save it!', { kind: 'save', name: 'Bobo' }],
  ['Their name is Robin and remember them.', { kind: 'save', name: 'Robin' }],
  ['Please name the bear Coco.', { kind: 'save', name: 'Coco', target: 'bear' }],
  ['Name the little brown bear Coco', { kind: 'save', name: 'Coco', target: 'little brown bear' }],
  ['Call her Ruby', { kind: 'save', name: 'Ruby' }],
  ['Call this one Bean', { kind: 'save', name: 'Bean' }],
  ['Name my puppy Sunny', { kind: 'save', name: 'Sunny', target: 'puppy' }],
  ['Remember this as Coco', { kind: 'save', name: 'Coco' }],
  ['Save the fox as Poppy', { kind: 'save', name: 'Poppy', target: 'fox' }],
  ["The rabbit's name is Dot", { kind: 'save', name: 'Dot', target: 'rabbit' }],
  ['This dragon is called Willow', { kind: 'save', name: 'Willow', target: 'dragon' }],
  ['Her name is Luna-Rose.', { kind: 'save', name: 'Luna-Rose' }],
  ["His name is O'Neil", { kind: 'save', name: "O'Neil" }],
  ['His name is Émile', { kind: 'save', name: 'Émile' }],
  ['Its name is Bobo2', { kind: 'save', name: 'Bobo2' }],
  ['Her name is Little Star', { kind: 'save', name: 'Little Star' }],
  ['Her name is "little star"', { kind: 'save', name: 'little star' }],
  ['Name the bear "Sir Fluffy"', { kind: 'save', name: 'Sir Fluffy', target: 'bear' }],
  ['它叫豆豆，把它记住。', { kind: 'save', name: '豆豆' }],
  ['把这只小熊叫作豆豆', { kind: 'save', name: '豆豆', target: '小熊' }],
  ['给它起名叫团团', { kind: 'save', name: '团团' }],
  ['请把这只小兔命名为月月。', { kind: 'save', name: '月月', target: '小兔' }],
  ['这只小熊的名字叫豆豆', { kind: 'save', name: '豆豆', target: '小熊' }],
  ['她的名字是小月亮。', { kind: 'save', name: '小月亮' }],
  ['把这个保存为毛毛', { kind: 'save', name: '毛毛' }],
  ['把小狐狸记作橘子', { kind: 'save', name: '橘子', target: '小狐狸' }],
  ['它叫Coco，保存它。', { kind: 'save', name: 'Coco' }],
  ['它叫“小可爱”', { kind: 'save', name: '小可爱' }],
  ['  HIS   NAME IS   COCO!  ', { kind: 'save', name: 'COCO' }],
  ['His name is ' + 'A'.repeat(24), { kind: 'save', name: 'A'.repeat(24) }],
];
for (const [text, expected] of named) test(`complete naming command: ${text}`, () => assert.deepEqual(save(text), expected));

const notNaming = [
  '', 'Remember her', 'Draw a bear named Coco', 'Draw a cat called Luna', 'Draw a dog whose name is Coco',
  'Her name is Coco and she lives on the moon', 'His name is Coco. Draw a moon.', 'His name is Coco and draw a puppy',
  'Her name is Coco. Remember her. Add a tree.', 'Name the bear Coco then paint him blue',
  'His name is not Coco but Leo', 'Her name is Luna, no Ruby', 'Name it Coco or Leo',
  'His name is Coco lives here', 'His name is Coco swims', 'My name is Anna',
  'The tree beside the bear is called Coco', 'Call her Coco and give her a hat',
  '它叫豆豆，然后画一朵花。', '它叫豆豆再画一个太阳', '它叫豆豆它喜欢画画', '它叫豆豆不对叫团团',
  '画一只叫豆豆的小熊', '它叫豆豆，把它记住，然后去月球', '让小熊在豆豆旁边',
  'His name is', 'Name the bear', 'Her name is 123', 'His name is him', '它叫它',
  'His name is <script>alert(1)</script>', 'His name is ' + 'a'.repeat(25),
  'His name is Coco\nDraw a bear', 'His name is Coco; add stars',
  'Name the bear Fuck', 'His name is Shit', 'Remember this as Porn',
];
for (const text of notNaming) test(`preserves ordinary, incomplete or unsafe sentence: ${text.slice(0, 75)}`, () => assert.equal(save(text), null));

const friends = Object.freeze([
  Object.freeze({ id: 'coco', name: 'Coco' }), Object.freeze({ id: 'luna', name: 'Luna' }),
  Object.freeze({ id: 'ann', name: 'Ann' }), Object.freeze({ id: 'dd', name: '豆豆' }),
  Object.freeze({ id: 'tr', name: '团团' }), Object.freeze({ id: 'star', name: 'little star' }),
  Object.freeze({ id: 'sun', name: '阳' }), Object.freeze({ id: 'rose', name: 'Luna-Rose' }),
]);
const pureRecalls = [
  ['Draw Coco', 'coco'], ['please bring Coco here.', 'coco'], ['Bring Coco back!', 'coco'],
  ['Bring back Coco', 'coco'], ['Show Coco on the page', 'coco'], ['Add Coco to this picture', 'coco'],
  ['Invite Coco please', 'coco'], ['Let Coco come here', 'coco'], ['Coco, come here please', 'coco'],
  ['draw COCO!', 'coco'], ['DRAW ANN', 'ann'], ['Draw little star', 'star'],
  ['画豆豆', 'dd'], ['画出豆豆吧。', 'dd'], ['请带上豆豆', 'dd'], ['让豆豆来', 'dd'],
  ['请豆豆过来', 'dd'], ['叫豆豆来这张纸上吧', 'dd'], ['让团团出现', 'tr'], ['召唤豆豆', 'dd'],
  ['画阳', 'sun'],
  ['让Coco来这里。', 'coco'], ['画Coco', 'coco'], ['请带上Ann', 'ann'],
];
for (const [text, id] of pureRecalls) test(`pure recall command: ${text}`, () => assert.deepEqual(recall(text, friends), { companionId: id, pure: true }));

const stories = [
  ['Coco is on the moon.', 'coco'], ['Draw Coco beside a castle.', 'coco'], ['Bring Coco and draw a star', 'coco'],
  ["Coco's scarf is blue", 'coco'], ['Draw Coco. Then a rabbit.', 'coco'], ['Coco!', 'coco'],
  ['豆豆今天到了月球', 'dd'], ['在豆豆旁边画一朵花', 'dd'], ['画豆豆和一只小熊', 'dd'],
  ['让豆豆来，然后画一只蝴蝶', 'dd'], ['让豆豆', 'dd'], ['豆豆穿上宇航服', 'dd'],
  ['Coco到了月球。', 'coco'], ['把Coco放在月球上。', 'coco'], ['Ann在花园里。', 'ann'],
];
for (const [text, id] of stories) test(`known name in story remains complete: ${text}`, () => {
  const original = text;
  assert.deepEqual(recall(text, friends), { companionId: id, pure: false });
  assert.equal(text, original);
});

test('English matching respects Unicode word boundaries instead of substring names', () => {
  for (const text of ['Draw a planet', 'Draw an announcement', 'Draw a coconut', 'Annabelle plays', 'éAnn grows', 'Coco2', 'Coco_name']) {
    assert.deepEqual(mentions(text, friends), [], text);
    assert.equal(recall(text, friends), null, text);
  }
});
test('Chinese single-character names do not turn ordinary nouns into references', () => {
  assert.equal(recall('画一个太阳', friends), null);
  assert.equal(recall('阳光下有一只猫', friends), null);
  assert.deepEqual(recall('画阳', friends), { companionId: 'sun', pure: true });
  assert.equal(recall('abc豆豆def', friends), null);
});
test('mixed Chinese speech permits English names without weakening Latin word boundaries', () => {
  assert.deepEqual(mentions('让Coco来这里，Ann在旁边。', friends).map(c => c.id), ['coco', 'ann']);
  for (const text of ['画Anna在月球', '让Coconuts来', 'Coco2到了月球', 'Coco_name在花园']) assert.deepEqual(mentions(text, friends), [], text);
  assert.equal(recall('不要画Coco', friends), null);
  assert.equal(recall('把Coco删除', friends), null);
});
test('returns mentions in speaking order, without mutating the supplied collection', () => {
  const original = JSON.stringify(friends);
  assert.deepEqual(mentions('Luna and Coco meet 豆豆, then Coco returns.', friends).map(c => c.id), ['luna', 'coco', 'dd']);
  assert.equal(JSON.stringify(friends), original);
});
test('multiple friends and duplicate names cannot trigger a local pure insertion', () => {
  assert.equal(recall('Draw Coco and Luna', friends), null);
  assert.equal(recall('画豆豆和团团', friends), null);
  assert.equal(recall('Draw Coco', [{ id: 'a', name: 'Coco' }, { id: 'b', name: 'COCO' }]), null);
  assert.deepEqual(mentions('Draw Coco', [{ id: 'a', name: 'Coco' }, { id: 'a', name: 'COCO' }]), [{ id: 'a', name: 'Coco' }]);
});
test('longer known names take precedence without hiding later separate mentions', () => {
  assert.deepEqual(recall('Draw Luna-Rose', friends), { companionId: 'rose', pure: true });
  assert.deepEqual(mentions('Luna-Rose meets Luna', friends).map(c => c.id), ['rose', 'luna']);
  assert.deepEqual(mentions('Luna meets Luna-Rose', friends).map(c => c.id), ['luna', 'rose']);
  assert.equal(recall('Luna-Rose meets Luna', friends), null);
  const related = [{ id: 'small', name: '小豆豆' }, { id: 'dd', name: '豆豆' }];
  assert.deepEqual(recall('画小豆豆', related), { companionId: 'small', pure: true });
  assert.deepEqual(mentions('小豆豆和豆豆一起玩', related).map(c => c.id), ['small', 'dd']);
});
test('matching is escaped, bounded, and ignores malformed or unsafe saved names', () => {
  const invalid = [{ id: 'empty', name: '' }, { id: 'regex', name: '.*' }, { id: 'unsafe', name: 'Shit' }, { id: '', name: 'Coco' }];
  assert.deepEqual(mentions('Coco Shit .*', invalid), []);
  assert.deepEqual(mentions('Coco '.repeat(3000), friends), []);
  assert.equal(save('Her name is ' + 'Coco '.repeat(1000)), null);
  assert.equal(recall('Draw fucking Coco', friends), null);
});
for (const name of ['little bear', 'my friend', 'Mr. Bear', 'O’Bear', 'there and back', 'one two three four', '123', '我的好朋友']) {
  test(`manually saved name uses library lexical rules: ${name}`, () => {
    const saved = [{ id: 'manual', name }];
    assert.deepEqual(recall(`Draw ${name}`, saved), { companionId: 'manual', pure: true });
    assert.deepEqual(mentions(`${name} is on the moon.`, saved), saved);
    assert.deepEqual(recall(`让${name}来这里。`, saved), { companionId: 'manual', pure: true });
    assert.equal(recall(`Don't draw ${name}`, saved), null);
    assert.equal(recall(`不要画${name}`, saved), null);
  });
}
test('manual name matching does not relax extraction of potentially unfinished speech', () => {
  assert.equal(save('Her name is little bear'), null);
  assert.equal(save('Her name is Coco and a flower'), null);
  assert.equal(save('Her name is one two three four'), null);
  assert.deepEqual(save('Her name is "little bear"'), { kind: 'save', name: 'little bear' });
});

const ideas = ['Give me a story idea', 'Please show me a story starter.', 'Suggest another story idea', 'Give me an idea for a story', 'Another idea', 'One more idea please!', '给我一个灵感', '请给我一个故事灵感吧', '来个故事点子', '再来一个灵感'];
for (const text of ideas) test(`local explicit inspiration request: ${text}`, () => assert.equal(idea(text), true));
const notIdeas = ['A bear has a story idea', 'Give me a story idea and draw it', 'Draw a light bulb for an idea', 'Coco says give me a story idea', '小熊有一个灵感', '给我一个灵感然后画出来', '来一只小猫', 'another star', 'I want one more idea in the picture'];
for (const text of notIdeas) test(`does not intercept storytelling as an idea request: ${text}`, () => assert.equal(idea(text), false));

for (const text of ['Remember him.', 'Please save her', 'Save it please!', 'Remember this one', 'Remember them', '把它记住', '请保存它吧', '把这个保存下来', '把她存起来']) {
  test(`standalone remember after ASR split: ${text}`, () => assert.equal(remember(text), true));
}
for (const text of ['Remember him and draw a moon', 'Save the day', 'Save Coco', 'I remember him', 'Remember this one. Add a cat.', '把它记住然后画画', '记住豆豆', '保存它的帽子', '他把它记住']) {
  test(`does not consume story as standalone remember: ${text}`, () => assert.equal(remember(text), false));
}
for (const text of ["Don't draw Coco", 'Do not draw Coco', 'Remove Coco', 'Delete Coco', "I don't want Coco", 'A world without Coco', 'Forget Coco', 'Never bring Coco', '不要画豆豆', '删除豆豆', '擦掉豆豆', '我不想要豆豆', '别画豆豆', '让豆豆消失']) {
  test(`negative reference never inserts a companion: ${text}`, () => assert.equal(recall(text, friends), null));
}
