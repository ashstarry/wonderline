import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = 'd77bb8825b4eee15de08c95bb43c7f1974b28788';
const directory = new URL('../.sites-runtime/', import.meta.url);
await mkdir(directory, { recursive: true });
const files = [];
after(() => Promise.all(files.map(file => unlink(file).catch(() => {}))));
async function bundle(name, contents, options = {}) {
  const file = new URL(`speech-only-${name}.mjs`, directory); files.push(file);
  const built = await build({ stdin: { contents, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, ...options });
  await writeFile(file, built.outputFiles[0].text); return import(file.href);
}
const [api, pages, cloud, oldEnglish, oldChinese] = await Promise.all([
  bundle('current', "export * from './lib/router-speech'; export * from './lib/chinese-router-speech'; export * from './lib/speech-only-english'; export * from './lib/speech-budget'; export * from './lib/studio-origin';"),
  bundle('pages', "export * from './lib/speech-endpoint';", { define: { __WONDERLINE_PAGES__: 'true' } }),
  bundle('cloud', "export * from './lib/speech-endpoint';", { define: { __WONDERLINE_PAGES__: 'false' } }),
  bundle('baseline-english', execFileSync('git', ['show', `${baseline}:lib/router-speech.ts`], { cwd: root, encoding: 'utf8' }), { stdin: { contents: execFileSync('git', ['show', `${baseline}:lib/router-speech.ts`], { cwd: root, encoding: 'utf8' }), resolveDir: `${root}/lib`, loader: 'ts' } }),
  bundle('baseline-chinese', execFileSync('git', ['show', `${baseline}:lib/chinese-router-speech.ts`], { cwd: root, encoding: 'utf8' }), { stdin: { contents: execFileSync('git', ['show', `${baseline}:lib/chinese-router-speech.ts`], { cwd: root, encoding: 'utf8' }), resolveDir: `${root}/lib`, loader: 'ts' } }),
]);
const pcm = Int16Array.from({ length: 6400 }, (_, i) => Math.round(Math.sin(i / 9) * 1200));
const tick = () => new Promise(resolve => setImmediate(resolve));

async function capture(action, text = 'Draw a small cat.') {
  const previous = { fetch: globalThis.fetch, timeout: AbortSignal.timeout };
  const requests = [], timeouts = [];
  try {
    AbortSignal.timeout = ms => { timeouts.push(ms); return new AbortController().signal; };
    globalThis.fetch = async (url, init) => {
      requests.push({ url, method: init.method, redirect: init.redirect, headers: init.headers, body: init.body });
      return Response.json({ text });
    };
    return { result: await action(), requests, timeouts };
  } finally { globalThis.fetch = previous.fetch; AbortSignal.timeout = previous.timeout; }
}
const transcribe = (version, model, speechOnly) => version.transcribeRouter('test-key', model, pcm, new AbortController().signal, undefined, speechOnly);

test('legacy English default and explicit false preserve baseline body, audio, timeout and annotated response', async () => {
  const text = '[sneezing] Draw a small cat. [background music]';
  for (const model of api.ROUTER_ASR_MODELS) {
    const expected = await capture(() => transcribe(oldEnglish, model), text);
    for (const profile of [undefined, false]) {
      const actual = await capture(() => transcribe(api, model, profile), text);
      assert.deepEqual(actual, expected, `${model}: legacy must stay byte-for-byte unchanged`);
      assert.equal(actual.requests.length, 1); assert.equal(actual.result, text);
      assert.equal(JSON.parse(actual.requests[0].body).provider, undefined);
    }
  }
});

test('experimental English adds only the documented ElevenLabs event flag, with no extra request or timeout', async () => {
  for (const model of api.ROUTER_ASR_MODELS) {
    const expected = await capture(() => transcribe(oldEnglish, model));
    const actual = await capture(() => transcribe(api, model, true));
    const body = JSON.parse(actual.requests[0].body), oldBody = JSON.parse(expected.requests[0].body);
    assert.equal(actual.requests.length, 1); assert.deepEqual(actual.timeouts, expected.timeouts);
    assert.equal(body.language, 'en'); assert.deepEqual(body.input_audio, oldBody.input_audio);
    assert.equal(actual.requests[0].url, expected.requests[0].url);
    assert.deepEqual(actual.requests[0].headers, expected.requests[0].headers);
    assert.equal(actual.requests[0].redirect, 'manual');
    if (model === 'elevenlabs/scribe-v2') {
      assert.deepEqual(body.provider, { options: { elevenlabs: { tag_audio_events: false } } });
      delete body.provider; assert.deepEqual(body, oldBody);
    } else assert.equal(actual.requests[0].body, expected.requests[0].body);
    assert.equal(actual.result, expected.result);
  }
});

test('every experimental English route cleans only explicit events before its result enters rolling transcription', async () => {
  for (const model of api.ROUTER_ASR_MODELS) {
    const actual = await capture(() => transcribe(api, model, true), '[sneezing] Draw a cat. [music]');
    assert.equal(actual.result.trim(), 'Draw a cat.');
    const speech = 'Draw a sneezing bear beside a music box.';
    assert.equal((await capture(() => transcribe(api, model, true), speech)).result, speech);
    assert.equal((await capture(() => transcribe(api, model, true), '[sneezing] [music]')).result.trim(), '');
  }
});

test('isolated Chinese preserves upstream bodies and timeouts while removing explicit event labels', async () => {
  for (const model of api.CHINESE_ASR_MODELS) {
    const call = version => version.transcribeChineseRouter('test-key', model, pcm, new AbortController().signal);
    const expected = await capture(() => call(oldChinese), '[咳嗽]画一只小猫。[音乐]');
    const actual = await capture(() => call(api), '[咳嗽]画一只小猫。[音乐]');
    assert.deepEqual(actual.requests, expected.requests); assert.deepEqual(actual.timeouts, expected.timeouts);
    assert.equal(actual.result.trim(), '画一只小猫。');
    const speech = '画一只打喷嚏的小熊，旁边有音乐盒。';
    assert.equal((await capture(() => call(api), speech)).result, speech);
  }
});

test('model ordering, provider failure selection and speech-budget policies retain baseline behavior', () => {
  assert.deepEqual(api.ROUTER_ASR_MODELS, oldEnglish.ROUTER_ASR_MODELS);
  assert.deepEqual(api.CHINESE_ASR_MODELS, oldChinese.CHINESE_ASR_MODELS);
  for (const preferred of api.ROUTER_ASR_MODELS) for (const samples of [6400, 47999, 48000, 192000]) {
    for (const failed of [[], ['microsoft/mai-transcribe-2'], ['elevenlabs/scribe-v2'], [...api.ROUTER_ASR_MODELS]]) {
      assert.equal(api.selectSpeechModel(preferred, samples, '[music]', new Set(failed)), oldEnglish.selectSpeechModel(preferred, samples, '[music]', new Set(failed)));
    }
  }
  for (const key of ['id', 'cap', 'reserve', 'tests']) assert.equal(api.CHINESE_ROUTER_BUDGET[key], oldChinese.CHINESE_ROUTER_BUDGET[key]);
  for (const seconds of [0, 1, 40, 12000]) assert.equal(api.CHINESE_ROUTER_BUDGET.charge(seconds), oldChinese.CHINESE_ROUTER_BUDGET.charge(seconds));
});

function request(url = 'https://studio.example/api/speech/english', origin = 'https://studio.example', extra = {}) {
  return new Request(url, { headers: { Upgrade: 'websocket', ...(origin ? { Origin: origin } : {}), ...extra } });
}
test('experimental English gateway rejects other origins, paths and query profiles before any spending', async () => {
  let queries = 0, calls = 0; const original = globalThis.fetch;
  const env = { PUBLIC_ACCESS_ENABLED: 'true', VISITOR_HASH_KEY: 'test-hash', OPENROUTER_API_KEY: 'test-key', CLOUD_ASR_ENABLED: 'true', DB: { prepare() { queries++; throw Error('must not run'); } } };
  try {
    globalThis.fetch = async () => { calls++; throw Error('must not run'); };
    for (const input of [
      request(undefined, 'https://evil.example'), request(undefined, null),
      request(undefined, undefined, { 'Sec-Fetch-Site': 'cross-site' }),
      request('http://studio.example/api/speech/english', 'http://studio.example'),
      request('https://studio.example/api/speech/realtime'), request('https://studio.example/api/speech/english/'),
      request('https://studio.example/api/speech/english?profile=speech-only'),
      request('https://ashstarry.github.io/api/speech/english', 'https://ashstarry.github.io'),
    ]) assert.equal((await api.speechOnlyEnglishWebSocket(input, env, {})).status, 403, input.url);
    assert.equal(queries, 0); assert.equal(calls, 0);
    assert.equal((await api.speechOnlyEnglishWebSocket(request(), {}, {})).status, 503);
  } finally { globalThis.fetch = original; }
});

test('promoted English and Chinese routes allow public CORS and retain the legacy endpoint', () => {
  const preflight = path => new Request(`https://studio.example${path}`, { method: 'OPTIONS', headers: { Origin: 'https://ashstarry.github.io', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(api.pagesPreflight(preflight('/api/speech/english'), true).status, 204);
  assert.equal(api.pagesPreflight(preflight('/api/speech/realtime'), true).status, 204);
  assert.equal(api.pagesPreflight(preflight('/api/speech/chinese-clean'), true).status, 204);
  assert.equal(api.pagesPreflight(preflight('/api/speech/english'), false).status, 403);
});

test('frontend uses promoted speech routes on Pages and retains the cloud paths', () => {
  const original = globalThis.window;
  try {
    globalThis.window = { location: { origin: 'https://ashstarry.github.io' } };
    for (const language of ['en', 'zh']) {
      assert.equal(new URL(pages.speechEndpoint('realtime', undefined, language)).pathname, language==='en'?'/api/speech/english':'/api/speech/chinese-clean');
      assert.equal(new URL(pages.speechEndpoint('health', undefined, language)).pathname, language==='en'?'/api/speech/health':'/api/speech/health-chinese');
    }
    assert.throws(() => pages.speechEndpoint('realtime', 'https://softspoken-paper-garden.neonolm3.chatgpt.site/api/speech/english'));
    globalThis.window = { location: { origin: 'https://studio.example' } };
    assert.equal(cloud.speechEndpoint('realtime', undefined, 'en'), 'https://studio.example/api/speech/english');
    assert.equal(cloud.speechEndpoint('realtime', undefined, 'zh'), 'https://studio.example/api/speech/chinese');
    assert.equal(cloud.speechEndpoint('health', undefined, 'en'), 'https://studio.example/api/speech/health');
    assert.throws(() => cloud.speechEndpoint('realtime', '/api/speech/realtime', 'en'));
  } finally { if (original === undefined) delete globalThis.window; else globalThis.window = original; }
});

async function database() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0000_dapper_siren.sql', '0001_yummy_maverick.sql']) sql.exec(await readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8'));
  const db = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; }, first() { return sql.prepare(query).get(...this.args) ?? null; }, run() { return sql.prepare(query).run(...this.args); } }; },
    batch(items) { sql.exec('BEGIN'); try { const result = items.map(item => item.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  return { db, sql, used: () => sql.prepare('SELECT used FROM speech_budget WHERE id=?').get(api.ROUTER_BUDGET.id)?.used };
}
class FakeSocket {
  listeners = new Map(); sent = []; closed = false;
  accept() {} send(value) { this.sent.push(JSON.parse(value)); }
  addEventListener(type, callback) { this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]); }
  emit(type, data) { for (const callback of this.listeners.get(type) ?? []) callback({ data }); }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
}
async function gateway(fetcher, work, legacy = false, activityFactory) {
  const previous = { fetch: globalThis.fetch, Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair, warn: console.warn };
  const d = await database(), tasks = []; let socket;
  try {
    globalThis.fetch = fetcher; console.warn = () => {};
    globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = socket = new FakeSocket(); } };
    globalThis.Response = class extends previous.Response { constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init); if (init?.status === 101) { Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init.webSocket; } } };
    const entry = legacy ? api.routerSpeechWebSocket : api.speechOnlyEnglishWebSocket;
    const input = legacy ? request('https://studio.example/api/speech/realtime', 'https://ashstarry.github.io') : request();
    const response = await entry(input, { DB: d.db, PUBLIC_ACCESS_ENABLED: 'true', VISITOR_HASH_KEY: 'test-hash', OPENROUTER_API_KEY: 'test-key', CLOUD_ASR_ENABLED: 'true', ASR_PROVIDER: 'openrouter' }, { waitUntil(promise) { tasks.push(promise); } }, ...(legacy ? [false, activityFactory] : [activityFactory]));
    assert.equal(response.status, 101); await work(socket, d);
  } finally { socket?.close(); await Promise.all(tasks); globalThis.fetch = previous.fetch; globalThis.Response = previous.Response; globalThis.WebSocketPair = previous.WebSocketPair; console.warn = previous.warn; d.sql.close(); }
}

