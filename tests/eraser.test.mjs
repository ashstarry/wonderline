import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const files = ['eraser', 'freehand', 'scene-validation', 'paper-viewport', 'object-pose'];
const generated = files.map(name => new URL(`../.sites-runtime/partial-eraser-${name}.mjs`, import.meta.url));
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
for (const [index, name] of files.entries()) {
  let compiled = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const imported of files) compiled = compiled.replaceAll(`'./${imported}'`, `'./partial-eraser-${imported}.mjs'`);
  await writeFile(generated[index], compiled);
}
after(() => Promise.all(generated.map(path => unlink(path))));
const { appendErasure, objectMarkKeys, legacyErasureKey, backgroundErasureKey, collectErasureTargets, preserveErasures, sceneForModel, ERASURE_LIMITS } = await import(generated[0].href);
const { appendHandStroke } = await import(generated[1].href);
const { sceneSchema, isSafeErasurePath } = await import(generated[2].href);

const blank = () => ({ title: '我的画', sky: 'paper', weather: 'clear', ground: 'none', objects: [] });
const circle = { type: 'ellipse', x: 50, y: 50, w: 60, h: 60, fill: '#ffcc55', stroke: '#886644', strokeWidth: 3 };
const drawing = (id = 'ai-circle', marks = [circle]) => ({ id, kind: 'drawing', x: 100, y: 150, scale: 1.5, color: '#ffcc55', marks });
const scene = () => ({ ...blank(), sky: 'day', ground: 'meadow', objects: [drawing(), { id: 'tree', kind: 'tree', x: 500, y: 350, scale: 1, color: '#55aa33' }] });
const sweep = [{ x: 180, y: 210 }, { x: 210, y: 240 }];
const erase = (base = scene(), points = sweep, width = 28, id = 'erase-1') => appendErasure(base, points, width, id);

test('a bounded gesture persists only touched targets; empty paper adds no erase history', () => {
  const base=scene(),target=collectErasureTargets(base).find(target=>target.key===objectMarkKeys(base.objects[0])[0]);
  const next=appendErasure(base,sweep,38,'bounded',[target]);
  assert.deepEqual(next.erasures[0].targets,[target]);assert.equal(next.objects,base.objects);
  assert.equal(appendErasure(base,sweep,38,'empty',[]),base);
  assert.deepEqual(sceneSchema.parse(next),next);
});

test('partial erasure keeps AI, legacy and manual geometry intact and snapshots all existing layers', () => {
  const base = appendHandStroke(scene(), sweep, '#224488', 5);
  const before = structuredClone(base);
  const result = erase(base);
  assert.deepEqual(base, before);
  assert.equal(result.objects, base.objects);
  assert.equal(result.erasures.length, 1);
  assert.equal(result.erasures[0].paths[0], 'M180 210L210 240');
  assert.equal(result.erasures[0].width, 28);
  assert.equal(result.erasures[0].targets.length, 6);
  assert.ok(result.erasures[0].targets.some(target => target.key === objectMarkKeys(base.objects[0])[0]));
  assert.ok(result.erasures[0].targets.some(target => target.key === legacyErasureKey(base.objects[1])));
  assert.ok(result.erasures[0].targets.some(target => target.key === objectMarkKeys(base.objects[2])[0]));
  assert.deepEqual(sceneSchema.parse(result), result);
});

test('stable mark keys ignore property order, object movement and unrelated mark insertion', () => {
  const original = drawing();
  const reordered = { ...original, x: 600, y: 40, scale: .5, marks: [{ strokeWidth: 3, stroke: '#886644', fill: '#ffcc55', h: 60, w: 60, y: 50, x: 50, type: 'ellipse' }] };
  assert.deepEqual(objectMarkKeys(original), objectMarkKeys(reordered));
  const inserted = { ...original, marks: [{ ...circle, x: 2 }, circle] };
  assert.equal(objectMarkKeys(inserted)[1], objectMarkKeys(original)[0]);
  assert.notEqual(objectMarkKeys(inserted)[0], objectMarkKeys(original)[0]);
  assert.notEqual(objectMarkKeys(drawing('other-object'))[0], objectMarkKeys(original)[0]);
});

