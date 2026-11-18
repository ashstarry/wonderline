import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const temporary = new URL('.sites-runtime/content-filter-tests/', root);
await mkdir(temporary, { recursive: true });
after(() => rm(temporary, { recursive: true, force: true }));
async function bundle(name, contents, resolveDir = root.pathname, plugins = []) {
  const outfile = new URL(`${name}.mjs`, temporary).pathname;
  await build({ stdin: { contents, resolveDir, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, plugins, logLevel: 'silent' });
  return import(outfile);
}
const { inspectText, screenSegments, CONTENT_BLOCKED_MESSAGE, filterVoiceTranscript, VoiceTranscriptIndex, LivePaintingQueue, DrawingLookahead } = await bundle('feature', `
export * from './lib/content-filter'; export * from './lib/content-filter-transcript';
export { VoiceTranscriptIndex } from './lib/transcript-omission';
export { LivePaintingQueue } from './lib/live-painting';
export { DrawingLookahead } from './lib/drawing-lookahead';
`);
const segment = (id, text) => ({ id, text });
const tick = () => new Promise(resolve => setImmediate(resolve));
const latch = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const update = (revision, segments, stableText, partial = '', done = false, sessionId = 'mic') => ({ revision, segments, stableText, partial, done, sessionId });

test('simple rules are stateless and preserve normal fantasy and substring words', () => {
  const blocked = ['SHIT!', 'You’re an idiot.', 'shut up', 'pornography', 'ｆｕｃｋ', 'f\u200buck'];
  const allowed = ['Draw a queen and a key.', 'Draw a princess and goldfish.', 'A knight fighting a dragon.', 'I hate broccoli.', 'Scunthorpe', 'a classic butterfly', 'Dickens', 'a cockpit', 'shitake', ''];
  for (let repeat = 0; repeat < 20; repeat++) {
    for (const text of blocked) assert(inspectText(text).blocked, text);
    for (const text of allowed) assert(!inspectText(text).blocked, text);
  }
  const original = segment('a', 'Draw a queen and a key.');
  assert.equal(screenSegments([original]).allowed[0], original, 'allowed objects and wording pass through unchanged');
});

test('known simple-rule limitations remain explicit rather than adding semantic guessing', () => {
  for (const text of ['F U C K', 'fuuuck', 'I will hurt you.', 'I hate', 'you']) assert(!inspectText(text).blocked);
  assert(inspectText('Do not say shut up.').blocked, 'this intentionally small filter does not understand negation');
});

test('blocked stable spans stay omitted across cumulative updates, duplicates, empty flush and mic restart', () => {
  const index = new VoiceTranscriptIndex();
  let entries = [];
  const feed = value => { index.observe(value); const result = filterVoiceTranscript(entries, value, index); entries = result.conversation; return result; };
  feed(update(1, [segment('a', 'Draw a puppy.')], 'Draw a puppy.'));
  feed(update(2, [], 'Draw a puppy.', 'You are stupid.'));
  assert.equal(entries[0].partial, '');
  const first = feed(update(3, [segment('b', 'You are stupid.')], 'Draw a puppy. You are stupid.'));
  assert.equal(first.allowed.length, 0);
  const next = update(4, [segment('c', 'Add a ball.')], 'Draw a puppy. You are stupid. Add a ball.');
  feed(next); feed(next);
  feed(update(5, [], '', '', true));
  feed(update(1, [segment('d', 'Draw a sun.')], 'Draw a sun.', '', false, 'mic2'));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text.replace(/\s+/g, ' ').trim(), 'Draw a puppy. Add a ball.');
  assert.equal(entries[1].text, 'Draw a sun.');
  assert(!JSON.stringify(entries).includes('stupid'));
});

test('a blocked first sentence leaves a tombstone; following valid speech is still recorded', () => {
  const index = new VoiceTranscriptIndex();
  let value = update(1, [segment('bad', 'Shut up.')], 'Shut up.');
  index.observe(value);
  let result = filterVoiceTranscript([], value, index);
  assert.equal(result.conversation[0].text, '');
  value = update(2, [segment('good', 'Draw a sun.')], 'Shut up. Draw a sun.');
  index.observe(value);
  result = filterVoiceTranscript(result.conversation, value, index);
  assert.equal(result.conversation[0].text.trim(), 'Draw a sun.');
  assert.equal(result.allowed[0].text, 'Draw a sun.');
});

test('long stable segments are checked before queue chunking can split a blocked word', () => {
  const text = 'x '.repeat(299) + 'fuck';
  assert.equal(text.slice(600), 'ck');
  assert.equal(screenSegments([segment('long', text)]).allowed.length, 0);
});

