import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/freehand-test.mjs', import.meta.url);
const validationTemporary = new URL('../.sites-runtime/freehand-validation.mjs', import.meta.url);
const poseTemporary = new URL('../.sites-runtime/freehand-pose.mjs', import.meta.url);
const viewportTemporary = new URL('../.sites-runtime/freehand-viewport.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
await writeFile(temporary, compile(await readFile(new URL('../lib/freehand.ts', import.meta.url), 'utf8')).replace("'./object-pose'", "'./freehand-pose.mjs'").replace("'./scene-validation'", "'./freehand-validation.mjs'").replace("'./paper-viewport'", "'./freehand-viewport.mjs'"));
await writeFile(validationTemporary, compile(await readFile(new URL('../lib/scene-validation.ts', import.meta.url), 'utf8')));
await writeFile(viewportTemporary, compile(await readFile(new URL('../lib/paper-viewport.ts', import.meta.url), 'utf8')));
await writeFile(poseTemporary, compile(await readFile(new URL('../lib/object-pose.ts', import.meta.url), 'utf8')));
const { appendHandStroke, eraseHandStroke, findHandStroke, handStrokePaths, simplifyHandPoints, pointSegmentDistance } = await import(temporary.href);
const { sceneSchema, isSafeDrawingPath } = await import(validationTemporary.href);
after(() => Promise.all([unlink(temporary), unlink(validationTemporary), unlink(viewportTemporary), unlink(poseTemporary)]));

const blank = () => ({ title: '我的画', sky: 'paper', weather: 'clear', ground: 'none', objects: [] });
const line = [{ x: 20, y: 30 }, { x: 80, y: 30 }];
const draw = (scene = blank(), points = line) => appendHandStroke(scene, points, '#234567', 5);
const mark = { type: 'path', d: 'M0 0L20 0', fill: 'none', stroke: '#234567', strokeWidth: 5 };
const handObject = (id, marks) => ({ id, kind: 'drawing', x: 0, y: 0, scale: 1, color: '#234567', label: '小朋友自己画的笔触', marks });

test('a manual stroke becomes a validated shared vector object without mutating its scene', () => {
  const before = blank();
  const result = draw(before);
  assert.equal(before.objects.length, 0);
  assert.equal(result.objects[0].id, 'hand-1');
  assert.equal(result.objects[0].kind, 'drawing');
  assert.match(result.objects[0].label, /自己画/);
  assert.equal(result.objects[0].marks[0].d, 'M20 30L80 30');
  assert.deepEqual(sceneSchema.parse(result), result);
});

test('several strokes share a stable hand layer while their colors remain per-stroke', () => {
  const first = draw();
  const second = appendHandStroke(first, [{ x: 30, y: 60 }, { x: 90, y: 70 }], '#ab1234', 12);
  assert.equal(second.objects.length, 1);
  assert.equal(second.objects[0].id, first.objects[0].id);
  assert.equal(first.objects[0].marks.length, 1);
  assert.equal(second.objects[0].marks.length, 2);
  assert.equal(second.objects[0].marks[1].stroke, '#ab1234');
  assert.equal(second.objects[0].marks[1].strokeWidth, 12);
});

test('each layer has at most100 marks and new hand layers stay above intervening AI objects', () => {
  const hundred = { ...blank(), objects: [handObject('hand-7', Array.from({ length: 100 }, () => ({ ...mark })))] };
  const overflow = draw(hundred);
  assert.deepEqual(overflow.objects.map(object => [object.id, object.marks.length]), [['hand-7', 100], ['hand-8', 1]]);
  const interleaved = { ...draw(), objects: [...draw().objects, { id: 'ai-tree', kind: 'tree', x: 200, y: 200, scale: 1, color: '#345678' }] };
  const last = draw(interleaved);
  assert.deepEqual(last.objects.map(object => object.id), ['hand-1', 'ai-tree', 'hand-2']);
});

test('simplification removes dense collinear samples but retains corners and endpoints', () => {
  const points = [...Array.from({ length: 200 }, (_, index) => ({ x: index, y: 30 })), { x: 199, y: 130 }, { x: 300, y: 130 }];
  assert.deepEqual(simplifyHandPoints(points), [{ x: 0, y: 30 }, { x: 199, y: 30 }, { x: 199, y: 130 }, { x: 300, y: 130 }]);
  assert.equal(pointSegmentDistance({ x: 100, y: 5 }, { x: 0, y: 0 }, { x: 30, y: 0 }), Math.hypot(70, 5));
});

test('very long scribbles split at path limits and retain all corners and final endpoint', () => {
  const points = Array.from({ length: 1800 }, (_, index) => ({ x: index % 900, y: index % 2 ? 600 : 20 }));
  const paths = handStrokePaths(points);
  assert.ok(paths.length > 1);
  assert.ok(paths.every(path => path.length <= 2500 && isSafeDrawingPath(path)));
  assert.equal(paths.reduce((sum, path) => sum + (path.match(/L/g) ?? []).length, 0), points.length - 1);
  for (let index = 1; index < paths.length; index++) {
    const previousEnd = /L([^L]+)$/.exec(paths[index - 1])[1];
    assert.ok(paths[index].startsWith(`M${previousEnd}L`));
  }
  assert.ok(paths.at(-1).endsWith('L899 600'));
});

test('single click creates a visible round-cap dot including at the canvas edge', () => {
  for (const point of [{ x: 100, y: 100 }, { x: 1000, y: 640 }, { x: 0, y: 0 }]) {
    const result = draw(blank(), [point, point]);
    const path = result.objects[0].marks[0].d;
    assert.match(path, /L/);
    assert.ok(isSafeDrawingPath(path));
    assert.deepEqual(sceneSchema.parse(result), result);
  }
});

test('off-paper points are bounded and invalid coordinates, paint, or widths cannot corrupt the scene', () => {
  assert.deepEqual(simplifyHandPoints([{ x: -80, y: -10 }, { x: 1200, y: 800 }]), [{ x: 0, y: 0 }, { x: 1000, y: 640 }]);
  assert.throws(() => draw(blank(), [{ x: NaN, y: 30 }]));
  assert.throws(() => draw(blank(), []));
  assert.throws(() => appendHandStroke(blank(), line, 'url(evil)', 5));
  assert.throws(() => appendHandStroke(blank(), line, '#123456', 25));
});

test('40-object and450-mark limits fail explicitly without silently deleting older art', () => {
  const forty = { ...blank(), objects: Array.from({ length: 40 }, (_, index) => ({ id: `ai-${index}`, kind: 'tree', x: 100, y: 100, scale: 1, color: '#123456' })) };
  assert.throws(() => draw(forty), /没有保存/);
  assert.equal(forty.objects.length, 40);
  const full = { ...blank(), objects: Array.from({ length: 5 }, (_, index) => handObject(`hand-${index + 1}`, Array.from({ length: 90 }, () => ({ ...mark })))) };
  assert.ok(sceneSchema.safeParse(full).success);
  assert.throws(() => draw(full), /没有保存/);
  assert.equal(full.objects.at(-1).marks.length, 90);
});

test('the60k total path budget rejects a whole new gesture, preserving existing objects', () => {
  const long = `M0 0${'L10 10'.repeat(400)}`;
  const scene = { ...blank(), objects: [handObject('hand-1', Array.from({ length: 24 }, () => ({ ...mark, d: long })))] };
  assert.ok(sceneSchema.safeParse(scene).success);
  const points = Array.from({ length: 1000 }, (_, index) => ({ x: index, y: index % 2 ? 600 : 20 }));
  assert.throws(() => draw(scene, points), /没有保存/);
  assert.equal(scene.objects[0].marks.length, 24);
});

test('eraser hits the visible transformed stroke rather than untransformed coordinates', () => {
  const scene = draw();
  scene.objects[0] = { ...scene.objects[0], x: 100, y: 200, scale: 2 };
  assert.equal(findHandStroke(scene, { x: 180, y: 260 })?.objectId, 'hand-1');
  assert.equal(findHandStroke(scene, { x: 40, y: 30 }), null);
  assert.equal(eraseHandStroke(scene, { x: 180, y: 260 }).objects.length, 0);
  assert.equal(scene.objects.length, 1);
});

test('eraser keeps unrelated manual strokes and AI marks, including explicit non-hand targets', () => {
  const first = draw();
  const two = draw(first, [{ x: 20, y: 200 }, { x: 80, y: 200 }]);
  const scene = { ...two, objects: [...two.objects, { ...handObject('ai-drawing', [{ ...mark }]), label: '模型画的' }] };
  const erased = eraseHandStroke(scene, { x: 40, y: 30 });
  assert.equal(erased.objects[0].marks.length, 1);
  assert.equal(erased.objects[1], scene.objects[1]);
  assert.equal(eraseHandStroke(scene, [{ objectId: 'ai-drawing', markIndex: 0 }]), scene);
  assert.equal(eraseHandStroke(scene, { x: 500, y: 500 }), scene);
});

test('overlapping hits prefer the topmost mark and a batch erasure resolves original indices once', () => {
  const first = draw();
  const second = draw(first);
  assert.equal(findHandStroke(second, { x: 40, y: 30 }).markIndex, 1);
  const erased = eraseHandStroke(second, [{ objectId: 'hand-1', markIndex: 0 }, { objectId: 'hand-1', markIndex: 1 }]);
  assert.equal(erased.objects.length, 0);
});


test('expanded sheets preserve drawing coordinates in the former side margins and persist the paper', () => {
  const paper = { x: -300, y: 0, width: 1600, height: 640 };
  const base = { ...blank(), paper };
  const next = draw(base, [{ x: -250, y: 100 }, { x: 1200, y: 150 }]);
  assert.equal(next.objects[0].marks[0].d, 'M-250 100L1200 150');
  assert.deepEqual(next.paper, paper);
  assert.deepEqual(sceneSchema.parse(next), next);
  assert.deepEqual(simplifyHandPoints([{ x: -400, y: -20 }, { x: 1400, y: 700 }], .6, paper), [{ x: -300, y: 0 }, { x: 1300, y: 640 }]);
});

test('tall sheets, fractional edges and isolated dots remain within their actual paper', () => {
  const paper = { x: 0, y: -300.45, width: 1000, height: 1240.9 };
  const points = [{ x: 10, y: -300.45 }, { x: 20, y: 940.45 }];
  assert.equal(draw({ ...blank(), paper }, points).objects[0].marks[0].d, 'M10 -300.4L20 940.45');
  const fractional = { x: -1.23, y: -1.23, width: 1001.66, height: 641.66 };
  const simplified = simplifyHandPoints([{ x: -100, y: -100 }, { x: 2000, y: 2000 }], .6, fractional);
  assert.deepEqual(simplified[0], { x: fractional.x, y: fractional.y });
  assert.deepEqual(simplified[1], { x: fractional.x + fractional.width, y: fractional.y + fractional.height });
  for (const point of simplified) assert.ok(isSafeDrawingPath(handStrokePaths([point], fractional)[0]));
});
