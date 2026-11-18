import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const file = new URL('../.sites-runtime/companion-turn-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const built = await build({ stdin: { contents: "export * from './lib/companion-turn'; export * from './lib/story-companions';", resolveDir: root.pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, built.outputFiles[0].text); after(() => unlink(file));
const { isCompanionTurn, shouldDeferCompanionLookahead, namedCompanionObject, prepareCompanionRecall, companionSubject, newlyDrawnSubjects, createCompanion, serializeCompanions, readCompanions, CompanionError } = await import(file.href);

const paper = Object.freeze({ x: 0, y: 0, width: 1000, height: 640 });
const empty = () => ({ title: 'Our story', sky: 'paper', weather: 'clear', ground: 'none', objects: [], paper: { ...paper } });
const object = (id = 'bear', label = 'Little brown bear', extra = {}) => ({ id, label, kind: 'drawing', x: 260, y: 230, scale: 1, color: '#bb7744', marks: [{ type: 'ellipse', x: 0, y: 0, w: 85, h: 100, fill: '#bb7744', stroke: '#664422', strokeWidth: 3 }, { type: 'rect', x: -40, y: 10, w: 80, h: 12, fill: '#5588cc' }], ...extra });
const scene = (...objects) => ({ ...empty(), objects });
const friend = (id = 'coco', name = 'Coco') => createCompanion(scene(object()), 'bear', name, 'crayon', { x: 210, y: 175, width: 100, height: 120 }, id, 1000);
const entries = () => [friend(), friend('dd', '豆豆')];
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; };

const ordinary = ['Draw a puppy beside a red ball.', 'There is a castle in the forest.', 'Draw a bear named Coco', 'The little bear wears a blue scarf.', 'Move the mountain left.', 'Erase the old castle.', '画一只戴蓝色围巾的小熊。', '山下有一个寺庙。', '小狐狸住在森林里。', 'Please draw a planet.', 'It is an announcement board.', 'It has coconut trees.', 'Give me a light bulb for an idea.'];
for (const text of ordinary) test(`ordinary sentence retains normal dispatch: ${text}`, () => {
  // A newly invented Coco is only an ordinary sentence before there is a saved Coco.
  const saved = text.includes('named Coco') ? [] : entries();
  const current = freeze(scene(object('castle', 'Castle'))), before = JSON.stringify(current);
  assert.equal(isCompanionTurn(text, saved), false);
  assert.equal(prepareCompanionRecall(text, current, saved, paper), null);
  assert.equal(JSON.stringify(current), before);
});

for (const text of ['His name is Coco.', '它叫豆豆，把它记住。', 'Remember him.', '把它记住。', 'Give me a story idea.', '再来一个灵感。', 'Draw Coco.', '豆豆今天到月球。']) {
  test(`explicit local or saved-name turn is dispatched: ${text}`, () => assert.equal(isCompanionTurn(text, entries()), true));
}

for (const text of ["Don't draw Coco", 'Remove Coco', 'Delete Coco', "I don't want Coco", 'The scene is without Coco.', '不要画豆豆', '删除豆豆', '让豆豆消失']) {
  test(`negative companion reference preserves the unmodified scene: ${text}`, () => {
    const current = freeze(scene(object('castle', 'Castle'))), before = JSON.stringify(current);
    assert.equal(prepareCompanionRecall(text, current, freeze(entries()), paper), null);
    assert.equal(JSON.stringify(current), before);
  });
}

