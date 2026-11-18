import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const runtime = new URL('../.sites-runtime/', import.meta.url);
const moduleFile = new URL('transcript-omission-test.mjs', runtime);
await mkdir(runtime, { recursive: true });
await writeFile(moduleFile, ts.transpileModule(await readFile(new URL('../lib/transcript-omission.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { VoiceTranscriptIndex } = await import(moduleFile.href);
after(() => unlink(moduleFile));
const segment = (id, text) => ({ id, text });
const update = (sessionId, revision, stableText, segments = [], partial = '', done = false) => ({ sessionId, revision, stableText, segments, partial, done });

test('new partials cannot be deletion targets; committed source coordinates stay stable while more speech arrives', () => {
  const index = new VoiceTranscriptIndex();
  index.observe(update('a', 1, '', [], '咕噜。'));
  assert.deepEqual(index.targets([segment('a:1', '咕噜。')]), []);
  index.observe(update('a', 2, '咕噜。', [segment('a:1', '咕噜。')]));
  const captured = index.targets([segment('a:1:0', '咕噜。')]);
  index.observe(update('a', 3, '咕噜。画太阳。', [segment('a:2', '画太阳。')]));
  assert.deepEqual(captured, [{ entryId: 'voice:a', start: 0, end: 3 }]);
  assert.deepEqual(index.targets([segment('a:2:0', '画太阳。')]), [{ entryId: 'voice:a', start: 3, end: 7 }]);
  captured[0].start = 2;
  assert.deepEqual(index.targets([segment('a:1', '咕噜。')]), [{ entryId: 'voice:a', start: 0, end: 3 }], 'returned spans cannot mutate the index');
});

test('the same phrase twice in one session maps each occurrence independently', () => {
  const index = new VoiceTranscriptIndex();
  index.observe(update('a', 1, '再画一只。', [segment('a:1', '再画一只。')]));
  index.observe(update('a', 2, '再画一只。再画一只。', [segment('a:2', '再画一只。')]));
  assert.deepEqual(index.targets([segment('a:1:0', '再画一只。')]), [{ entryId: 'voice:a', start: 0, end: 5 }]);
  assert.deepEqual(index.targets([segment('a:2:0', '再画一只。')]), [{ entryId: 'voice:a', start: 5, end: 10 }]);
  index.observe(update('b', 1, '再画一只。', [segment('b:1', '再画一只。')]));
  assert.deepEqual(index.targets([segment('b:1:0', '再画一只。')]), [{ entryId: 'voice:b', start: 0, end: 5 }]);
});

test('duplicate cumulative events do not reassign old IDs to new matching phrases', () => {
  const index = new VoiceTranscriptIndex();
  const first = segment('a:1', '画花。');
  const second = segment('a:2', '画花。');
  index.observe(update('a', 1, '画花。', [first]));
  index.observe(update('a', 2, '画花。画花。', [first, second]));
  index.observe(update('a', 2, '画花。画花。', [first, second]));
  index.observe(update('a', 1, '画花。', [first]));
  assert.deepEqual(index.targets([first, first, second]), [
    { entryId: 'voice:a', start: 0, end: 3 },
    { entryId: 'voice:a', start: 3, end: 6 },
  ]);
  index.observe(update('a', 3, '', [], '', true));
  assert.deepEqual(index.targets([second]), [{ entryId: 'voice:a', start: 3, end: 6 }]);
});

test('ASCII separators and leading segment whitespace preserve exact raw offsets', () => {
  const index = new VoiceTranscriptIndex();
  index.observe(update('a', 1, 'hello', [segment('a:1', ' hello ')]));
  index.observe(update('a', 2, 'hello world', [segment('a:2', 'world')]));
  assert.deepEqual(index.targets([segment('a:2:0', 'world')]), [{ entryId: 'voice:a', start: 6, end: 11 }]);
});

test('600-character queue chunks point to only their exact source portion', () => {
  const index = new VoiceTranscriptIndex();
  const text = '字'.repeat(1300);
  index.observe(update('a', 1, text, [segment('a:1', text)]));
  assert.deepEqual(index.targets([segment('a:1:600', '字'.repeat(600))]), [{ entryId: 'voice:a', start: 600, end: 1200 }]);
  assert.deepEqual(index.targets([segment('a:1:1200', '字'.repeat(100))]), [{ entryId: 'voice:a', start: 1200, end: 1300 }]);
  assert.deepEqual(index.targets([segment('a:1:1200', '字'.repeat(101))]), []);
  assert.deepEqual(index.targets([segment('a:1', '字')]), [], 'unsuffixed source IDs require the whole original text');
});

test('unknown, ambiguous, rewritten or mismatched source spans fail closed', () => {
  const index = new VoiceTranscriptIndex();
  index.observe(update('a', 1, '画太阳。', [segment('same-id', '画太阳。')]));
  assert.deepEqual(index.targets([segment('same-id:0', '画月亮。'), segment('unknown', '画太阳。')]), []);
  index.observe(update('b', 1, '画太阳。', [segment('same-id', '画太阳。')]));
  assert.deepEqual(index.targets([segment('same-id', '画太阳。')]), [], 'colliding IDs are ambiguous');
  index.observe(update('c', 1, '旧话。新话。', [segment('c:2', '新话。')]));
  assert.deepEqual(index.targets([segment('c:2', '新话。')]), [], 'missing cumulative prefix is not guessed');
  index.observe(update('d', 1, '画太阳。', [segment('d:1', '画太阳。')]));
  index.observe(update('d', 2, '画月亮。', [segment('d:2', '画月亮。')]));
  assert.deepEqual(index.targets([segment('d:1', '画太阳。'), segment('d:2', '画月亮。')]), [], 'rewriting cumulative text invalidates coordinates');
});

test('UTF-16 positions retain whole emoji and reset retires the old paper index', () => {
  const index = new VoiceTranscriptIndex();
  index.observe(update('a', 1, '🌈。花。', [segment('a:1', '🌈。'), segment('a:2', '花。')]));
  assert.deepEqual(index.targets([segment('a:1:0', '🌈。'), segment('a:2:0', '花。')]), [
    { entryId: 'voice:a', start: 0, end: 3 },
    { entryId: 'voice:a', start: 3, end: 5 },
  ]);
  assert.deepEqual(index.targets([segment('a:1:0', '\ud83c'), segment('a:1:1', '\udf08')]), []);
  index.reset();
  assert.deepEqual(index.targets([segment('a:1:0', '🌈。')]), []);
});


test('captured model targets are revalidated before deleting after a later ASR update', () => {
  const index = new VoiceTranscriptIndex();
  index.observe(update('a', 1, '咕噜。', [segment('a:1', '咕噜。')]));
  const captured = index.targets([segment('a:1:0', '咕噜。')]);
  index.observe(update('a', 2, '咕噜。', [], '画太阳'));
  assert.deepEqual(index.validTargets(captured), captured, 'partial hypotheses do not invalidate stable positions');
  index.observe(update('a', 3, '咕噜。画太阳。', [segment('a:2', '画太阳。')]));
  assert.deepEqual(index.validTargets(captured), captured, 'new stable speech leaves old positions valid');
  index.observe(update('a', 4, '新的文字。', [segment('a:3', '新的文字。')]));
  assert.deepEqual(index.validTargets(captured), [], 'unexpected prefix rewrite retires already-captured deletion coordinates');
  index.reset();
  assert.deepEqual(index.validTargets(captured), [], 'a new paper also retires asynchronous targets');
});
