import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../.sites-runtime/', import.meta.url);
await mkdir(root, { recursive: true });
const validation = new URL('imagine-stream-validation-test.mjs', root);
const endpoint = new URL('imagine-stream-endpoint-test.mjs', root);
const transport = new URL('imagine-stream-client-test.mjs', root);
const failures = new URL('imagine-stream-failure-test.mjs', root);
const queueFile = new URL('imagine-stream-queue-test.mjs', root);
const options = { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } };
await writeFile(endpoint,ts.transpileModule(await readFile(new URL('../lib/studio-endpoint.ts',import.meta.url),'utf8'),options).outputText);
await writeFile(validation, ts.transpileModule(await readFile(new URL('../lib/scene-validation.ts', import.meta.url), 'utf8'), options).outputText);
await writeFile(failures, ts.transpileModule(await readFile(new URL('../lib/drawing-failure.ts', import.meta.url), 'utf8'), options).outputText);
const compiled = ts.transpileModule(await readFile(new URL('../lib/imagine-stream-client.ts', import.meta.url), 'utf8'), options).outputText.replace("'./studio-endpoint'", "'./imagine-stream-endpoint-test.mjs'").replace("'./scene-validation'", "'./imagine-stream-validation-test.mjs'").replace("'./drawing-failure'", "'./imagine-stream-failure-test.mjs'");
await writeFile(transport, compiled);
const { readImagineResponse, requestImagine } = await import(transport.href);
const { DrawingFailure, drawingFailureKind } = await import(failures.href);
await writeFile(queueFile, ts.transpileModule(await readFile(new URL('../lib/live-painting.ts', import.meta.url), 'utf8'), options).outputText.replace("'./drawing-failure'", "'./imagine-stream-failure-test.mjs'"));
const { LivePaintingQueue } = await import(queueFile.href);
after(() => Promise.all([unlink(endpoint),unlink(validation), unlink(transport), unlink(failures), unlink(queueFile)]));
const empty = { title: '空白纸', sky: 'paper', weather: 'clear', ground: 'none', objects: [] };
const first = { ...empty, title: '鲸鱼的第一笔', objects: [{ id: 'whale', kind: 'drawing', x: 500, y: 350, scale: 1, color: '#778899', marks: [{ type: 'path', d: 'M -50 0 Q 0 -80 50 0', fill: 'none', stroke: '#445566' }] }] };
const finalScene = { ...first, title: '鲸鱼和月亮', objects: [...first.objects, { id: 'moon', kind: 'moon', x: 800, y: 100, scale: 1, color: '#ffeecc' }] };
const result = { scene: finalScene, message: '鲸鱼游来了。', action: 'update' };
const encoder = new TextEncoder();
const wire = event => `${JSON.stringify(event)}\n`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function response(parts, options = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) { if (index < parts.length) controller.enqueue(typeof parts[index] === 'string' ? encoder.encode(parts[index++]) : parts[index++]); else controller.close(); },
    cancel() { options.cancelled?.(); },
  }), { status: options.status || 200, headers: { 'Content-Type': options.type || 'application/x-ndjson; charset=utf-8' } });
}

test('split UTF-8 characters and JSON lines produce complete previews before final commit', async () => {
  const bytes = encoder.encode(wire({ type: 'preview', scene: first }) + wire({ type: 'complete', result }));
  const parts = Array.from(bytes, byte => Uint8Array.of(byte));
  const previews = [];
  const complete = await readImagineResponse(response(parts), { onPreview: scene => previews.push(scene) });
  assert.deepEqual(previews, [first]);
  assert.deepEqual(complete, result);
});

