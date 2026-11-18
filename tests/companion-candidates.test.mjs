import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const output = new URL('../.sites-runtime/companion-candidates-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../lib/companion-candidates.ts', import.meta.url), 'utf8');
await writeFile(output, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
after(() => unlink(output));
const { isCompanionCandidate } = await import(output.href);
const sceneSource = await readFile(new URL('../lib/scene.ts', import.meta.url), 'utf8');
const sceneJs = ts.transpileModule(sceneSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { INITIAL_SCENE } = await import(`data:text/javascript;base64,${Buffer.from(sceneJs).toString('base64')}`);
const object = (label, extra = {}) => ({ id: 'test-object', kind: 'drawing', label, x: 400, y: 300, scale: 1, color: '#aaccaa', marks: [{ type: 'ellipse', x: 0, y: 0, w: 30, h: 30 }], ...extra });

test('built-in characters are available without needing a label', () => {
  for (const kind of ['person', 'cat']) assert.equal(isCompanionCandidate(object(undefined, { kind, marks: undefined })), true, kind);
});

test('decorative legacy birds need a description while drawn bird characters stay eligible', () => {
  for (const label of [undefined, '', '  ']) assert.equal(isCompanionCandidate(object(label, { kind: 'bird', marks: undefined })), false);
  for (const label of ['blue bird', 'a curious sparrow', '小鸟', '蓝色的小鸟', 'Coco · blue bird']) assert.equal(isCompanionCandidate(object(label, { kind: 'bird', marks: undefined })), true, label);
  for (const label of [undefined, '', 'blue bird', 'a fantasy phoenix']) assert.equal(isCompanionCandidate(object(label)), true, label);
});

test('the default scene offers independent objects without offering environmental layers', () => {
  assert.deepEqual(INITIAL_SCENE.objects.filter(isCompanionCandidate).map(({ id }) => id), INITIAL_SCENE.objects.filter(({ kind }) => kind !== 'bird').map(({ id }) => id));
  assert.equal(typeof INITIAL_SCENE.sky, 'string');
  assert.equal(typeof INITIAL_SCENE.ground, 'string');
});

test('independent props can be companions in both built-in and free-drawn form', () => {
  for (const kind of ['house', 'tree', 'pine', 'mountain', 'cloud', 'sun', 'moon', 'star', 'flower', 'boat', 'bench', 'lamp', 'bush', 'mushroom']) {
    assert.equal(isCompanionCandidate(object(undefined, { kind, marks: undefined })), true, kind);
    assert.equal(isCompanionCandidate(object(kind, { kind, marks: undefined })), true, kind);
    assert.equal(isCompanionCandidate(object(kind)), true, kind);
  }
  for (const label of ['the crescent moon', 'a little wooden house', 'castle behind a princess', 'fluffy white clouds', 'a yellow flower', 'mountain outline', 'rock', 'large boulders', '月亮', '柔软的白云', '山下的小屋', '一朵黄色的小花', '石头']) assert.equal(isCompanionCandidate(object(label)), true, label);
});

test('continuous environmental regions are excluded by subject, including ordinary modifiers', () => {
  for (const label of ['background', 'blue sky', 'a night sky full of stars', 'a mountain range', 'green grass', 'wide ocean', 'a quiet forest with a bear', 'forest with a smiling bear', 'night landscape', 'river', '明亮的天空', '一片群山', '蓝色的大海', '森林背景', '夜晚的森林', '小熊身后的树林']) {
    assert.equal(isCompanionCandidate(object(label)), false, label);
  }
});

test('soil and mud regions are not mistaken for companions, but imagined mud creatures are', () => {
  for (const label of ['soil', 'brown soil', 'mud', 'wet mud', 'dirt', 'earth ground', 'a patch of soil', 'mud area', 'soil texture layer', '泥土', '土壤', '泥巴', '泥地', '一片泥土', '棕色泥土色块', '土地', '地面区域']) assert.equal(isCompanionCandidate(object(label)), false, label);
  for (const label of ['mud monster', 'talking mud', 'dirt creature', 'soil sprite', 'a mud puddle with a face', 'Earth', 'planet Earth', '土精灵', '泥土怪兽', '会说话的泥土', '泥巴小人', '泥土上的小熊', 'bear beside soil']) assert.equal(isCompanionCandidate(object(label)), true, label);
});

test('rendering suffixes do not make painted background regions into characters', () => {
  for (const label of ['blue sky wash', 'lake water surface', 'background gradient', 'sky wash layer', 'grass-fill', 'ocean wash band', 'ocean waves band', 'forest texture', '草地色块', '天空底色', '群山轮廓', '森林图层', '草地区域', '天空背景色块图层', '背景渐变']) {
    assert.equal(isCompanionCandidate(object(label)), false, label);
  }
  for (const label of ['bear outline', 'blue robot fill layer', 'an imaginary flump texture', '森林里的小熊轮廓', 'a bear beside a forest', '小熊色块', '会说话的石头轮廓', 'talking rock outline']) {
    assert.equal(isCompanionCandidate(object(label)), true, label);
  }
});

test('ordinary terrain and explicit background labels stay out of the picker', () => {
  for (const label of ['shore', 'sandy beach', 'desert terrain', 'horizon', 'winding road', 'forest path', 'lake shore', '湖岸', '沙滩', '山间小路', '海岸', '地平线', 'background forest clearing', 'backdrop castle rooftops', 'scenery distant fields', 'cloud background', 'cloud backdrop', '背景：绿色树林', '云朵背景']) {
    assert.equal(isCompanionCandidate(object(label)), false, label);
  }
  for (const label of ['a talking rock', 'a smiling mountain', 'background talking tree', '会说话的岩石', '沙滩上的小熊', 'unknown beach creature', 'Captain Rock', '小熊在湖岸']) {
    assert.equal(isCompanionCandidate(object(label)), true, label);
  }
});

test('incidental scenery never excludes characters or unknown fantasy drawings', () => {
  for (const label of ['bear beside a forest', 'a bear in a forest', 'a princess in front of a castle', 'blue robot near a house', 'teddy with a flower', 'mountain dragon', 'forest sprite', 'cloud creature', 'Princess Meadow', 'a moon rabbit', '森林里的小熊', '山上的小恐龙', '拿着花的小公主', '小熊在森林里', '小熊，旁边有森林', '草地上的机器人', '云朵精灵', '长着翅膀的神秘伙伴', 'an imaginary flump']) {
    assert.equal(isCompanionCandidate(object(label)), true, label);
  }
});

test('explicitly personified scenery can be a companion', () => {
  for (const [label, kind] of [['smiling sun', 'sun'], ['talking tree', 'tree'], ['friendly cloud', 'cloud'], ['a dancing mushroom', 'mushroom'], ['a sun with a smiling face', 'drawing'], ['a mountain has a face', 'drawing'], ['会说话的小树', 'tree'], ['微笑的太阳', 'sun'], ['有一张笑脸的云朵', 'drawing'], ['拟人的小花', 'flower']]) {
    assert.equal(isCompanionCandidate(object(label, { kind })), true, label);
  }
});

test('saved names use the underlying descriptor while intentional standalone names stay open-ended', () => {
  for (const label of ['Ocean · blue bear', '森林 · 小熊', 'River · robot beside a lake', 'Meadow · forest sprite']) assert.equal(isCompanionCandidate(object(label)), true, label);
  for (const label of ['Coco · blue lake', '豆豆 · 一片森林', 'Smiling · brown soil']) assert.equal(isCompanionCandidate(object(label)), false, label);
  for (const label of ['Luna · a moon', '“Mud”', '"Forest"', "'Soil'", '「泥土」', '『森林』', 'bear called Mud']) assert.equal(isCompanionCandidate(object(label)), true, label);
});

test('parenthetical context and character names do not become scenery subjects', () => {
  for (const label of ['a bear (forest background)', 'blue robot named River', 'bear among trees']) assert.equal(isCompanionCandidate(object(label)), true, label);
  for (const label of ['a mountain-range', 'mountains (background)', '天空背景（上部）', 'forest around a princess']) assert.equal(isCompanionCandidate(object(label)), false, label);
});

test('unknown, unnamed drawings remain open-ended; empty drawings and manual strokes do not', () => {
  for (const label of [undefined, '', 'a doodle', 'nonsense fantasy friend']) assert.equal(isCompanionCandidate(object(label)), true);
  for (const marks of [undefined, null, []]) assert.equal(isCompanionCandidate(object('little bear', { marks })), false);
  assert.equal(isCompanionCandidate(object('a friendly bear', { id: 'hand-123' })), false);
  assert.equal(isCompanionCandidate(null), false);
});

test('the candidate check is read-only and keeps scene geometry and marks intact', () => {
  const sample = object('bear beside a forest');
  const before = structuredClone(sample);
  for (let i = 0; i < 50; i++) isCompanionCandidate(sample);
  assert.deepEqual(sample, before);
});
