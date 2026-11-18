import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { readFile, writeFile, unlink } from 'node:fs/promises';

const root = new URL('../', import.meta.url), file = new URL('../.sites-runtime/chinese-speech-test.mjs', import.meta.url);
const built = await build({ stdin: { contents: "export * from './lib/chinese-router-speech';export * from './lib/chinese-rolling-speech';export * from './lib/speech-budget';", resolveDir: root.pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
await writeFile(file, built.outputFiles[0].text); after(() => unlink(file));
const api = await import(file.href);
const tick = () => new Promise(resolve => setImmediate(resolve));
const voice = (seconds = .4) => Int16Array.from({ length: Math.round(seconds * 16000) }, (_, i) => Math.round(1800 * Math.sin(2 * Math.PI * 220 * i / 16000))).buffer;
const silence = (seconds = .6) => new ArrayBuffer(Math.round(seconds * 32000));
function rolling(id = 'zh') {
  const pending = [], updates = []; let failures = 0, active = 0, peak = 0;
  const session = new api.ChineseRollingSpeech(id, (pcm, signal) => {
    active++; peak = Math.max(peak, active);
    return new Promise((resolve, reject) => pending.push({ samples: pcm.length, signal,
      resolve: text => { active--; resolve(text); }, reject: error => { active--; reject(error); } }));
  }, update => updates.push(update), () => failures++);
  return { session, pending, updates, failures: () => failures, peak: () => peak,
    async reply(text) { assert.ok(pending.length, 'an ASR request is pending'); pending.shift().resolve(text); await tick(); },
    text: () => updates.at(-1)?.stableText ?? '', clauses: () => updates.flatMap(update => update.segments.map(segment => segment.text)) };
}

test('English segmentation remains byte-identical to the public release', async () => {
  // The shared transport now has an opt-in experimental profile. Its legacy
  // payload, result and timers are compared to executable d77bb88 source in
  // speech-only-profile.test.mjs; segmentation itself must still be unchanged.
  const expected = { 'rolling-speech.ts': 'f4f9d61e76b40303a32268a81a9d38f64790889dd68daf858697bb00958d4c96' };
  for (const [name, hash] of Object.entries(expected)) assert.equal(createHash('sha256').update(await readFile(new URL(`lib/${name}`, root))).digest('hex'), hash);
});
test('Chinese configuration is server-owned and ignores client/provider model overrides', () => {
  const config = api.chineseSpeechConfig({ OPENROUTER_API_KEY: 'secret-test', DB: {}, CLOUD_ASR_ENABLED: 'true', OPENROUTER_ASR_MODEL: 'expensive-arbitrary' });
  assert.equal(config.model, 'fish-audio/transcribe-1'); assert.equal(config.ready, true);
  assert.equal(api.chineseSpeechConfig({ OPENROUTER_API_KEY: 'test', DB: {} }).ready, false);
});
test('Chinese endpoint accepts only HTTPS studio-origin exact-path requests', () => {
  const request = (url, origin, extra = {}) => new Request(url, { headers: { ...(origin ? { Origin: origin } : {}), ...extra } });
  assert.equal(api.isChineseSpeechRequest(request('https://studio.example/api/speech/chinese', 'https://studio.example')), true);
  for (const req of [
    request('https://studio.example/api/speech/chinese', 'https://ashstarry.github.io'),
    request('https://ashstarry.github.io/api/speech/chinese', 'https://ashstarry.github.io'),
    request('https://studio.example/api/speech/chinese', 'https://evil.example'),
    request('https://studio.example/api/speech/chinese', undefined),
    request('https://studio.example/api/speech/chinese?model=other', 'https://studio.example'),
    request('https://studio.example/api/speech/chinese?key=leak', 'https://studio.example'),
    request('https://studio.example/api/speech/realtime', 'https://studio.example'),
    request('http://studio.example/api/speech/chinese', 'http://studio.example'),
    request('https://studio.example/api/speech/chinese', 'https://studio.example', { 'sec-fetch-site': 'cross-site' }),
  ]) assert.equal(api.isChineseSpeechRequest(req), false);
});
test('cross-origin, wrong protocol, and disabled Chinese requests cannot spend', async () => {
  let prepares = 0; const env = { DB: { prepare() { prepares++; throw Error('must not run'); } } };
  assert.equal((await api.chineseRouterSpeechWebSocket(new Request('https://studio.example/api/speech/chinese', { headers: { Upgrade: 'websocket', Origin: 'https://ashstarry.github.io' } }), env, {})).status, 403);
  assert.equal((await api.chineseRouterSpeechWebSocket(new Request('https://studio.example/api/speech/chinese', { headers: { Upgrade: 'websocket', Origin: 'https://studio.example' } }), env, {})).status, 503);
  assert.equal((await api.chineseRouterSpeechWebSocket(new Request('https://studio.example/api/speech/chinese', { method: 'POST' }), env, {})).status, 426);
  assert.equal(prepares, 0);
});
test('each Chinese model receives zh and exact mono PCM without another LLM request', async () => {
  const original = globalThis.fetch, requests = [];
  try {
    globalThis.fetch = async (url, init) => { requests.push({ url, init, body: JSON.parse(init.body) }); return Response.json({ text: '画一朵花。' }); };
    for (const model of api.CHINESE_ASR_MODELS) assert.equal(await api.transcribeChineseRouter('private-test', model, new Int16Array([-1234, 1234]), new AbortController().signal), '画一朵花。');
    assert.equal(requests.length, 2);
    for (const { url, init, body } of requests) {
      assert.equal(url, 'https://openrouter.ai/api/v1/audio/transcriptions'); assert.equal(init.redirect, 'manual');
      assert.equal(body.language, 'zh'); assert.equal(body.input_audio.format, 'wav');
      const bytes = Buffer.from(body.input_audio.data, 'base64'); assert.equal(bytes.length, 48); assert.equal(bytes.readInt16LE(44), -1234);
      assert.deepEqual(Object.keys(body).sort(), ['input_audio', 'language', 'model']);
    }
    await assert.rejects(api.transcribeChineseRouter('private-test', 'other', new Int16Array(1), new AbortController().signal));
    assert.equal(requests.length, 2);
  } finally { globalThis.fetch = original; }
});
test('redirects and invalid provider output fail without leaking raw data into diagnostics', async () => {
  const original = globalThis.fetch;
  try {
    for (const result of [new Response('private audio/raw error', { status: 302, headers: { Location: 'https://evil.example' } }), Response.json({ text: {} }), Response.json({ text: 'x'.repeat(12001) })]) {
      const diagnostics = []; globalThis.fetch = async () => result;
      await assert.rejects(api.transcribeChineseRouter('private-test', api.CHINESE_ASR_MODELS[0], new Int16Array(6400), new AbortController().signal, value => diagnostics.push(value)));
      assert.equal(diagnostics.length, 1); assert.equal(JSON.stringify(diagnostics).includes('private'), false);
      assert.deepEqual(Object.keys(diagnostics[0]).sort(), ['cancelled', 'model', 'stage', 'status', 'timeout']);
    }
  } finally { globalThis.fetch = original; }
});
test('Chinese timeout is bounded at3.5seconds and cancellation propagates to transport', async () => {
  assert.equal(api.CHINESE_ASR_TIMEOUT_MS, 3500);
  const original = globalThis.fetch; const controller = new AbortController(); let signal;
  try {
    globalThis.fetch = (_url, init) => { signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); };
    const pending = api.transcribeChineseRouter('test', api.CHINESE_ASR_MODELS[0], new Int16Array(1), controller.signal);
    controller.abort(); await assert.rejects(pending); assert.equal(signal.aborted, true);
  } finally { globalThis.fetch = original; }
});

test('inference coalesces newest audio while remaining single-flight', async () => {
  const r = rolling(); r.session.feed(voice()); r.session.feed(voice()); r.session.feed(voice());
  assert.equal(r.pending.length, 1); await r.reply('画一只小猫。');
  assert.equal(r.pending[0].samples, 19200); await r.reply('画一只小猫。旁边画一朵花。');
  assert.equal(r.peak(), 1); assert.equal(r.text(), '画一只小猫。'); assert.equal(r.updates.at(-1).partial, '旁边画一朵花。'); r.session.cancel();
});
test('a relational fragment survives a pause and joins its later completion', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('在小猫的');
  r.session.feed(silence()); await r.reply('在小猫的');
  assert.equal(r.text(), ''); assert.equal(r.updates.at(-1).partial, '在小猫的');
  for (let i = 0; i < 5; i++) r.session.feed(silence());
  assert.equal(r.pending.length, 0);
  r.session.feed(voice()); await r.reply('左边画一朵花。'); r.session.feed(silence()); await r.reply('左边画一朵花。');
  assert.equal(r.text(), '在小猫的左边画一朵花。'); assert.deepEqual(r.clauses(), ['在小猫的左边画一朵花。']); r.session.cancel();
});
test('incomplete noun phrases are not prematurely delivered merely because silence exceeds500ms', async () => {
  for (const [first, tail] of [['画一个', '城堡。'], ['旁边有一只红色的', '狐狸。'], ['让小狗拿着', '一个气球。'], ['把小猫移到', '右边。']]) {
    const r = rolling(); r.session.feed(voice()); await r.reply(first); r.session.feed(silence()); await r.reply(first);
    assert.equal(r.text(), '', first); r.session.feed(voice()); await r.reply(tail); r.session.finish(); await r.reply(tail);
    assert.equal(r.text(), first + tail); assert.equal(r.updates.at(-1).done, true); assert.equal(r.failures(), 0);
  }
});
test('a complete paused clause is released without waiting for microphone stop', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一座城堡'); r.session.feed(silence()); await r.reply('画一座城堡');
  assert.equal(r.text(), '画一座城堡'); assert.equal(r.updates.at(-1).done, false); r.session.cancel();
});
test('audio arriving during a paused inference remains in the next window', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一只小猫。');
  r.session.feed(silence()); r.session.feed(voice()); await r.reply('画一只小猫。');
  // The first completed500ms pause is consumed; its remaining100ms is retained before the new voice.
  assert.equal(r.pending[0].samples, 8000); await r.reply('画一朵花。'); r.session.finish(); await r.reply('画一朵花。');
  assert.equal(r.text(), '画一只小猫。画一朵花。'); assert.equal(r.clauses().length, 2);
});
test('stop drains an in-flight window and its new audio exactly once', async () => {
  const r = rolling(); r.session.feed(voice()); r.session.feed(voice()); r.session.finish();
  await r.reply('画一只小猫。'); await r.reply('画一只小猫。旁边有一朵花。');
  assert.equal(r.updates.at(-1).done, true); assert.equal(r.text(), '画一只小猫。旁边有一朵花。');
  assert.deepEqual(r.clauses(), ['画一只小猫。', '旁边有一朵花。']); assert.equal(r.pending.length, 0);
});
test('stop flushes a retained incomplete fragment with no extra call for silence', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('在小猫的'); r.session.feed(silence()); await r.reply('在小猫的');
  r.session.feed(silence()); r.session.finish(); assert.equal(r.pending.length, 0); assert.equal(r.text(), '在小猫的'); assert.equal(r.updates.at(-1).done, true);
});
test('silence and cancellation cannot spend or apply late recognition', async () => {
  const quiet = rolling(); for (let i = 0; i < 30; i++) quiet.session.feed(silence()); quiet.session.finish();
  assert.equal(quiet.pending.length, 0); assert.equal(quiet.text(), ''); assert.equal(quiet.updates.at(-1).done, true);
  const r = rolling(); r.session.feed(voice()); const signal = r.pending[0].signal; r.session.cancel(); await r.reply('画一只猫。');
  assert.equal(signal.aborted, true); assert.equal(r.updates.length, 0); r.session.feed(voice()); assert.equal(r.pending.length, 0);
});
test('12second acoustic rollover retains incomplete words and deduplicates overlapping audio', async () => {
  const r = rolling(); r.session.feed(voice(12)); await r.reply('画一只小猫。在小猫的');
  assert.equal(r.updates.at(-1).partial, '画一只小猫。在小猫的');
  r.session.feed(voice()); await r.reply('在小猫的左边画一朵花。'); r.session.finish(); await r.reply('在小猫的左边画一朵花。');
  assert.equal(r.text(), '画一只小猫。在小猫的左边画一朵花。');
  assert.deepEqual(r.clauses(), ['画一只小猫。', '在小猫的左边画一朵花。']);
});
test('a provisional terminal stop at an acoustic cut is revised by the overlapping decode', async () => {
  const r = rolling(); r.session.feed(voice(12)); await r.reply('画一只小熊。然后在天空画三。');
  r.session.feed(voice()); await r.reply('然后在天空画三个气球和一架。');
  assert.equal(r.updates.at(-1).partial.includes('三。个'), false);
  r.session.finish(); await r.reply('然后在天空画三个气球和一架直升机。');
  assert.equal(r.text(), '画一只小熊。然后在天空画三个气球和一架直升机。');
  assert.deepEqual(r.clauses(), ['画一只小熊。', '然后在天空画三个气球和一架直升机。']);
});
for (const [pending, decoded, expected] of [
  ['然后在天空画三。', '然后，在天空画三个气球。', '然后，在天空画三个气球。'],
  ['画一朵花旁边有一只红色的。', '旁边有一只红色的小猫。', '画一朵花旁边有一只红色的小猫。'],
  ['树上有一只小鸟。然后画一。', '然后画一条小鱼。', '树上有一只小鸟。然后画一条小鱼。'],
  ['三。', '三个气球。', '三个气球。'],
  ['前面有金色的光芒旁边漂浮着一', '银色的光芒旁边漂浮着一个星球', '前面有银色的光芒旁边漂浮着一个星球'],
  ['画一只猫', '在左边。', '画一只猫在左边。'],
  ['', '画一只猫。', '画一只猫。'],
  ['画一只猫。', '', '画一只猫。'],
]) test(`uncommitted overlap may revise only the suffix: ${pending} + ${decoded}`, () => {
  assert.equal(api.mergeChinesePendingOverlap(pending, decoded), expected);
});
test('rollover after committed text revises the pending suffix without replaying old commands', async () => {
  const r = rolling(); r.session.feed(voice(.4)); await r.reply('画一只小熊。');
  r.session.feed(voice(.4)); await r.reply('画一只小熊。然后在天空画'); assert.equal(r.text(), '画一只小熊。');
  r.session.feed(voice(11.2)); await r.reply('画一只小熊。然后在天空画三。');
  r.session.feed(voice(.4)); await r.reply('然后在天空画三个气球。');
  r.session.finish(); await r.reply('然后在天空画三个气球。');
  assert.deepEqual(r.clauses(), ['画一只小熊。', '然后在天空画三个气球。']); assert.equal(r.failures(), 0);
});
test('different subsequent clauses and punctuation revisions never replay earlier commands', async () => {
  const r = rolling(); r.session.feed(voice()); await r.reply('画一只小猫。');
  r.session.feed(voice()); await r.reply('画一只小猫，旁边画一');
  assert.equal(r.text(), '画一只小猫，'); r.session.feed(voice()); await r.reply('画一只小猫。旁边画一朵花。');
  r.session.finish(); await r.reply('画一只小猫。旁边画一朵花。');
  assert.equal(r.clauses().length, 2); assert.equal(r.clauses()[1], '旁边画一朵花。');
});
test('provider failure aborts once and does not fabricate stable text', async () => {
  const r = rolling(); r.session.feed(voice()); r.pending.shift().reject(Error('test failure')); await tick();
  assert.equal(r.failures(), 1); assert.equal(r.text(), ''); r.session.feed(voice()); r.session.finish(); assert.equal(r.pending.length, 0);
});