test('an open stream exposes a preview immediately while final history stays untouched', async () => {
  let controller;
  const stream = new ReadableStream({ start(value) { controller = value; } });
  const history = [empty];
  let displayed = empty, completed = false;
  const pending = readImagineResponse(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }), { onPreview: scene => { displayed = scene; } }).then(value => { history.push(value.scene); completed = true; return value; });
  controller.enqueue(encoder.encode(wire({ type: 'preview', scene: first })));
  await tick();
  assert.deepEqual(displayed, first);
  assert.deepEqual(history, [empty]);
  assert.equal(completed, false);
  controller.enqueue(encoder.encode(wire({ type: 'complete', result })));
  assert.deepEqual(await pending, result);
  assert.deepEqual(history, [empty, finalScene]);
});

test('complete is terminal even if the server keeps its body open or sends extra events', async () => {
  let cancelled = 0;
  const previews = [];
  const source = response([wire({ type: 'complete', result }) + wire({ type: 'preview', scene: empty }) + wire({ type: 'complete', result: { ...result, scene: empty } })], { cancelled: () => cancelled++ });
  assert.deepEqual(await readImagineResponse(source, { onPreview: scene => previews.push(scene) }), result);
  assert.deepEqual(previews, []);
  assert.ok(cancelled <= 1);
});

test('a final line without trailing newline is valid; blank lines and CRLF are harmless', async () => {
  const text = '\r\n' + wire({ type: 'preview', scene: first }).replace('\n', '\r\n') + '\n' + JSON.stringify({ type: 'complete', result });
  const previews = [];
  assert.deepEqual(await readImagineResponse(response([text]), { onPreview: scene => previews.push(scene) }), result);
  assert.deepEqual(previews, [first]);
});

test('EOF after provisional strokes is a failure, never a successful scene', async () => {
  let displayed = empty;
  await assert.rejects(readImagineResponse(response([wire({ type: 'preview', scene: first })]), { onPreview: scene => { displayed = scene; } }), /最后结果没有收到/);
  assert.deepEqual(displayed, first); // The page may retain validated progress; no successful final result escaped.
});

test('server error after a preview rejects without a final commit', async () => {
  const previews = [];
  await assert.rejects(readImagineResponse(response([wire({ type: 'preview', scene: first }), wire({ type: 'error', error: '这一笔没有完成' })]), { onPreview: scene => previews.push(scene) }), /这一笔没有完成/);
  assert.deepEqual(previews, [first]);
});

test('cancel after a preview releases a stalled reader and rejects with AbortError', async () => {
  const abort = new AbortController();
  let controller, cancelled = false;
  const stream = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  const previews = [];
  const pending = readImagineResponse(new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }), { signal: abort.signal, onPreview: scene => previews.push(scene) });
  controller.enqueue(encoder.encode(wire({ type: 'preview', scene: first })));
  await tick();
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.deepEqual(previews, [first]);
});

test('cancel from a preview callback prevents a complete in the same network chunk', async () => {
  const abort = new AbortController();
  let previews = 0;
  await assert.rejects(readImagineResponse(response([wire({ type: 'preview', scene: first }) + wire({ type: 'complete', result })]), { signal: abort.signal, onPreview: () => { previews++; abort.abort(); } }), { name: 'AbortError' });
  assert.equal(previews, 1);
});

test('legacy JSON results and HTTP JSON errors stay compatible', async () => {
  assert.deepEqual(await readImagineResponse(response([JSON.stringify(result)], { type: 'application/json' }), { onPreview: () => assert.fail('JSON response cannot create previews') }), result);
  await assert.rejects(readImagineResponse(response([JSON.stringify({ error: '请先登录' })], { status: 401, type: 'application/json' }), { onPreview() {} }), /请先登录/);
});

test('validated ignore is accepted in JSON and NDJSON only with the unchanged request scene', async () => {
  const ignored = { scene: first, message: '我在听，接着说你想画什么吧。', action: 'ignore' };
  for (const type of ['application/json', 'application/x-ndjson']) {
    const body = type === 'application/json' ? JSON.stringify(ignored) : wire({ type: 'complete', result: ignored });
    const original = structuredClone(first);
    assert.deepEqual(await readImagineResponse(response([body], { type }), {
      expectedScene: first,
      onPreview: () => assert.fail('ignored speech cannot draw a preview'),
    }), ignored);
    assert.deepEqual(first, original);
    await assert.rejects(readImagineResponse(response([body], { type }), { expectedScene: empty, onPreview() {} }), error => error.kind === 'turn');
  }
});

