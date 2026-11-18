import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const temporary = new URL('../.sites-runtime/asr-connection-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
await writeFile(temporary, ts.transpileModule(await readFile(new URL('../lib/asr-connection.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace("'./speech-endpoint'", "'./asr-speech-endpoint-test.mjs'"));
const endpointTemporary=new URL('../.sites-runtime/asr-speech-endpoint-test.mjs',import.meta.url);
await writeFile(endpointTemporary,ts.transpileModule(await readFile(new URL('../lib/speech-endpoint.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'./studio-endpoint'","'./asr-studio-endpoint-test.mjs'"));
const studioTemporary=new URL('../.sites-runtime/asr-studio-endpoint-test.mjs',import.meta.url);
await writeFile(studioTemporary,ts.transpileModule(await readFile(new URL('../lib/studio-endpoint.ts',import.meta.url),'utf8'),{compilerOptions:{target:99,module:99}}).outputText);
after(()=>unlink(studioTemporary));
after(()=>unlink(endpointTemporary));
const { checkAsrConnection, CLOUD_ASR_MODEL } = await import(temporary.href);
after(() => unlink(temporary));

const healthy = { ready: true, model: CLOUD_ASR_MODEL, offline: false, startupError: false, streaming: { mode: 'qwen-realtime' } };
const respond = body => async () => Response.json(body);
test('the same-origin OpenRouter rolling contract is accepted with its actual model',async()=>{
 const status=await checkAsrConnection({fetchImpl:respond({...healthy,model:'microsoft/mai-transcribe-2',streaming:{mode:'openrouter-rolling'}})});
 assert.equal(status.ready,true);assert.equal(status.model,'microsoft/mai-transcribe-2');
});

test('browser readiness uses only a same-origin GET to cloud health, without redirects or inference', async () => {
  let calls = 0;
  const status = await checkAsrConnection({ fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, '/api/speech/health');
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.mode, 'cors');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
    return Response.json(healthy);
  } });
  assert.equal(calls, 1);
  assert.equal(status.state, 'ready');
  assert.equal(status.ready, true);
  assert.equal(status.model, CLOUD_ASR_MODEL);
});

test('loading and failed initialization remain distinct from unavailable transport', async () => {
  const loading = await checkAsrConnection({ fetchImpl: respond({ ...healthy, ready: false }) });
  const failed = await checkAsrConnection({ fetchImpl: respond({ ...healthy, ready: false, startupError: true }) });
  assert.equal(loading.state, 'loading');
  assert.equal(failed.state, 'startup-error');
  assert.equal(loading.ready, false);
  assert.equal(failed.ready, false);
  assert.notEqual(loading.message, failed.message);
});

test('only the exact cloud model and realtime health contract count as ready', async () => {
  for (const body of [
    { ...healthy, model: 'another-model' },
    { ...healthy, streaming: undefined },
    { ...healthy, streaming: { mode: 'batch' } },
    { ...healthy, offline: true },
    { ...healthy, ready: 'true' },
    { ...healthy, startupError: undefined },
    null, [], 'hello',
  ]) {
    const status = await checkAsrConnection({ fetchImpl: respond(body) });
    assert.equal(status.state, 'outdated');
    assert.equal(status.ready, false);
  }
  const malformed = await checkAsrConnection({ fetchImpl: async () => new Response('not JSON') });
  assert.equal(malformed.state, 'outdated');
});

test('network failures and HTTP failures do not claim that the local service is definitely stopped', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('Failed to fetch'); },
    async () => new Response(null, { status: 503 }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://example.com' } }),
  ]) {
    const status = await checkAsrConnection({ fetchImpl });
    assert.equal(status.state, 'unreachable');
    assert.equal(status.ready, false);
    assert.match(status.message, /暂时/);
    assert.match(status.message, /稍后/);
  }
});

test('the deadline aborts a pending request and reports unreachable', async () => {
  let aborted = false;
  const status = await checkAsrConnection({ timeoutMs: 15, fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Timeout', 'AbortError')); }, { once: true });
  }) });
  assert.equal(aborted, true);
  assert.equal(status.state, 'unreachable');
});

test('caller cancellation skips or aborts fetch and rejects with AbortError instead of a connection error', async () => {
  const already = new AbortController();
  already.abort();
  await assert.rejects(() => checkAsrConnection({ signal: already.signal, fetchImpl: async () => { assert.fail('Cancelled check must not fetch'); } }), { name: 'AbortError' });

  const controller = new AbortController();
  let requestSignal;
  const pending = checkAsrConnection({ signal: controller.signal, fetchImpl: (_url, init) => {
    requestSignal = init.signal;
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  } });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requestSignal.aborted, true);
});

test('cancellation while receiving health also cannot show a late ready state', async () => {
  const controller = new AbortController();
  const pending = checkAsrConnection({ signal: controller.signal, fetchImpl: async (_url, init) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      controller.abort();
    }),
  }) });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('a configuration override cannot send the health request to a remote or unrelated endpoint', async () => {
  for (const endpoint of [
    'https://127.0.0.1:8765/health', 'http://example.com/health', 'http://127.0.0.1:8765/stream',
    'http://user:pass@127.0.0.1:8765/health', 'http://127.0.0.1:8765/health?x=1', 'http://127.0.0.1:8765/health#x',
  ]) {
    const status = await checkAsrConnection({ endpoint, fetchImpl: async () => { assert.fail('Invalid endpoint must not fetch'); } });
    assert.equal(status.state, 'unreachable');
  }
  for (const endpoint of ['/api/speech/health']) {
    const status = await checkAsrConnection({ endpoint, fetchImpl: respond(healthy) });
    assert.equal(status.state, 'ready');
  }
});


test('public visitors use same-origin speech, never their own computer',async()=>{
 globalThis.window={location:{origin:'https://drawing.example'}};
 try{
  const ready=await checkAsrConnection({fetchImpl:async(url)=>{assert.equal(url,'https://drawing.example/api/speech/health');return Response.json(healthy);}});
  assert.equal(ready.ready,true);
  const forbidden=await checkAsrConnection({endpoint:'https://evil.example/health',fetchImpl:()=>{throw new Error('must not contact third party');}});
  assert.equal(forbidden.ready,false);
 }finally{delete globalThis.window;}
});