test('identical later strokes get a new occurrence and draw over an older erase', () => {
  const first = appendHandStroke(blank(), sweep, '#224488', 5);
  const erased = erase(first);
  const next = appendHandStroke(erased, sweep, '#224488', 5);
  const [oldKey, newKey] = objectMarkKeys(next.objects[0]);
  assert.notEqual(oldKey, newKey);
  const targets = next.erasures.flatMap(stroke => stroke.targets.map(target => target.key));
  assert.ok(targets.includes(oldKey));
  assert.ok(!targets.includes(newKey));
  assert.equal(next.objects[0].marks.length, 2);
  assert.equal(first.objects[0].marks.length, 1);
});

test('moving or scaling unchanged AI art retains its original erasure transform snapshot', () => {
  const base = erase();
  const next = { ...sceneForModel(base), objects: base.objects.map(object => ({ ...object, x: object.x + 100, scale: 2 })) };
  const result = preserveErasures(base, next);
  const key = objectMarkKeys(base.objects[0])[0];
  assert.deepEqual(result.erasures[0].targets.find(target => target.key === key), { key, x: 100, y: 150, scale: 1.5 });
  assert.equal(result.objects[0].x, 200);
  assert.equal(result.objects[0].scale, 2);
  assert.equal(next.erasures, undefined);
});

test('AI changes remove obsolete target masks while untouched marks retain their holes', () => {
  const twoMarks = { ...scene(), objects: [drawing('ai-circle', [circle, { ...circle, x: 200 }])] };
  const base = erase(twoMarks);
  const [unchanged, oldChanged] = objectMarkKeys(base.objects[0]);
  const next = { ...sceneForModel(base), objects: [drawing('ai-circle', [circle, { ...circle, x: 240 }]), drawing('new-object')] };
  const result = preserveErasures(base, next);
  const targets = new Set(result.erasures[0].targets.map(target => target.key));
  assert.ok(targets.has(unchanged));
  assert.ok(!targets.has(oldChanged));
  assert.ok(!targets.has(objectMarkKeys(next.objects[0])[1]));
  assert.ok(!targets.has(objectMarkKeys(next.objects[1])[0]));
});

test('inherited fill changes invalidate its mark key, explicit color remains independent', () => {
  const object = drawing('ai', [{ type: 'ellipse', x: 1, y: 1, w: 10, h: 10 }, circle]);
  const recolored = { ...object, color: '#aa3344' };
  assert.notEqual(objectMarkKeys(object)[0], objectMarkKeys(recolored)[0]);
  assert.equal(objectMarkKeys(object)[1], objectMarkKeys(recolored)[1]);
  assert.notEqual(legacyErasureKey(scene().objects[1]), legacyErasureKey({ ...scene().objects[1], color: '#bb4455' }));
});

test('replacing a background gets fresh paint, unaffected layer masks survive', () => {
  const base = erase();
  const next = { ...sceneForModel(base), ground: 'lake', weather: 'snow' };
  const result = preserveErasures(base, next);
  const targets = new Set(result.erasures[0].targets.map(target => target.key));
  assert.ok(targets.has(backgroundErasureKey(next, 'sky')));
  assert.ok(!targets.has(backgroundErasureKey(base, 'ground')));
  assert.ok(!targets.has(backgroundErasureKey(next, 'ground')));
  assert.ok(!targets.has(backgroundErasureKey(next, 'weather')));
  assert.equal(collectErasureTargets(next).filter(target => target.key.startsWith('background:')).length, 3);
});

test('metadata never enters model scene and stripping does not mutate the current drawing', () => {
  const base = erase();
  const modelScene = sceneForModel(base);
  assert.equal(Object.hasOwn(modelScene, 'erasures'), false);
  assert.equal(base.erasures.length, 1);
  assert.equal(modelScene.objects, base.objects);
  assert.deepEqual(modelScene, scene());
});

test('a single point erases only a round-cap dot, and longer sweeps remain contiguous across chunks', () => {
  const single = erase(scene(), [{ x: 1000, y: 640 }]);
  assert.equal(single.erasures[0].paths[0], 'M1000 640L999.9 640');
  const points = Array.from({ length: 1800 }, (_, index) => ({ x: index % 1000, y: index % 2 ? 600 : 20 }));
  const saved = structuredClone(points);
  const long = erase(scene(), points).erasures[0];
  assert.ok(long.paths.length > 1);
  assert.ok(long.paths.every(isSafeErasurePath));
  for (let index = 1; index < long.paths.length; index++) {
    assert.ok(long.paths[index].startsWith(`M${/L([^L]+)$/.exec(long.paths[index - 1])[1]}L`));
  }
  assert.deepEqual(points, saved);
});