test('ordinary requests do not treat fresh scene labels as a saved library', () => {
  const current = scene(object('coco', 'Coco'));
  assert.equal(isCompanionTurn('Draw Coco on the moon', []), false);
  assert.equal(prepareCompanionRecall('Draw Coco', current, [], paper), null);
});
test('stable recalled identity wins even if the original drawing label changed', () => {
  const saved = friend(), existing = object('companion-coco', 'Bear in a spacesuit');
  assert.equal(namedCompanionObject(scene(existing), saved), existing);
});
test('named original object is recognised across collection and scene reload', () => {
  const saved = friend(), current = scene(object('original-llm-id', 'Coco · Little brown bear'));
  const reloaded = readCompanions(serializeCompanions([saved]))[0], reloadedScene = JSON.parse(JSON.stringify(current));
  const actual = namedCompanionObject(reloadedScene, reloaded);
  assert.equal(actual.id, 'original-llm-id');
  const prepared = prepareCompanionRecall('Draw Coco', reloadedScene, [reloaded], paper);
  assert.equal(prepared.added, false); assert.equal(prepared.scene, reloadedScene); assert.equal(prepared.objectId, actual.id);
});
test('name label recognition is casefolded and Unicode-normalized', () => {
  const saved = friend(), original = object('old', 'ＣＯＣＯ · Bear');
  assert.equal(namedCompanionObject(scene(original), saved), original);
  const chinese = friend('dd', '豆豆'), doudou = object('old-dd', '豆豆 · 小熊');
  assert.equal(namedCompanionObject(scene(doudou), chinese), doudou);
});
test('label prefix cannot confuse Coco with Coconut or Coco Junior', () => {
  const saved = friend();
  for (const label of ['Coconut', 'Coco Junior', 'Not Coco', 'Coco bear']) assert.equal(namedCompanionObject(scene(object('old', label)), saved), undefined);
});
test('ambiguous labels never arbitrarily choose one current object', () => {
  const saved = friend(), current = scene(object('one', 'Coco'), object('two', 'Coco · Bear'));
  assert.equal(namedCompanionObject(current, saved), undefined);
});
test('ambiguous existing labels ask for resolution instead of inserting a third companion', () => {
  const saved = freeze(friend()), current = freeze(scene(object('one', 'Coco'), object('two', 'Coco · Bear'))), before = JSON.stringify(current);
  assert.throws(() => prepareCompanionRecall('Bring Coco', current, [saved], paper), error => error instanceof CompanionError && error.reason === 'duplicate-name');
  assert.equal(JSON.stringify(current), before);
});

test('ordinary utterances retain speculative generation without a companion wait', () => {
  for (const text of ordinary.filter(text => !text.includes('named Coco'))) assert.equal(shouldDeferCompanionLookahead(text, entries(), empty()), false, text);
});
test('explicit local actions defer model lookahead to the local handler', () => {
  for (const text of ['His name is Coco', 'Remember him', 'Give me a story idea', '它叫豆豆', '再来一个灵感']) {
    assert.equal(shouldDeferCompanionLookahead(text, entries(), empty()), true, text);
  }
});
test('absent saved companion is inserted before the existing model gets scene context', () => {
  const saved = friend(), text = 'Draw a flower beside Coco';
  assert.equal(shouldDeferCompanionLookahead(text, [saved], empty()), true);
  const prepared = prepareCompanionRecall(text, empty(), [saved], paper);
  assert.equal(shouldDeferCompanionLookahead(text, [saved], prepared.scene), false);
});
test('an already committed companion can use normal lookahead while strokes still play', () => {
  const saved = friend(), current = scene(object('original', 'Coco · Brown bear'));
  assert.equal(shouldDeferCompanionLookahead('Coco is on the moon', [saved], current), false);
  assert.equal(shouldDeferCompanionLookahead('Put a flower beside Coco', [saved], current), false);
  // Pure recall remains a local acknowledgement, never a request to redraw Coco.
  assert.equal(shouldDeferCompanionLookahead('Bring Coco', [saved], current), true);
});
test('negative references and multiple names do not block normal lookahead', () => {
  for (const text of ["Don't draw Coco", 'Delete Coco', '不要画豆豆', 'Coco meets 豆豆']) {
    assert.equal(shouldDeferCompanionLookahead(text, entries(), empty()), false, text);
  }
});

