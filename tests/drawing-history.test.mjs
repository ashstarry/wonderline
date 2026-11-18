import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const names = ['drawing-history', 'scene-validation'];
const files = names.map(name => new URL(`../.sites-runtime/history-${name}.mjs`, import.meta.url));
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
for (const [index, name] of names.entries()) {
  const compiled = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll("'./scene-validation'", "'./history-scene-validation.mjs'");
  await writeFile(files[index], compiled);
}
after(() => Promise.all(files.map(file => unlink(file))));
const { readDrawingHistory, writeDrawingHistory } = await import(files[0].href);

const blank = () => ({ title: '我的画', sky: 'paper', ground: 'none', weather: 'clear', objects: [] });
const stroke = (id = 'erase-1', targetCount = 3) => ({ id, width: 28, paths: ['M10 20L30 40'], targets: Array.from({ length: targetCount }, (_, index) => ({ key: `mark:circle-${index}:abc:0`, x: 100, y: 150, scale: 1.5 })) });
const entry = (scene = blank(), paperId) => ({ scene, phrase: '我的一笔', message: '慢慢画。', ...(paperId === undefined ? {} : { paperId }) });
const value = (history = [entry()]) => ({ history, cursor: history.length - 1, style: 'pencil' });

test('legacy history remains readable, including old scenes without erasures or paper IDs', () => {
  const legacy = value([entry(), entry({ ...blank(), erasures: [stroke()] }, 'paper-two')]);
  assert.deepEqual(readDrawingHistory(JSON.stringify(legacy)), legacy);
  const migrated = JSON.parse(writeDrawingHistory(legacy));
  assert.equal(migrated.version, 2);
  assert.equal(migrated.history[0].scene.erasureIds, undefined);
  assert.deepEqual(migrated.history[1].scene.erasureIds, ['erase-1']);
  assert.deepEqual(readDrawingHistory(JSON.stringify(migrated)), legacy);
});

test('multiple erase steps roundtrip exactly with undo position, style and per-paper metadata', () => {
  const first = stroke(), second = stroke('erase-2');
  const original = { ...value([entry(), entry({ ...blank(), erasures: [first] }, 'one'), entry({ ...blank(), erasures: [first, second] }, 'one'), entry({ ...blank(), erasures: [] }, 'two')]), cursor: 1, style: 'watercolor' };
  const before = structuredClone(original);
  const raw = writeDrawingHistory(original);
  assert.deepEqual(original, before);
  assert.deepEqual(readDrawingHistory(raw), original);
  assert.deepEqual(Object.keys(JSON.parse(raw).erasures), ['erase-1', 'erase-2']);
  assert.ok(!Object.hasOwn(JSON.parse(raw).history[1].scene, 'erasures'));
});

test('undo and reload retain each paper medium, while legacy entries may omit it', () => {
  const original = { history: [entry(), { ...entry(blank(), 'crayon-paper'), style: 'crayon' }, { ...entry(blank(), 'watercolor-paper'), style: 'watercolor' }], cursor: 1, style: 'crayon' };
  assert.deepEqual(readDrawingHistory(writeDrawingHistory(original)), original);
  const invalid = { ...original, history: [{ ...original.history[1], style: 'oil' }] };
  assert.equal(readDrawingHistory(JSON.stringify(invalid)), null);
});

test('the same large erase snapshot across20 timeline steps is serialized only once', () => {
  const shared = stroke('shared-erase', 450);
  const original = value(Array.from({ length: 20 }, (_, index) => entry({ ...blank(), title: `画到第${index}步`, erasures: [shared] })));
  const raw = writeDrawingHistory(original), encoded = JSON.parse(raw);
  assert.equal(Object.keys(encoded.erasures).length, 1);
  assert.equal((raw.match(/"targets":/g) ?? []).length, 1);
  assert.ok(raw.length < JSON.stringify(original).length / 10);
  assert.deepEqual(readDrawingHistory(raw), original);
});