async function database() {
  const sql = new DatabaseSync(':memory:');
  for (const name of ['0000_dapper_siren.sql', '0001_yummy_maverick.sql']) sql.exec(await readFile(new URL(`drizzle/${name}`, root), 'utf8'));
  const db = { prepare(query) { return { args: [], bind(...args) { this.args = args; return this; }, first() { return sql.prepare(query).get(...this.args) ?? null; }, run() { return sql.prepare(query).run(...this.args); } }; },
    batch(items) { sql.exec('BEGIN'); try { const result = items.map(item => item.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } } };
  return { db, sql, used: () => sql.prepare('SELECT used FROM speech_budget WHERE id=?').get(api.ROUTER_BUDGET.id)?.used };
}
test('Chinese attempts share the English lifetime budget at a conservative120microUSD/second', async () => {
  const d = await database(), policy = api.CHINESE_SPEECH_BUDGET;
  try {
    assert.equal(policy.id, api.ROUTER_BUDGET.id); assert.equal(policy.cap, api.ROUTER_BUDGET.cap);
    assert.ok(policy.reserve >= policy.charge(api.CHINESE_MAX_BILLED_SECONDS));
    const { id } = await api.reserveSpeech(d.db, 'zh-user', policy); assert.equal(d.used(), policy.tests + policy.reserve);
    await api.settleSpeech(d.db, id, 40, policy); await api.settleSpeech(d.db, id, 40, policy);
    assert.equal(d.used(), policy.tests + 4800);
  } finally { d.sql.close(); }
});
test('spent shared budget and concurrent lease limits reject before upstream access', async () => {
  const d = await database(), policy = api.CHINESE_SPEECH_BUDGET; const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; throw Error('must not run'); };
    d.sql.prepare('INSERT INTO speech_budget (id,used) VALUES (?,?)').run(policy.id, policy.cap);
    const response = await api.chineseRouterSpeechWebSocket(new Request('https://studio.example/api/speech/chinese', { headers: { Upgrade: 'websocket', Origin: 'https://studio.example' } }),
      { DB: d.db, PUBLIC_ACCESS_ENABLED: 'true', VISITOR_HASH_KEY: 'test-hash', OPENROUTER_API_KEY: 'test-private', CLOUD_ASR_ENABLED: 'true' }, { waitUntil() {} });
    assert.equal(response.status, 429); assert.equal(calls, 0); assert.equal(d.used(), policy.cap);
  } finally { globalThis.fetch = original; d.sql.close(); }
});