test('explicit target beats selection or recency and resolves one label only', () => {
  const bear = object('bear', 'Little brown bear'), rabbit = object('rabbit', 'White rabbit'), current = scene(bear, rabbit);
  assert.equal(companionSubject(current, rabbit.id, [rabbit.id], 'bear'), bear);
  assert.equal(companionSubject(current, bear.id, [bear.id], 'rabbit'), rabbit);
  assert.equal(companionSubject(current, bear.id, [bear.id], 'dragon'), undefined);
});
test('explicit target matching has word boundaries for English names', () => {
  const ann = object('ann', 'Ann'), anna = object('anna', 'Anna'), current = scene(ann, anna);
  assert.equal(companionSubject(current, null, [], 'Ann'), ann);
  assert.equal(companionSubject(scene(anna), null, [], 'Ann'), undefined);
});
test('Chinese explicit target works with labels and remains ambiguous with two matches', () => {
  const bear = object('bear', '棕色小熊'), rabbit = object('rabbit', '白兔');
  assert.equal(companionSubject(scene(bear, rabbit), null, [], '小熊'), bear);
  assert.equal(companionSubject(scene(bear, object('other', '蓝色小熊')), null, [], '小熊'), undefined);
});
test('two bears with the same descriptive target require a choice', () => {
  const current = scene(object('left', 'Brown bear'), object('right', 'White bear'));
  assert.equal(companionSubject(current, 'left', ['left'], 'bear'), undefined);
});
test('an explicit selected object can be named with a pronoun', () => {
  const bear = object(), rabbit = object('rabbit', 'Rabbit');
  assert.equal(companionSubject(scene(bear, rabbit), rabbit.id, [bear.id]), rabbit);
});
test('a recent subject is available before visual animation has completed', () => {
  const before = scene(object('castle', 'Castle'));
  const bear = object(), after = { ...before, objects: [...before.objects, bear] };
  const recent = newlyDrawnSubjects(before, after);
  assert.deepEqual(recent, ['bear']);
  assert.equal(companionSubject(after, null, recent), bear);
});
test('a recent foreground character is chosen even with newly added legacy backgrounds', () => {
  const before = empty(), bear = object();
  const mountain = object('mountain', 'Mountain', { kind: 'mountain', marks: undefined });
  const cloud = object('cloud', 'Cloud', { kind: 'cloud', marks: undefined });
  const after = scene(mountain, bear, cloud);
  assert.deepEqual(newlyDrawnSubjects(before, after), ['bear']);
  assert.equal(companionSubject(after, null, newlyDrawnSubjects(before, after)), bear);
});
test('multiple new custom drawings remain ambiguous instead of guessing a background', () => {
  const after = scene(object('mountains', 'Mountains'), object('bear', 'Bear'), object('trees', 'Trees'));
  assert.equal(companionSubject(after, null, newlyDrawnSubjects(empty(), after)), undefined);
});
test('two new foreground characters do not silently pick the first one', () => {
  const after = scene(object('bear', 'Bear'), object('rabbit', 'Rabbit'));
  assert.equal(companionSubject(after, null, newlyDrawnSubjects(empty(), after)), undefined);
});
test('manual strokes are never treated as companions or recent subjects', () => {
  const hand = object('hand-1', 'Child doodle'), bear = object();
  assert.equal(companionSubject(scene(hand), 'hand-1', ['hand-1']), undefined);
  assert.deepEqual(newlyDrawnSubjects(empty(), scene(hand)), []);
  assert.equal(companionSubject(scene(hand, bear), 'hand-1', ['hand-1']), bear);
  assert.equal(companionSubject(scene(hand), null, [], 'Child doodle'), undefined);
});
test('fallback chooses one foreground subject but never arbitrarily chooses among many', () => {
  const mountain = object('mountain', 'Mountain', { kind: 'mountain', marks: undefined }), bear = object(), rabbit = object('rabbit', 'Rabbit');
  assert.equal(companionSubject(scene(mountain, bear), 'deleted-selection', ['deleted-subject']), bear);
  assert.equal(companionSubject(scene(bear, rabbit), null, []), undefined);
  assert.equal(companionSubject(empty(), null, []), undefined);
});
test('same-ID pose or color changes do not invent a newly drawn subject', () => {
  const before = scene(object()), after = scene(object('bear', 'Bear', { x: 700, color: '#ff0000' }));
  assert.deepEqual(newlyDrawnSubjects(before, after), []);
});