test('unfinished, malformed or contradictory ignore responses never authorize skipping speech', async () => {
  const ignored = { scene: first, message: '我在听，接着说你想画什么吧。', action: 'ignore' };
  for (const body of [
    wire({ type: 'preview', scene: first }) + wire({ type: 'complete', result: ignored }),
    wire({ type: 'complete', result: { ...ignored, scene: undefined } }),
    wire({ type: 'complete', result: { ...ignored, action: ['ignore'] } }),
    wire({ type: 'complete', result: { ...ignored, message: '' } }),
    wire({ type: 'complete', result: ignored }).slice(0, -3),
    wire({ type: 'error', action: 'ignore', error: '连接失败', failureKind: 'service' }),
  ]) {
    await assert.rejects(readImagineResponse(response([body]), { expectedScene: first, onPreview() {} }));
  }
});

test('invalid geometry, malformed frames and incomplete final payloads never reach the renderer', async () => {
  const invalid = [
    '{broken}\n',
    wire({ type: 'preview', scene: { ...first, objects: [{ ...first.objects[0], marks: [{ type: 'path', d: '<script>bad</script>' }] }] } }),
    wire({ type: 'complete', result: { message: 'missing scene' } }),
    wire({ type: 'unknown', scene: first }),
    'x'.repeat(600_001),
  ];
  for (const body of invalid) await assert.rejects(readImagineResponse(response([body]), { onPreview: () => assert.fail('invalid scene reached preview') }));
});

test('turn failures are skippable while service errors retain their precise guidance', async () => {
  const cases = [
    { status: 502, payload: { error: '格式未接好', failureKind: 'turn' }, kind: 'turn' },
    { status: 503, payload: { error: '请检查连接配置', failureKind: 'service' }, kind: 'service' },
    { status: 401, payload: { error: '请先登录' }, kind: 'service' },
    { status: 402, payload: { error: '额度不足' }, kind: 'service' },
    { status: 429, payload: { error: '画笔有点忙' }, kind: 'service' },
    { status: 504, payload: { error: '连接超时', failureKind: 'not-a-kind' }, kind: 'service' },
    { status: 400, payload: { error: '描述过长' }, kind: 'turn' },
  ];
  for (const { status, payload, kind } of cases) {
    await assert.rejects(readImagineResponse(response([JSON.stringify(payload)], { status, type: 'application/json' }), { onPreview() {} }), error => error instanceof DrawingFailure && error.kind === kind && error.message === payload.error);
  }
  for (const kind of ['turn', 'service']) {
    await assert.rejects(readImagineResponse(response([wire({ type: 'preview', scene: first }), wire({ type: 'error', error: '保留具体提示', failureKind: kind })]), { onPreview() {} }), error => error instanceof DrawingFailure && error.kind === kind && error.message === '保留具体提示');
  }
});

test('broken transport is service failure; malformed or unfinished model data is a turn failure', async () => {
  const broken = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('sensitive transport details')); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  await assert.rejects(readImagineResponse(broken, { onPreview() {} }), error => error.kind === 'service' && !error.message.includes('sensitive'));
  for (const body of ['{broken}\n', wire({ type: 'preview', scene: first }), Uint8Array.of(255, 10)]) {
    await assert.rejects(readImagineResponse(response([body]), { onPreview() {} }), error => error.kind === 'turn');
  }
  assert.equal(drawingFailureKind(new DrawingFailure('连接中断', 'service')), 'service');
  assert.equal(drawingFailureKind(new Error('unknown')), 'turn');
  assert.equal(drawingFailureKind(new TypeError('fetch failed')), 'service');
});