class FakeSocket {
  listeners = new Map(); sent = []; closed = false;
  accept() {} send(value) { this.sent.push(JSON.parse(value)); }
  addEventListener(type, callback) { this.listeners.set(type, [...this.listeners.get(type) ?? [], callback]); }
  emit(type, data) { for (const callback of this.listeners.get(type) ?? []) callback({ data }); }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
}
async function gateway(fetcher, work, activityFactory) {
  const original = { fetch: globalThis.fetch, Response: globalThis.Response, WebSocketPair: globalThis.WebSocketPair }, d = await database(), tasks = []; let socket;
  try {
    globalThis.fetch = fetcher;
    globalThis.WebSocketPair = class { constructor() { this[0] = new FakeSocket(); this[1] = socket = new FakeSocket(); } };
    globalThis.Response = class extends original.Response { constructor(body, init) { super(body, init?.status === 101 ? { status: 200 } : init); if (init?.status === 101) { Object.defineProperty(this, 'status', { value: 101 }); this.webSocket = init.webSocket; } } };
    const response = await api.chineseRouterSpeechWebSocket(new Request('https://studio.example/api/speech/chinese', { headers: { Upgrade: 'websocket', Origin: 'https://studio.example' } }),
      { DB: d.db, PUBLIC_ACCESS_ENABLED: 'true', VISITOR_HASH_KEY: 'test-hash', OPENROUTER_API_KEY: 'test-private', CLOUD_ASR_ENABLED: 'true' }, { waitUntil(promise) { tasks.push(promise); } }, activityFactory);
    assert.equal(response.status, 101); await work(socket, d);
  } finally { socket?.close(); await Promise.all(tasks); globalThis.fetch = original.fetch; globalThis.Response = original.Response; globalThis.WebSocketPair = original.WebSocketPair; d.sql.close(); }
}
test('gateway falls back only after a real failure and charges every attempt', async () => {
  const models = [];
  await gateway(async (_url, init) => { const body = JSON.parse(init.body); models.push(body.model); return models.length === 1 ? new Response('', { status: 503 }) : Response.json({ text: '画一只小猫。' }); }, async (socket, d) => {
    socket.emit('message', voice()); await tick(); await tick(); socket.emit('message', '{"type":"finish"}'); await tick(); await tick();
    assert.deepEqual(models, ['fish-audio/transcribe-1', 'qwen/qwen3-asr-1.7b', 'qwen/qwen3-asr-1.7b']);
    assert.equal(socket.sent[0].mode, 'openrouter-rolling'); assert.equal(socket.sent.at(-1).update.done, true);
    assert.equal(socket.sent.at(-1).update.stableText, '画一只小猫。'); assert.equal(d.used(), api.CHINESE_SPEECH_BUDGET.tests + 6 * 120);
    assert.equal(JSON.stringify(socket.sent).includes('test-private'), false);
  });
});
test('valid empty recognition is not a provider failure and never triggers fallback', async () => {
  const models = [];
  await gateway(async (_url, init) => { models.push(JSON.parse(init.body).model); return Response.json({ text: '' }); }, async socket => {
    socket.emit('message', voice()); await tick(); socket.emit('message', '{"type":"finish"}'); await tick();
    assert.deepEqual(models, ['fish-audio/transcribe-1', 'fish-audio/transcribe-1']); assert.equal(socket.sent.at(-1).update.done, true);
  });
});
test('failed primary and fallback close once with safe diagnostics, and do not retry forever', async () => {
  let calls = 0;
  await gateway(async () => { calls++; return new Response('private provider detail', { status: 503 }); }, async (socket, d) => {
    socket.emit('message', voice()); await tick(); await tick(); assert.equal(calls, 2); assert.equal(socket.closed, true);
    assert.equal(socket.sent.at(-1).type, 'error'); assert.equal(socket.sent.at(-1).code, 'provider');
    assert.equal(JSON.stringify(socket.sent).includes('private'), false); assert.equal(d.used(), api.CHINESE_SPEECH_BUDGET.tests + 4 * 120);
    socket.emit('message', voice()); assert.equal(calls, 2);
  });
});
test('invalid client config message terminates before any paid request', async () => {
  let calls = 0;
  await gateway(async () => { calls++; return Response.json({ text: '' }); }, async socket => {
    socket.emit('message', JSON.stringify({ model: 'other', language: 'en', key: 'fake' }));
    assert.equal(socket.sent.at(-1).code, 'invalid'); assert.equal(socket.closed, true); assert.equal(calls, 0);
  });
});

 test('public Chinese websocket admits only the exact Pages origin when publication is enabled', () => {
 const request = origin => new Request('https://studio.example/api/speech/chinese', {headers:{Origin:origin,'Sec-Fetch-Site':'cross-site'}});
 assert.equal(api.isChineseSpeechRequest(request('https://ashstarry.github.io'),true),true);
 assert.equal(api.isChineseSpeechRequest(request('https://ashstarry.github.io'),false),false);
 for(const origin of ['https://evil.example','https://ashstarry.github.io.evil.example','null'])assert.equal(api.isChineseSpeechRequest(request(origin),true),false);
 });