test('event-only experimental recognition stays empty and never triggers a fallback or fabricated clause', async () => {
  const calls = [];
  await gateway(async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ text: '[sneezing] [music]' }); }, async (socket, d) => {
    socket.emit('message', pcm.slice().buffer); await tick(); await tick();
    socket.emit('message', '{"type":"finish"}'); await tick(); await tick();
    assert.deepEqual(calls.map(call => call.model), ['microsoft/mai-transcribe-2']);
    assert.equal(socket.sent.filter(message => message.type === 'error').length, 0);
    const updates = socket.sent.filter(message => message.type === 'update').map(message => message.update);
    assert.ok(updates.length); assert.equal(updates.at(-1).done, true);
    for (const update of updates) { assert.equal(update.partial, ''); assert.equal(update.stableText, ''); assert.deepEqual(update.segments, []); }
    assert.equal(d.used(), api.ROUTER_BUDGET.tests + api.ROUTER_BUDGET.charge(2));
  });
});

test('real provider failure still switches to Scribe, applies the native flag and charges all attempts', async () => {
  const calls = [];
  await gateway(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    return calls.length === 1 ? new Response('', { status: 503 }) : Response.json({ text: '[sneezing] Draw a small cat. [music]' });
  }, async (socket, d) => {
    socket.emit('message', pcm.slice().buffer); await tick(); await tick();
    socket.emit('message', '{"type":"finish"}'); await tick(); await tick();
    assert.deepEqual(calls.map(call => call.model), ['microsoft/mai-transcribe-2', 'elevenlabs/scribe-v2']);
    assert.equal(calls[0].provider, undefined);
    for (const call of calls.slice(1)) assert.deepEqual(call.provider, { options: { elevenlabs: { tag_audio_events: false } } });
    assert.equal(socket.sent.at(-1).update.done, true); assert.equal(socket.sent.at(-1).update.stableText, 'Draw a small cat.');
    assert.equal(d.used(), api.ROUTER_BUDGET.tests + api.ROUTER_BUDGET.charge(4));
  });
});