test('the browser receives valid early layout reservations and drops malformed auxiliary layout',async()=>{
 const layout=[{id:'whale',bounds:{x:100,y:100,width:200,height:150},anchors:[]}],seen=[];
 await readImagineResponse(response([wire({type:'preview',scene:first,layout}),wire({type:'preview',scene:first,layout:[{id:'bad'}]}),wire({type:'complete',result})]),{onPreview:(_scene,layout)=>seen.push(layout)});
 assert.deepEqual(seen,[layout,undefined]);
});


test('a terminal frame commits even if transport cancellation itself never settles', async () => {
  const stream = new ReadableStream({start(c){c.enqueue(encoder.encode(wire({type:'complete',result})));},cancel(){return new Promise(()=>{});}});
  assert.deepEqual(await readImagineResponse(new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}}),{onPreview(){}}),result);
});

test('a stalled goalkeeper request times out once; the queued helicopter proceeds against preserved artwork', async () => {
  const originalFetch=globalThis.fetch,requests=[],commits=[],states=[];let modelSignal;const preserved=structuredClone(first);
  globalThis.fetch=async(_url,request)=>{const input=JSON.parse(request.body);requests.push(input.text);if(input.text==='机器人守门员'){modelSignal=request.signal;return new Promise(()=>{});}return response([wire({type:'complete',result})]);};
  const queue=new LivePaintingQueue(async(text,signal)=>{const next=await requestImagine({text,scene:preserved},{signal,expectedScene:preserved,onPreview(){}},{firstPreviewMs:15,totalMs:100});commits.push(next.scene);},state=>states.push(state));
  try{
    queue.add([{id:'goalie',text:'机器人守门员'}]);await tick();queue.add([{id:'heli',text:'天上有直升机'}]);
    await new Promise(r=>setTimeout(r,50));
    assert.deepEqual(requests,['机器人守门员','天上有直升机'],'distinct next instruction, no automatic retry');
    assert.equal(modelSignal.aborted,true);assert.equal(commits.length,1);assert.deepEqual(preserved,first);
    assert.ok(states.some(s=>s.failedText==='机器人守门员'&&s.failureKind==='turn'&&!s.paused));assert.equal(queue.snapshot().painting,false);assert.equal(queue.snapshot().paused,false);
  }finally{queue.cancel();globalThis.fetch=originalFetch;}
});

test('progress extends idle deadline; a hung stream and a hung header both settle',async()=>{
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(encoder.encode(wire({type:'preview',scene:first})));},cancel(){return new Promise(()=>{});}}),{headers:{'Content-Type':'application/x-ndjson'}});
    const seen=[];await assert.rejects(requestImagine({}, {onPreview:scene=>seen.push(scene)}, {firstPreviewMs:100,idleMs:15,totalMs:200}),e=>e.kind==='turn'&&e.message.includes('等得有点久'));
    assert.equal(seen.length,1);
    globalThis.fetch=async()=>new Promise(()=>{});const cancel=new AbortController();const pending=requestImagine({}, {signal:cancel.signal,onPreview(){}},{firstPreviewMs:100,totalMs:200});cancel.abort();await assert.rejects(pending,{name:'AbortError'});
    let controller;globalThis.fetch=async()=>new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'Content-Type':'application/x-ndjson'}});
    const good=requestImagine({}, {onPreview(){}},{firstPreviewMs:30,idleMs:40,totalMs:200});await tick();controller.enqueue(encoder.encode(wire({type:'preview',scene:first})));await new Promise(r=>setTimeout(r,20));controller.enqueue(encoder.encode(wire({type:'preview',scene:first})));await new Promise(r=>setTimeout(r,20));controller.enqueue(encoder.encode(wire({type:'complete',result})));assert.deepEqual(await good,result);
  }finally{globalThis.fetch=originalFetch;}
});