test('strict validation rejects unsafe paths, invalid widths and extra metadata', () => {
  const valid = erase();
  for (const path of ['M0 0L10 10<script>', 'M0 0Q10 10 20 20', 'M0 0L10001 10', 'M0 0L1 -10001', 'M0 0LNaN 2', 'M0 0L1.2.3 2', 'M0 0L10 10Z', 'M0 0']) {
    assert.equal(isSafeErasurePath(path), false, path);
    assert.equal(sceneSchema.safeParse({ ...valid, erasures: [{ ...valid.erasures[0], paths: [path] }] }).success, false, path);
  }
  assert.equal(sceneSchema.safeParse({ ...valid, erasures: [{ ...valid.erasures[0], script: 'no' }] }).success, false);
  assert.equal(sceneSchema.safeParse({ ...valid, erasures: [{ ...valid.erasures[0], targets: [{ ...valid.erasures[0].targets[0], key: 'url(#bad)' }] }] }).success, false);
  for (const width of [0, 257, NaN, Infinity]) assert.throws(() => erase(scene(), sweep, width));
  assert.ok(sceneSchema.safeParse(erase(scene(), sweep, 256)).success);
  assert.throws(() => erase(scene(), []));
  assert.throws(() => erase(scene(), [{ x: NaN, y: 2 }]));
});

test('gesture/target/path budgets reject a whole change rather than drop earlier art', () => {
  const first = erase(blank());
  const stroke = first.erasures[0];
  const full = { ...blank(), erasures: Array.from({ length: ERASURE_LIMITS.gestures }, (_, index) => ({ ...stroke, id: `erase-${index}` })) };
  assert.ok(sceneSchema.safeParse(full).success);
  assert.throws(() => erase(full, sweep, 28, 'erase-last'), /没有保存/);
  assert.equal(full.erasures.length, ERASURE_LIMITS.gestures);
  assert.throws(() => erase(first, sweep, 28, 'erase-1'), /没有保存/);
  const longPath = `M0 0${'L10 10'.repeat(400)}`;
  assert.equal(sceneSchema.safeParse({ ...first, erasures: [{ ...stroke, paths: Array(50).fill(longPath) }] }).success, false);
  assert.equal(sceneSchema.safeParse({ ...first, erasures: [{ ...stroke, paths: Array(601).fill('M0 0L10 10') }] }).success, false);
  const manyTargets = Array.from({ length: 493 }, (_, index) => ({ key: `mark:${index}`, x: 0, y: 0, scale: 1 }));
  const targetsOverflow = { ...first, erasures: Array.from({ length: 82 }, (_, index) => ({ ...stroke, id: `erase-${index}`, targets: manyTargets })) };
  assert.equal(sceneSchema.safeParse(targetsOverflow).success, false);
  assert.equal(sceneSchema.safeParse({ ...first, erasures: [{ ...stroke, targets: [stroke.targets[0], stroke.targets[0]] }] }).success, false);
});


test('eraser sweeps cover extended paper without deleting or cropping existing geometry', () => {
  const paper = { x: -320, y: -100, width: 1640, height: 840 };
  const base = { ...scene(), paper };
  const result = erase(base, [{ x: -400, y: -200 }, { x: 1500, y: 900 }]);
  assert.equal(result.erasures[0].paths[0], 'M-320 -100L1320 740');
  assert.equal(result.objects, base.objects);
  assert.deepEqual(result.paper, paper);
  assert.ok(sceneSchema.safeParse(result).success);
  const invalid = { ...result, erasures: [{ ...result.erasures[0], paths: ['M-321 -100L1320 740'] }] };
  assert.ok(isSafeErasurePath(invalid.erasures[0].paths[0]), 'global path safety permits expanded coordinates');
  assert.equal(sceneSchema.safeParse(invalid).success, false, 'scene still enforces its own paper boundary');
  assert.equal(sceneSchema.safeParse({ ...result, paper: { x: 0, y: 0, width: 1000, height: 640 } }).success, false);
});

test('fractional paper edges never push rounded eraser points just outside the saved sheet', () => {
  const paper = { x: -123.456, y: -20.123, width: 1246.912, height: 680.246 };
  const result = erase({ ...blank(), paper }, [{ x: -999, y: -999 }, { x: 9999, y: 9999 }]);
  assert.ok(sceneSchema.safeParse(result).success);
  assert.ok(isSafeErasurePath(result.erasures[0].paths[0]));
});