test('real gateway failures produce one correlated terminal record with both upstream statuses', async () => {
 const saved={info:console.info,warn:console.warn,error:console.error},logs=[];for(const level of ['info','warn','error'])console[level]=(event,data)=>logs.push({level,event,data});
 try{let calls=0;await gateway(async()=>new Response('PRIVATE_UPSTREAM_BODY',{status:++calls===1?503:429,headers:{'x-request-id':`qa-request-${calls}`}}),async socket=>{socket.emit('message',voice());await tick();await tick();assert.equal(socket.sent.at(-1).code,'provider');});const failed=logs.filter(x=>x.event==='speech_session_failed');assert.equal(failed.length,1);assert.equal(failed[0].level,'error');assert.deepEqual(failed[0].data.recentAttempts.map(x=>x.status),[503,429]);assert.deepEqual(failed[0].data.recentAttempts.map(x=>x.providerRequestId),['qa-request-1','qa-request-2']);assert.ok(logs.filter(x=>x.event==='speech_attempt_finished').every(x=>x.data.session===failed[0].data.session));assert.ok(!JSON.stringify(logs).includes('PRIVATE_UPSTREAM_BODY'));assert.ok(!JSON.stringify(logs).includes('test-private'));}
 finally{Object.assign(console,saved);}
});
test('the optional acoustic gate blocks noisy packets before any upstream request or billed audio',async()=>{
 let calls=0,closed=0;
 const activity={preRollSamples:6400,feed(){},finish(){},stats(start,end){return{voiced:false,silence:(end-start)/16000}},close(){closed++},summary(){return{engine:'test',frames:50,speechFrames:0,maxProbability:0,receivedMs:1000}}};
 await gateway(async()=>{calls++;return Response.json({text:'不该出现的内容'})},async(socket,d)=>{for(let i=0;i<5;i++){socket.emit('message',voice(.2));await tick();}socket.emit('message','{"type":"finish"}');await tick();assert.equal(calls,0);assert.equal(socket.sent.at(-1).update.done,true);assert.equal(socket.sent.at(-1).update.stableText,'');assert.equal(d.used(),api.CHINESE_SPEECH_BUDGET.tests);},async()=>activity);
 assert.equal(closed,1);
});
test('a detector startup failure is visible and preserves the previous recognizer instead of bricking speech',async()=>{
 const old=console.error,logs=[];console.error=(...args)=>logs.push(args);let calls=0;
 try{await gateway(async()=>{calls++;return Response.json({text:'画一只小猫。'})},async socket=>{socket.emit('message',voice());await tick();socket.emit('message','{"type":"finish"}');await tick();await tick();assert.ok(calls>0);assert.equal(socket.sent.at(-1).update.done,true);},async()=>{throw Error('startup failed')});assert.ok(logs.some(x=>x[0]==='speech_noise_gate_unavailable'));}finally{console.error=old;}
});