test('GitHub gateway remains legacy through a primary failure and Scribe fallback', async () => {
  const calls = [];
  await gateway(async (_url, init) => { const body = JSON.parse(init.body); calls.push(body); return calls.length === 1 ? new Response('', { status: 503 }) : Response.json({ text: '[sneezing] Draw a cat.' }); }, async socket => {
    socket.emit('message', pcm.slice().buffer); await tick(); await tick();
    socket.emit('message', '{"type":"finish"}'); await tick(); await tick();
    assert.deepEqual(calls.map(call => call.model), ['microsoft/mai-transcribe-2', 'elevenlabs/scribe-v2', 'elevenlabs/scribe-v2']);
    for (const call of calls) assert.equal(call.provider, undefined);
    assert.equal(socket.sent.at(-1).update.stableText, '[sneezing] Draw a cat.');
  }, true);
});


test('experimental English gate stops upstream calls and public route cannot initialize it', async () => {
 let created=0,closed=0,calls=0;
 const factory=async()=>{created++;return {preRollSamples:6400,feed(){},finish(){},stats(){return{voiced:false,silence:1}},close(){closed++},summary(){return{engine:'test',frames:1,speechFrames:0,maxProbability:0,receivedMs:800}}}};
 await gateway(async()=>{calls++;return Response.json({text:'Unexpected words'})},async(socket)=>{socket.emit('message',pcm.slice().buffer);await tick();socket.emit('message','{"type":"finish"}');await tick();assert.equal(socket.sent.at(-1).update.done,true);assert.equal(socket.sent.at(-1).update.stableText,'')},false,factory);
 assert.equal(created,1);assert.equal(closed,1);assert.equal(calls,0);
 await gateway(async()=>Response.json({text:'Um. Draw a cat.'}),async socket=>{socket.emit('message',pcm.slice().buffer);await tick();await tick();socket.emit('message','{"type":"finish"}');await tick();await tick();assert.equal(socket.sent.at(-1).update.stableText,'Um. Draw a cat.')},true,factory);
 assert.equal(created,1);
});
test('failed gate initialization falls back to English recognition and still cleans fillers',async()=>{
 await gateway(async()=>Response.json({text:'Um. Draw a cat.'}),async socket=>{socket.emit('message',pcm.slice().buffer);await tick();await tick();socket.emit('message','{"type":"finish"}');await tick();await tick();assert.equal(socket.sent.at(-1).update.done,true);assert.equal(socket.sent.at(-1).update.stableText,'Draw a cat.')},false,async()=>{throw Error('test startup failure')});
});
test('Chinese raw and cleaned profiles retain identical request bodies and timing',async()=>{
 for(const model of api.CHINESE_ASR_MODELS){const raw='嗯。画一只猫。呃。';const before=await capture(()=>api.transcribeChineseRouter('test-key',model,pcm,new AbortController().signal),raw);const after=await capture(()=>api.transcribeChineseRouter('test-key',model,pcm,new AbortController().signal,undefined,undefined,true),raw);assert.deepEqual(after.requests,before.requests);assert.deepEqual(after.timeouts,before.timeouts);assert.equal(before.result,raw);assert.equal(after.result,'画一只猫。');}
});