test('actual queue and lookahead continue preparing the next safe idea during the previous turn', async () => {
  const first = latch(), second = latch(), ahead = new DrawingLookahead();
  const calls = [], commits = [], scene = { title: 'Paper', sky: 'paper', weather: 'clear', ground: 'none', objects: [] };
  let queue;
  queue = new LivePaintingQueue(async (text, signal) => {
    if (text === 'Draw a puppy.') { calls.push(text); await first.promise; }
    else { const result = await ahead.take(text, scene, signal, () => {}); assert(result); }
    commits.push(text);
  }, () => {
    const next = queue?.peekNext();
    if (next && !ahead.occupied && queue.reserveNext(next.id)) {
      ahead.start(next.text, { scene, layout: [{ id: 'puppy', bounds: { x: 100, y: 200, width: 100, height: 100 }, anchors: [] }], instruction: 'Draw a puppy.', recent: [] }, async text => {
        calls.push(text); await second.promise; return { action: 'update', scene: { ...scene, objects: [{ id: 'sun', kind: 'sun', x: 700, y: 100, scale: 1, color: '#ffcc33' }] }, message: 'OK' };
      });
    }
  }, { maxSegmentsPerTurn: 1 });
  queue.add(screenSegments([segment('one', 'Draw a puppy.')]).allowed); await tick();
  queue.add(screenSegments([segment('bad', 'You are stupid.'), segment('next', 'Draw a sun.')]).allowed); await tick();
  assert.deepEqual(calls, ['Draw a puppy.', 'Draw a sun.']);
  assert.deepEqual(commits, [], 'the first turn is still in flight');
  second.resolve(); await tick(); first.resolve(); await tick(); await tick();
  assert.deepEqual(commits, ['Draw a puppy.', 'Draw a sun.']);
  assert.equal(queue.snapshot().paused, false);
  queue.cancel(); ahead.cancel();
});

const provider = { calls: [], configs: 0, authorizations: 0 };
globalThis.__contentFilterProvider = provider;
const mockProvider = { name: 'mock-provider', setup(b) {
  b.onResolve({ filter: /\/lib\/openrouter$/ }, () => ({ path: 'mock-provider', namespace: 'mock' }));
  b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
    const p=globalThis.__contentFilterProvider;
    export class ApiError extends Error {constructor(status,message){super(message);this.status=status;}}
    export const authorizeRequest=async()=>{p.authorizations++;};
    export const readJson=async r=>r.json();
    export const jsonResponse=body=>Response.json(body);
    export const errorResponse=e=>Response.json({error:e.message},{status:e.status||500});
    export const getOpenRouterConfig=async()=>{p.configs++;return{key:'mock',model:'openai/gpt-6-luna'};};
    export const openRouterCompletion=async request=>{p.calls.push(request);return JSON.stringify({action:'ignore',message:'OK',title:null,sky:null,weather:null,ground:null,additions:[],updates:[],removals:[]});};
    export async function* openRouterStreamingCompletion(request){p.calls.push(request);yield '{}';}
  `, loader: 'js' }));
}};
const routePath = new URL('app/api/imagine/route.ts', root);
const current = await bundle('current-route', await readFile(routePath, 'utf8'), new URL('.', routePath).pathname, [mockProvider]);
const baselineSource = execFileSync('git', ['show', '6475d8d8fa3f5258b0eb12d77c73308bcc2ae1d0:app/api/imagine/route.ts'], { cwd: root, encoding: 'utf8' });
const baseline = await bundle('baseline-route', baselineSource, new URL('.', routePath).pathname, [mockProvider]);
const scene = { title: 'Paper', sky: 'paper', weather: 'clear', ground: 'none', objects: [] };
const request = (text, accept = 'application/json', extras = {}) => new Request('https://example.test/api/imagine', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept }, body: JSON.stringify({ text, scene, language: 'en', ...extras }) });

test('server fallback blocks direct JSON and streaming requests without even loading the model config', async () => {
  const calls = provider.calls.length, configs = provider.configs;
  for (const accept of ['application/json', 'application/x-ndjson']) {
    const response = await current.POST(request('You are stupid.', accept));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { scene, action: 'ignore', message: CONTENT_BLOCKED_MESSAGE });
  }
  assert.equal(provider.calls.length, calls);
  assert.equal(provider.configs, configs);
});

test('safe requests keep the exact pre-change LLM prompt, options, response and number of calls', async () => {
  for (const extras of [{}, { mode: 'live' }, { clarification: { instruction: 'Draw a puppy.', question: 'What color?' } }]) {
    const before = provider.calls.length;
    const oldResponse = await baseline.POST(request('Draw a small brown puppy.', 'application/json', extras));
    const oldBody = await oldResponse.json();
    const oldRequest = provider.calls.at(-1);
    const newResponse = await current.POST(request('Draw a small brown puppy.', 'application/json', extras));
    assert.equal(provider.calls.length, before + 2, 'one existing provider call per allowed request');
    assert.deepEqual(provider.calls.at(-1), oldRequest);
    assert.deepEqual(await newResponse.json(), oldBody);
    assert.equal(newResponse.status, oldResponse.status);
  }
});
