import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const names = ['picture-book', 'scene-validation'];
const files = names.map(name => new URL(`../.sites-runtime/picture-book-${name}.mjs`, import.meta.url));
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
for (const [index, name] of names.entries()) {
  const compiled = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replaceAll("'./scene-validation'", "'./picture-book-scene-validation.mjs'");
  await writeFile(files[index], compiled);
}
after(() => Promise.all(files.map(file => unlink(file))));
const { addPicture, readPictureBook, serializePictureBook, loadPictureBook, storePictureBook, validPictureThumbnail, PictureBookError, PICTURE_BOOK_KEY, PICTURE_BOOK_LIMIT, PICTURE_BOOK_MAX_BYTES } = await import(files[0].href);
const thumbnail = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jE2kAAAAASUVORK5CYII=';
const conversation = () => [{ id: 'voice:session-1', kind: 'voice', text: 'A mountain and a flower.', partial: '', status: 'saved', createdAt: 200, updatedAt: 500, sessionId: 'session-1', revision: 2, omittedRanges: [{ start: 0, end: 4 }] }];
const scene = () => ({ title: '小山上的花 / Mountain flower', sky: 'paper', weather: 'clear', ground: 'none', paper: { x: -100, y: 0, width: 1000, height: 600 }, objects: [{ id: 'flower', kind: 'drawing', color: '#339966', x: 230, y: 200, scale: 1.2, rotation: 45, stackRank: 4, marks: [{ type: 'ellipse', x: 0, y: 0, w: 40, h: 20, fill: '#ffaabb', stroke: '#445566', strokeWidth: 2 }] }], erasures: [{ id: 'erase-1', paths: ['M10 20L30 40'], width: 28, shape: 'square', targets: [{ key: 'mark:flower:abc:0', x: 230, y: 200, scale: 1.2, rotation: 45 }] }] });
const draft = () => ({ scene: scene(), style: 'watercolor', conversation: conversation(), thumbnail });
const entry = (id = 'one') => ({ ...draft(), id, createdAt: 2000 });
function storage(initial = null) {
  let value = initial;
  return { getItem(key) { assert.equal(key, PICTURE_BOOK_KEY); return value; }, setItem(key, next) { assert.equal(key, PICTURE_BOOK_KEY); value = next; }, value: () => value };
}
const throwsReason = (action, reason) => assert.throws(action, error => error instanceof PictureBookError && error.reason === reason);

test('a missing picturebook is empty; malformed data is never mistaken for empty', () => {
  assert.deepEqual(readPictureBook(null), []);
  for (const raw of ['', 'null', '[]', '{}', '{', '{"version":2,"entries":[]}']) assert.equal(readPictureBook(raw), null);
  assert.equal(readPictureBook(serializePictureBook([])).length, 0);
});

test('saved scene, erasures, position, rotation, stacking, viewport, style and transcript roundtrip exactly', () => {
  const entries = [entry()];
  assert.deepEqual(readPictureBook(serializePictureBook(entries)), entries);
  assert.deepEqual(entries[0].scene, scene());
});

test('keeping a picture creates an independent snapshot and does not mutate live state or earlier pictures', () => {
  const input = draft(), previous = [entry('old')], before = structuredClone(previous);
  const next = addPicture(previous, input, 'new', 3000);
  input.scene.objects[0].x = 999;
  input.conversation[0].text = 'Changed afterwards';
  assert.equal(next[0].scene.objects[0].x, 230);
  assert.equal(next[0].conversation[0].text, 'A mountain and a flower.');
  assert.deepEqual(previous, before);
  assert.deepEqual(next.map(item => item.id), ['new', 'old']);
});

test('twelve pictures are kept, and a thirteenth is rejected without silently evicting any', () => {
  const entries = Array.from({ length: PICTURE_BOOK_LIMIT }, (_, index) => entry(`picture-${index}`));
  assert.equal(readPictureBook(serializePictureBook(entries)).length, 12);
  throwsReason(() => addPicture(entries, draft(), 'thirteen'), 'full');
  assert.equal(entries[0].id, 'picture-0');
});