test('same gesture ID with pruned targets preserves each distinct historical revision', () => {
  const full = stroke();
  const pruned = { ...full, targets: full.targets.slice(1) };
  const original = value([entry({ ...blank(), erasures: [full] }), entry({ ...blank(), erasures: [pruned] }), entry({ ...blank(), erasures: [full] })]);
  const raw = writeDrawingHistory(original), encoded = JSON.parse(raw);
  assert.equal(Object.keys(encoded.erasures).length, 2);
  assert.notEqual(encoded.history[0].scene.erasureIds[0], encoded.history[1].scene.erasureIds[0]);
  assert.equal(encoded.history[0].scene.erasureIds[0], encoded.history[2].scene.erasureIds[0]);
  assert.equal(Object.values(encoded.erasures)[1].id, full.id);
  assert.deepEqual(readDrawingHistory(raw), original);
});

test('pool references cannot resolve through dictionary prototypes', () => {
  const unusual = value([entry({ ...blank(), erasures: [stroke('__proto__'), stroke('constructor')] })]);
  assert.deepEqual(readDrawingHistory(writeDrawingHistory(unusual)), unusual);
  const bad = JSON.parse(writeDrawingHistory(value()));
  bad.history[0].scene.erasureIds = ['toString'];
  assert.equal(readDrawingHistory(JSON.stringify(bad)), null);
  bad.history[0].scene.erasureIds = ['__proto__'];
  assert.equal(readDrawingHistory(JSON.stringify(bad)), null);
});

test('malformed JSON, schemas, pools and missing references are rejected safely', () => {
  for (const raw of [null, '', '{', 'null', '[]', '{}']) assert.equal(readDrawingHistory(raw), null);
  const valid = JSON.parse(writeDrawingHistory(value([entry({ ...blank(), erasures: [stroke()] })])));
  const cases = [
    { ...valid, version: 3 }, { ...valid, erasures: null }, { ...valid, erasures: [] },
    { ...valid, history: [] }, { ...valid, style: 'oil' }, { ...valid, cursor: null },
    { ...valid, history: [{ ...valid.history[0], phrase: 5 }] },
    { ...valid, history: [{ ...valid.history[0], scene: { ...valid.history[0].scene, sky: 'bad' } }] },
    { ...valid, history: [{ ...valid.history[0], scene: { ...valid.history[0].scene, erasureIds: ['missing'] } }] },
    { ...valid, history: [{ ...valid.history[0], scene: { ...valid.history[0].scene, erasureIds: ['erase-1', 'erase-1'] } }] },
    { ...valid, history: [{ ...valid.history[0], scene: { ...valid.history[0].scene, erasures: [] } }] },
    { ...valid, erasures: { 'erase-1': { ...stroke(), paths: ['M0 0L10 10<script>'] } } },
  ];
  for (const broken of cases) assert.equal(readDrawingHistory(JSON.stringify(broken)), null);
  const badLegacy = value([entry({ ...blank(), erasures: [{ ...stroke(), targets: [{ key: 'bad', x: Infinity, y: 0, scale: 1 }] }] })]);
  assert.equal(readDrawingHistory(JSON.stringify(badLegacy)), null);
  assert.throws(() => writeDrawingHistory(badLegacy), /无法保存/);
});

test('history is bounded to31 entries and finite cursors are clamped to valid integer steps', () => {
  const history = Array.from({ length: 31 }, () => entry());
  assert.equal(readDrawingHistory(writeDrawingHistory(value(history))).history.length, 31);
  assert.equal(readDrawingHistory(JSON.stringify(value([...history, entry()]))), null);
  assert.throws(() => writeDrawingHistory(value([...history, entry()])), /无法保存/);
  for (const [cursor, expected] of [[-5, 0], [100, 30], [4.8, 4]]) {
    assert.equal(readDrawingHistory(JSON.stringify({ ...value(history), cursor })).cursor, expected);
    assert.equal(readDrawingHistory(writeDrawingHistory({ ...value(history), cursor })).cursor, expected);
  }
  assert.throws(() => writeDrawingHistory({ ...value(history), cursor: Infinity }), /无法保存/);
  assert.throws(() => writeDrawingHistory({ ...value(history), cursor: NaN }), /无法保存/);
});
