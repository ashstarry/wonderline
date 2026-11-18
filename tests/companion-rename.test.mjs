import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url), file = new URL('../.sites-runtime/companion-rename-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const built = await build({ stdin: { contents: "export * from './lib/story-companions'; export * from './lib/companion-turn'; export * from './lib/companion-voice';", resolveDir: root.pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, built.outputFiles[0].text); after(() => unlink(file));
const api = await import(file.href);
const paper = { x: 0, y: 0, width: 1000, height: 640 };
const object = (id = 'bear', label = 'Little bear') => ({ id, label, kind: 'drawing', x: 300, y: 280, scale: 1, color: '#aa7744', marks: [{ type: 'ellipse', x: 0, y: 0, w: 100, h: 120, fill: '#aa7744', stroke: '#554433', strokeWidth: 3 }] });
const scene = (...objects) => ({ title: 'A story', sky: 'paper', weather: 'clear', ground: 'none', paper, objects });
const friend = (id = 'friend-1', name = 'Coco') => api.createCompanion(scene(object()), 'bear', name, 'crayon', { x: 250, y: 220, width: 100, height: 120 }, id, 1000);
const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
const reason = (fn, value) => assert.throws(fn, error => error instanceof api.CompanionError && error.reason === value);

test('renaming preserves identity, saved art, pose, erasures, style and creation time without mutating the old entry', () => {
  const before = freeze(friend()), raw = JSON.stringify(before);
  const [after] = api.renameCompanion([before], before.id, '  Luna  ');
  assert.equal(after.name, 'Luna'); assert.equal(after.id, before.id);
  for (const key of ['object', 'erasures', 'bounds', 'style', 'createdAt']) assert.deepEqual(after[key], before[key]);
  assert.equal(JSON.stringify(before), raw);
  assert.equal(api.companionObjectId(after), api.companionObjectId(before));
});

test('unchanged normalized names are a no-op and case-only changes are allowed', () => {
  const entries = [friend()]; assert.equal(api.renameCompanion(entries, entries[0].id, ' Coco '), entries);
  assert.equal(api.renameCompanion(entries, entries[0].id, 'COCO')[0].name, 'COCO');
});

test('duplicate, empty, unsafe, overlong and removed names leave the existing library untouched', () => {
  const entries = freeze([friend(), friend('friend-2', 'Luna')]), raw = JSON.stringify(entries);
  for (const name of ['Luna', 'luna', ' Ｌｕｎａ ']) reason(() => api.renameCompanion(entries, entries[0].id, name), 'duplicate-name');
  for (const name of ['', '   ', '<script>', 'x'.repeat(25)]) reason(() => api.renameCompanion(entries, entries[0].id, name), 'invalid');
  reason(() => api.renameCompanion(entries, entries[0].id, 'fuck'), 'blocked');
  reason(() => api.renameCompanion(entries, 'removed', 'Luna'), 'changed');
  assert.equal(JSON.stringify(entries), raw);
});

for (const [oldName, newName, phrase] of [['Coco', 'Luna', 'Bring Luna here.'], ['豆豆', '团团', '让团团来这里。'], ['Coco', 'Luna-Rose', 'Draw Luna-Rose.']]) {
  test(`new name recalls the same saved friend after a storage round-trip: ${newName}`, () => {
    const old = friend('friend-1', oldName), entries = api.readCompanions(api.serializeCompanions(api.renameCompanion([old], old.id, newName)));
    assert.deepEqual(api.parseCompanionRecall(phrase, entries), { companionId: old.id, pure: true });
    assert.deepEqual(api.findCompanionMentions(`Bring ${oldName} here.`, entries), []);
    const recalled = api.prepareCompanionRecall(phrase, scene(), entries, paper);
    assert.equal(recalled.added, true); assert.equal(recalled.objectId, api.companionObjectId(old));
    assert.deepEqual(recalled.scene.objects[0].marks, old.object.marks);
  });
}

test('original canvas object gets only new name metadata; next English request does not insert a duplicate', () => {
  const previous = friend(), next = api.renameCompanion([previous], previous.id, 'Luna')[0];
  const current = freeze(scene(object('original', 'Coco · Little bear'), object('tree', 'Tree'))), raw = JSON.stringify(current);
  const updated = api.renameCompanionInScene(current, previous, next);
  assert.equal(updated.objects[0].label, 'Luna · Little bear');
  assert.equal(updated.objects[0].id, 'original'); assert.equal(updated.objects[0].marks, current.objects[0].marks);
  assert.equal(updated.objects[1], current.objects[1]); assert.equal(updated.paper, current.paper);
  const recalled = api.prepareCompanionRecall('Luna stands beside a flower.', updated, [next], paper);
  assert.equal(recalled.added, false); assert.equal(recalled.scene, updated);
  assert.equal(api.shouldDeferCompanionLookahead('Draw a flower beside Luna.', [next], updated), false);
  assert.equal(JSON.stringify(current), raw);
});

test('stable recalled ID survives changed labels and repeated renames never stack old names', () => {
  let entry = friend(), current = api.placeCompanion(scene(), entry, paper).scene;
  for (const name of ['Luna', 'Pip', 'Coco']) {
    const next = api.renameCompanion([entry], entry.id, name)[0];
    current = api.renameCompanionInScene(current, entry, next);
    assert.equal(current.objects[0].label, `${name} · Little bear`);
    assert.equal(current.objects.length, 1); entry = next;
  }
  current = { ...current, objects: [{ ...current.objects[0], label: 'Bear in a spacesuit' }] };
  const next = api.renameCompanion([entry], entry.id, 'Luna')[0];
  assert.equal(api.renameCompanionInScene(current, entry, next).objects[0].label, 'Luna · Bear in a spacesuit');
});

test('a renamed saved artwork label keeps its descriptor when inserted on another page', () => {
  const entry = { ...friend(), object: object('bear', 'Coco · Little bear') };
  const [renamed] = api.renameCompanion([entry], entry.id, 'Luna');
  assert.equal(renamed.object.label, 'Luna · Little bear');
  assert.equal(api.placeCompanion(scene(), renamed, paper).scene.objects[0].label, 'Luna · Little bear');
});

test('history metadata can be renamed without adding a turn, disturbing geometry or renaming an unrelated object', () => {
  const previous = friend(), next = api.renameCompanion([previous], previous.id, 'Luna')[0];
  const history = [scene(object('original', 'Coco · Little bear')), scene(object('original', 'Coco · Little bear'), object('ball', 'Red ball')), scene(object('other', 'Coconut tree'))];
  const updated = history.map(value => api.renameCompanionInScene(value, previous, next));
  assert.equal(updated.length, history.length); assert.equal(updated[2], history[2]);
  for (let i = 0; i < 2; i++) {
    assert.equal(updated[i].objects[0].label, 'Luna · Little bear');
    assert.deepEqual({ ...updated[i].objects[0], label: history[i].objects[0].label }, history[i].objects[0]);
  }
});

test('storage denial and stale-tab writes keep the persisted old library', () => {
  const entry = friend(), before = api.serializeCompanions([entry]), after = api.renameCompanion([entry], entry.id, 'Luna');
  let raw = before;
  reason(() => api.storeCompanions({ getItem: () => raw, setItem() { throw Error('quota'); } }, after, before), 'unavailable');
  assert.equal(raw, before);
  raw = api.serializeCompanions([friend('friend-1', 'Pip')]);
  reason(() => api.storeCompanions({ getItem: () => raw, setItem(_key, value) { raw = value; } }, after, before), 'changed');
  assert.equal(api.readCompanions(raw)[0].name, 'Pip');
});

test('ambiguous original scene labels stop before the library is changed', () => {
  const previous = friend(), next = api.renameCompanion([previous], previous.id, 'Luna')[0];
  const ambiguous = freeze(scene(object('one', 'Coco'), object('two', 'Coco · Little bear')));
  reason(() => api.renameCompanionInScene(ambiguous, previous, next), 'duplicate-name');
  assert.equal(previous.name, 'Coco'); assert.equal(ambiguous.objects[0].label, 'Coco');
});