test('only bounded PNG thumbnails are accepted; remote, SVG and executable URLs are rejected', () => {
  assert.equal(validPictureThumbnail(thumbnail), true);
  for (const value of ['https://example.com/image.png', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)', '', 'data:image/png;base64,PHN2Zz4=', `${thumbnail}💥`]) assert.equal(validPictureThumbnail(value), false);
  for (const dimension of [0, 321, 100000]) {
    const bytes = Buffer.from(thumbnail.split(',')[1], 'base64'); bytes.writeUInt32BE(dimension, 16);
    assert.equal(validPictureThumbnail(`data:image/png;base64,${bytes.toString('base64')}`), false);
  }
});

test('oversize or corrupt scene, unsupported styles, invalid dates and duplicate IDs fail validation', () => {
  for (const changed of [
    { ...entry(), style: 'oil' }, { ...entry(), createdAt: Infinity }, { ...entry(), createdAt: 9e15 },
    { ...entry(), id: '<script>' }, { ...entry(), thumbnail: 'https://example.com/a.png' },
    { ...entry(), scene: { ...scene(), sky: 'bad' } },
    { ...entry(), scene: { ...scene(), objects: [{ ...scene().objects[0], marks: [{ type: 'path', d: 'M0 0<script>' }] }] } },
  ]) throwsReason(() => serializePictureBook([changed]), 'invalid');
  throwsReason(() => serializePictureBook([entry('same'), entry('same')]), 'invalid');
});

test('invalid transcript is rejected, never silently removed from a saved picture', () => {
  for (const conversation of [null, [{ ...entry().conversation[0], text: 42 }], [{ ...entry().conversation[0], status: 'secret' }], [entry().conversation[0], entry().conversation[0]]]) {
    throwsReason(() => serializePictureBook([{ ...entry(), conversation }]), 'invalid');
  }
});

test('large picturebook content is rejected before writing and is never truncated', () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ ...entry(`picture-${index}`), conversation: Array.from({ length: 4 }, (_, n) => ({ ...conversation()[0], id: `voice-${n}`, text: '我'.repeat(60000) })) }));
  throwsReason(() => serializePictureBook(entries), 'too-large');
  assert.equal(readPictureBook(' '.repeat(PICTURE_BOOK_MAX_BYTES / 2 + 1)), null);
});

test('store/load uses one dedicated key and preserves snapshots', () => {
  const local = storage();
  const empty = loadPictureBook(local);
  const saved = storePictureBook(local, [entry()], empty.raw);
  assert.equal(saved.raw, local.value());
  assert.deepEqual(loadPictureBook(local).entries, [entry()]);
});

test('quota or storage denial never deletes the already stored picturebook', () => {
  const raw = serializePictureBook([entry('safe')]), local = storage(raw);
  const unavailable = { getItem: local.getItem, setItem() { throw new DOMException('quota', 'QuotaExceededError'); } };
  throwsReason(() => storePictureBook(unavailable, [entry('new'), entry('safe')], raw), 'unavailable');
  assert.equal(local.value(), raw);
  throwsReason(() => loadPictureBook({ getItem() { throw new Error('denied'); }, setItem() {} }), 'unavailable');
});

test('corrupt storage is preserved and cannot be loaded as an empty replacement book', () => {
  const local = storage('{broken');
  throwsReason(() => loadPictureBook(local), 'invalid');
  throwsReason(() => storePictureBook(local, [entry()], '{broken'), 'invalid');
  assert.equal(local.value(), '{broken');
});

test('an update in another tab is detected before saving, preventing stale overwrite', () => {
  const local = storage(serializePictureBook([entry('old')]));
  const first = loadPictureBook(local);
  local.setItem(PICTURE_BOOK_KEY, serializePictureBook([entry('other-tab'), entry('old')]));
  const other = local.value();
  throwsReason(() => storePictureBook(local, [entry('this-tab'), ...first.entries], first.raw), 'changed');
  assert.equal(local.value(), other);
});

test('remove and one-level undo restore all stored content exactly', () => {
  const original = [entry('one'), entry('two')], local = storage(serializePictureBook(original));
  const before = loadPictureBook(local);
  const removed = storePictureBook(local, before.entries.filter(item => item.id !== 'one'), before.raw);
  assert.deepEqual(removed.entries.map(item => item.id), ['two']);
  const restored = storePictureBook(local, before.entries, removed.raw);
  assert.deepEqual(restored.entries, original);
});

test('a stale undo cannot overwrite a picture newly kept in another tab', () => {
  const original = [entry('one')], local = storage(serializePictureBook(original));
  const before = loadPictureBook(local), removed = storePictureBook(local, [], before.raw);
  local.setItem(PICTURE_BOOK_KEY, serializePictureBook([entry('other')]));
  throwsReason(() => storePictureBook(local, original, removed.raw), 'changed');
  assert.deepEqual(loadPictureBook(local).entries.map(item => item.id), ['other']);
});