test('saved recall supplies real companion geometry before an unchanged normal model request', () => {
  const saved = freeze(friend()), originalText = 'Draw a flower beside Coco on the moon.', current = freeze(scene(object('moon', 'Moon', { kind: 'moon', marks: undefined })));
  const before = JSON.stringify(current), prepared = prepareCompanionRecall(originalText, current, [saved], paper);
  assert.equal(prepared.added, true); assert.equal(prepared.pure, false);
  assert.equal(prepared.entry, saved);
  const request = { text: originalText, scene: prepared.scene };
  const recalled = request.scene.objects.find(item => item.id === prepared.objectId);
  assert.ok(recalled); assert.ok(recalled.label.startsWith('Coco · '));
  assert.deepEqual(recalled.marks, saved.object.marks);
  assert.equal(request.text, originalText);
  assert.deepEqual(request.scene.objects[0], current.objects[0]);
  assert.equal(JSON.stringify(current), before);
});
test('pure recall is local and needs no API request', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('No network may be requested by local recall'); };
  try {
    const prepared = prepareCompanionRecall('Bring Coco', empty(), [friend()], paper);
    assert.equal(prepared.pure, true); assert.equal(prepared.added, true);
  } finally { globalThis.fetch = originalFetch; }
});
test('an existing moved companion is used at its current location', () => {
  const saved = friend(), recalled = prepareCompanionRecall('Bring Coco', empty(), [saved], paper);
  const moved = { ...recalled.scene, objects: recalled.scene.objects.map(item => ({ ...item, x: 720, y: 360, scale: .7, rotation: 35 })) };
  const prepared = prepareCompanionRecall('A flower beside Coco', moved, [saved], paper);
  assert.equal(prepared.scene, moved); assert.equal(prepared.added, false); assert.equal(prepared.pure, false);
  assert.equal(prepared.scene.objects[0].x, 720); assert.equal(prepared.scene.objects[0].rotation, 35);
});
test('repeating a recalled name never duplicates its object', () => {
  const saved = friend(), first = prepareCompanionRecall('Draw Coco', empty(), [saved], paper);
  const second = prepareCompanionRecall('Draw Coco', first.scene, [saved], paper);
  assert.equal(second.scene, first.scene); assert.equal(second.added, false); assert.equal(second.objectId, first.objectId);
  assert.equal(second.scene.objects.length, 1);
});
test('two named companions in one clause defer without adding either one', () => {
  const current = freeze(empty()), before = JSON.stringify(current);
  assert.equal(prepareCompanionRecall('Coco and 豆豆 visit the moon', current, entries(), paper), null);
  assert.equal(JSON.stringify(current), before);
});
test('capacity failure retains every byte of the original artwork and library', () => {
  const current = freeze(scene(...Array.from({ length: 40 }, (_, n) => object(`drawing-${n}`, `Object ${n}`)))), saved = freeze(friend());
  const before = JSON.stringify(current), savedBefore = JSON.stringify(saved);
  assert.throws(() => prepareCompanionRecall('Draw Coco', current, [saved], paper), error => error instanceof CompanionError && error.reason === 'full');
  assert.equal(JSON.stringify(current), before); assert.equal(JSON.stringify(saved), savedBefore);
});
test('invalid viewport and impossible paper fit fail without replacing the scene', () => {
  for (const viewport of [{ ...paper, width: NaN }, { x: 0, y: 0, width: 5, height: 5 }]) {
    const current = freeze({ ...empty(), paper: viewport }), saved = freeze(friend()), before = JSON.stringify(current);
    assert.throws(() => prepareCompanionRecall('Draw Coco', current, [saved], viewport), error => error instanceof CompanionError);
    assert.equal(JSON.stringify(current), before);
  }
});
test('unknown companion and empty library never manufacture a fallback character', () => {
  const current = freeze(empty());
  assert.equal(prepareCompanionRecall('Draw Luna', current, entries(), paper), null);
  assert.equal(prepareCompanionRecall('Draw Coco', current, [], paper), null);
});
