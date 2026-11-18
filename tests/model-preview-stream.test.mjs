import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const directory = await mkdtemp(new URL('../.sites-runtime/model-stream-', import.meta.url));
const modules = ['studio-origin','content-filter','speech-host','drawing-text','scene-validation', 'scene-stream', 'openrouter-stream', 'imagine-stream', 'request-rate-limit', 'drawing-model','diagnostics','research-recording', 'drawing-prompt', 'openrouter', 'drawing-failure', 'canvas-context', 'canvas-context-validation', 'scene-paint-order', 'paper-viewport','mercury/codec','mercury/contract','mercury/geometry','object-transform','object-pose','eraser','eraser-shape','freehand','mercury/json-prefix','mercury/preview','mercury/prompt','mercury/response','mercury/route'];
for (const name of modules) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  if(name.includes('/'))await mkdir(`${directory}/mercury`,{recursive:true});
  await writeFile(`${directory}/${name}.mjs`, compiled
    .replace(/from '(\.\.?\/[^']+)'/g, "from '$1.mjs'")
    .replace("from '../app/chatgpt-auth.mjs'", "from './auth-stub.mjs'"));
}
await writeFile(`${directory}/auth-stub.mjs`, 'export async function getChatGPTUser() { return globalThis.__modelStreamTestUser; }');
const routeSource = await readFile(new URL('../app/api/imagine/route.ts', import.meta.url), 'utf8');
await writeFile(`${directory}/route.mjs`, ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from '\.\.\/\.\.\/\.\.\/lib\/([^']+)'/g, "from './$1.mjs'"));
const compiledRoute=await readFile(`${directory}/route.mjs`,'utf8');await writeFile(`${directory}/route.mjs`,compiledRoute.replace("import('../../../lib/mercury/route')","import('./mercury/route.mjs')"));
const { ScenePreviewBuilder } = await import(pathToFileURL(`${directory}/scene-stream.mjs`));
const { applyScenePatch, sceneSchema, patchJsonSchema, compactPatchJsonSchema, efficientPatchJsonSchema } = await import(pathToFileURL(`${directory}/scene-validation.mjs`));
const { readOpenRouterStream, ModelStreamError } = await import(pathToFileURL(`${directory}/openrouter-stream.mjs`));
const { imagineStreamResponse } = await import(pathToFileURL(`${directory}/imagine-stream.mjs`));
const { POST } = await import(pathToFileURL(`${directory}/route.mjs`));
const { openRouterStreamingCompletion, ApiError, errorResponse } = await import(pathToFileURL(`${directory}/openrouter.mjs`));
const { drawingFailureKind } = await import(pathToFileURL(`${directory}/drawing-failure.mjs`));
const { SYSTEM_PROMPT } = await import(pathToFileURL(`${directory}/drawing-prompt.mjs`));
const { canvasSceneKey } = await import(pathToFileURL(`${directory}/canvas-context.mjs`));
after(() => rm(directory, { recursive: true, force: true }));

const scene = { title: '留在纸上的朋友', sky: 'paper', ground: 'none', weather: 'clear', objects: [
  { id: 'old-tree', kind: 'tree', x: 110, y: 470, scale: 1, color: '#558855' },
] };
const marks = [
  { type: 'path', d: 'M -100 0 Q 0 -140 100 0 Z', fill: '#88bbcc' },
  { type: 'ellipse', x: 30, y: -30, w: 12, h: 12, fill: '#223344', stroke: 'none' },
  { type: 'text', x: -20, y: 20, text: '你好「{星星}」\\"' },
];
const drawing = { id: 'new-friend', kind: 'drawing', x: 500, y: 320, scale: 1, color: '#88bbcc', label: '朋友', marks };
const patch = (fields = {}) => ({ action: 'update', message: '新的朋友来了。', title: null, sky: null, weather: null, ground: null, object_order: null, additions: [drawing], updates: [], removals: [], ...fields });
const update = (fields = {}) => ({ id: 'old-tree', x: null, y: null, scale: null, color: null, label: null, ...fields });
const encoded = JSON.stringify(patch());
const firstMarkEnd = encoded.indexOf(JSON.stringify(marks[0])) + JSON.stringify(marks[0]).length;
const encoder = new TextEncoder();
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function efficientPatch(value) {
  const branches = efficientPatchJsonSchema.properties.additions.items.properties.marks.anyOf[0].items.anyOf;
  const additions = value.additions.map(object => ({ ...object, marks: object.marks?.map(mark => {
    const branch = branches.find(candidate => candidate.properties.type.enum[0] === mark.type);
    return Object.fromEntries(branch.required.map(field => [field, mark[field] ?? null]));
  }) ?? null }));
  const patchValue = { ...value, layout: value.layout ?? [], additions };
  return Object.fromEntries(efficientPatchJsonSchema.required.map(field => [field, patchValue[field]]));
}

test('a complete safe mark previews before its object closes; an unfinished path never appears', () => {
  const original = structuredClone(scene);
  const builder = new ScenePreviewBuilder(scene);
  assert.equal(builder.push(encoded.slice(0, firstMarkEnd - 1)), undefined);
  const first = builder.push(encoded.slice(firstMarkEnd - 1, firstMarkEnd));
  assert.equal(first.objects.length, 2);
  assert.deepEqual(first.objects[1].marks, [marks[0]]);
  assert.deepEqual(first.objects[0], scene.objects[0]);
  const next = builder.push(encoded.slice(firstMarkEnd));
  assert.deepEqual(next.objects[1].marks, marks);
  assert.deepEqual(builder.finish(), applyScenePatch(scene, patch()));
  assert.deepEqual(scene, original);
});

test('efficient output previews a safe first mark before title and message without committing incomplete results', () => {
  const value = efficientPatch(patch({ title: '新的朋友' }));
  const text = JSON.stringify(value);
  const mark = value.additions[0].marks[0];
  const boundary = text.indexOf(JSON.stringify(mark)) + JSON.stringify(mark).length;
  assert.ok(boundary < text.indexOf('"title"'));
  assert.ok(boundary < text.indexOf('"message"'));
  const builder = new ScenePreviewBuilder(scene);
  const preview = builder.push(text.slice(0, boundary));
  assert.deepEqual(preview.objects[1].marks, [marks[0]]);
  assert.equal(preview.title, scene.title);
  assert.throws(() => builder.finish());
  builder.push(text.slice(boundary));
  assert.deepEqual(builder.finish(), applyScenePatch(scene, value));
  for (const action of ['undo', 'clarify']) {
    const cancelled = new ScenePreviewBuilder(scene);
    const encodedAction = JSON.stringify(efficientPatch(patch({ action })));
    for (const character of encodedAction) assert.equal(cancelled.push(character), undefined);
    assert.deepEqual(cancelled.finish().scene, scene);
  }
});

test('long English metadata never blocks a valid first stroke or rejects final geometry', () => {
  const label = 'A smiling princess with a small crown and a flowing pink party gown';
  const value = efficientPatch(patch({additions:[{...drawing,label}],title:'A beautiful story '.repeat(8),message:'Here is your drawing. '.repeat(12)}));
  const text = JSON.stringify(value), firstMark = JSON.stringify(value.additions[0].marks[0]);
  const boundary = text.indexOf(firstMark) + firstMark.length;
  const builder = new ScenePreviewBuilder(scene);
  const first = builder.push(text.slice(0,boundary));
  assert.deepEqual(first.objects[1].marks,[marks[0]]);
  assert.ok(first.objects[1].label.length <= 40);
  builder.push(text.slice(boundary));
  const result = builder.finish();
  assert.deepEqual(result.scene.objects[0],scene.objects[0]);
  assert.deepEqual(result.scene.objects[1].marks,marks);
  assert.ok(result.scene.title.length <= 60 && result.message.length <= 160);
  const edited = applyScenePatch(scene,patch({additions:[],updates:[update({label})]}));
  assert.ok(edited.scene.objects[0].label.length <= 40);
  assert.throws(()=>applyScenePatch(scene,patch({additions:[{...drawing,label,marks:[{type:'path',d:'<script>bad</script>'}]}]})));
  assert.equal(sceneSchema.safeParse({...scene,objects:[{...drawing,label}]}).success,false,'saved/input data stays strict');
  assert.throws(()=>applyScenePatch(scene,patch({additions:[{...drawing,label,unknown:'bad'}]})));
});

test('every character and every two-part boundary produces the same final validated scene', () => {
  const builder = new ScenePreviewBuilder(scene);
  let previews = 0;
  for (const character of encoded) {
    const next = builder.push(character);
    if (next) { sceneSchema.parse(next); previews++; }
  }
  assert.ok(previews >= marks.length);
  const expected = applyScenePatch(scene, patch());
  assert.deepEqual(builder.finish(), expected);
  for (let boundary = 0; boundary <= encoded.length; boundary++) {
    const split = new ScenePreviewBuilder(scene);
    for (const part of [encoded.slice(0, boundary), encoded.slice(boundary)]) {
      const next = split.push(part);
      if (next) sceneSchema.parse(next);
    }
    assert.deepEqual(split.finish(), expected, `boundary ${boundary}`);
  }
});

test('invalid metadata and unsafe marks cannot enter previews and fail final validation', () => {
  for (const changes of [
    { x: 10001 }, { color: 'url(https://example.com)' },
    { marks: [{ type: 'path', d: '<script>alert(1)</script>' }] },
    { marks: [{ type: 'path', d: 'M0 0L20 20', onload: 'alert(1)' }] },
  ]) {
    const builder = new ScenePreviewBuilder(scene);
    const text = JSON.stringify(patch({ additions: [{ ...drawing, ...changes }] }));
    for (const character of text) {
      const next = builder.push(character);
      assert.equal(next, undefined);
    }
    assert.throws(() => builder.finish());
  }
});

test('later invalid output keeps only already safe previews; old objects remain intact', () => {
  const builder = new ScenePreviewBuilder(scene);
  const bad = JSON.stringify(patch({ additions: [{ ...drawing, marks: [marks[0], { type: 'path', d: 'M0 0L10001 0' }] }] }));
  const observed = [];
  for (const character of bad) {
    const next = builder.push(character);
    if (next) observed.push(next);
  }
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0].objects[1].marks, [marks[0]]);
  assert.deepEqual(observed[0].objects[0], scene.objects[0]);
  assert.throws(() => builder.finish());
});

test('complete local edits preview atomically and removals wait until the validated final result', () => {
  const builder = new ScenePreviewBuilder(scene);
  const text = JSON.stringify(patch({ additions: [], updates: [update({ color: '#aa66bb' })] }));
  const end = text.indexOf(JSON.stringify(update({ color: '#aa66bb' }))) + JSON.stringify(update({ color: '#aa66bb' })).length;
  assert.equal(builder.push(text.slice(0, end - 1)), undefined);
  assert.equal(builder.push(text.slice(end - 1, end)).objects[0].color, '#aa66bb');
  builder.push(text.slice(end));
  assert.equal(builder.finish().scene.objects[0].color, '#aa66bb');
  const removal = new ScenePreviewBuilder(scene);
  const preview = removal.push(JSON.stringify(patch({ removals: ['old-tree'] })));
  assert.deepEqual(preview.objects.map(object => object.id), ['old-tree', 'new-friend']);
  assert.deepEqual(removal.finish().scene.objects.map(object => object.id), ['new-friend']);
});

test('only a complete valid ordering can preview; undo and clarification never preview mutations', () => {
  const ordered = patch({ object_order: ['new-friend', 'old-tree'] });
  const builder = new ScenePreviewBuilder(scene);
  assert.deepEqual(builder.push(JSON.stringify(ordered)).objects.map(object => object.id), ['new-friend', 'old-tree']);
  assert.deepEqual(builder.finish(), applyScenePatch(scene, ordered));
  const invalid = new ScenePreviewBuilder(scene);
  assert.equal(invalid.push(JSON.stringify(patch({ object_order: ['new-friend'] }))), undefined);
  assert.throws(() => invalid.finish());
  for (const action of ['undo', 'clarify']) {
    const other = new ScenePreviewBuilder(scene);
    assert.equal(other.push(JSON.stringify(patch({ action, removals: ['old-tree'] }))), undefined);
    assert.deepEqual(other.finish().scene, scene);
  }
});

test('malformed, ambiguous, unbounded or incomplete JSON fails closed', () => {
  for (const text of [
    '{"action":"update","action":"undo"}',
    '{"action":"update",}', '[1,]', '{"action"\u00a0:"update"}',
    encoded + '{}', encoded.slice(0, -1), '{"a":' + '['.repeat(25),
    ' '.repeat(120001),
  ]) {
    const builder = new ScenePreviewBuilder(scene);
    assert.throws(() => { builder.push(text); builder.finish(); });
  }
});

test('a streamed background stays behind existing characters from its first mark through commit', () => {
  const second = { ...scene.objects[0], id: 'second-character', x: 700 };
  const base = { ...scene, objects: [...scene.objects, second] };
  const background = { ...drawing, id: 'meadow', label: '草地' };
  const cloud = { ...drawing, id: 'cloud', label: '云' };
  const value = efficientPatch(patch({ additions: [background, cloud], object_order: ['meadow', 'cloud', 'old-tree', 'second-character'] }));
  const builder = new ScenePreviewBuilder(base);
  const previews = [];
  for (const character of JSON.stringify(value)) {
    const preview = builder.push(character);
    if (preview) previews.push(preview);
  }
  assert.ok(previews.length >= marks.length * 2, 'safe marks still stream individually');
  for (const preview of [...previews, builder.finish().scene]) {
    assert.deepEqual(preview.objects.slice(-2), base.objects, 'old geometry and depth remain exactly intact');
    assert.equal(preview.objects[0].id, 'meadow');
  }
  assert.equal(previews[0].objects[0].marks.length, 1, 'first stroke does not wait for the entire background');
});

test('late provider ordering cannot temporarily place a new background in front of old art', () => {
  const value = patch({ object_order: ['new-friend', 'old-tree'] });
  const { object_order, ...rest } = value;
  const text = JSON.stringify({ ...rest, object_order });
  const boundary = text.indexOf(',"object_order"');
  const builder = new ScenePreviewBuilder(scene);
  assert.equal(builder.push(text.slice(0, boundary)), undefined);
  assert.deepEqual(builder.push(text.slice(boundary)).objects.map(object => object.id), object_order);
  assert.deepEqual(builder.finish(), applyScenePatch(scene, value));
});

const ignoredPatch = (fields = {}) => patch({ action: 'ignore', message: '我在听，接着说你想画什么吧。', layout: [], additions: [], ...fields });

test('ignore is a validated no-op, never a provisional drawing or a contradictory mutation', () => {
  const value = ignoredPatch();
  const result = applyScenePatch(scene, value);
  assert.equal(result.scene, scene);
  assert.equal(result.action, 'ignore');
  for (const schema of [patchJsonSchema, compactPatchJsonSchema, efficientPatchJsonSchema]) assert.ok(schema.properties.action.enum.includes('ignore'));
  const builder = new ScenePreviewBuilder(scene);
  const encodedIgnore = JSON.stringify(value);
  for (const character of encodedIgnore.slice(0, -1)) assert.equal(builder.push(character), undefined);
  assert.throws(() => builder.finish());
  assert.equal(builder.push(encodedIgnore.slice(-1)), undefined);
  assert.deepEqual(builder.finish(), result);
  for (const mutation of [
    { title: '不能改标题' }, { sky: 'day' }, { ground: 'meadow' }, { weather: 'rain' },
    { additions: [drawing] }, { updates: [update({ color: '#ff0000' })] }, { removals: ['old-tree'] },
    { object_order: ['old-tree'] },
    { layout: [{ id: 'old-tree', bounds: { x: 10, y: 20, width: 30, height: 40 }, anchors: [] }] },
  ]) {
    const contradictory = new ScenePreviewBuilder(scene);
    assert.equal(contradictory.push(JSON.stringify(ignoredPatch(mutation))), undefined);
    assert.throws(() => contradictory.finish());
    assert.throws(() => applyScenePatch(scene, ignoredPatch(mutation)));
  }
});

function streamBytes(bytes, width = bytes.length) {
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width)); controller.close(); } });
}
function sse(content, reason = null) { return `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: reason }] })}\n\n`; }
async function readAll(body, options) { let result = ''; for await (const part of readOpenRouterStream(body, options)) result += part; return result; }

test('SSE accepts comments, multline data, split CRLF and single-byte UTF-8 chunks', async () => {
  const multiline = `data: {"choices":[\r\ndata: {"index":0,"delta":{"content":"小猫"},"finish_reason":null}]}\r\n\r\n`;
  const wire = ': keep-alive\r\n\r\n' + multiline + sse('画画').replaceAll('\n', '\r\n') + sse(null, 'stop') + sse(null, 'stop') + 'data: {"choices":[],"usage":{"total_tokens":20}}\n\ndata: [DONE]\n\n';
  assert.equal(await readAll(streamBytes(encoder.encode(wire), 1)), '小猫画画');
});

test('SSE requires successful finish and DONE rather than treating an abrupt disconnect as complete', async () => {
  for (const wire of [sse('{}'), sse('{}') + sse(null, 'stop'), sse('{}') + 'data: [DONE]\n\n']) {
    await assert.rejects(readAll(streamBytes(encoder.encode(wire))), error => error instanceof ModelStreamError && error.kind === 'incomplete');
  }
  await assert.rejects(readAll(streamBytes(encoder.encode(sse('{}') + sse(null, 'length')))), error => error.kind === 'length');
  await assert.rejects(readAll(streamBytes(encoder.encode(sse('{}') + 'data: {"error":{"message":"secret provider error"}}\n\n'))), error => error.kind === 'upstream' && !error.message.includes('secret'));
});

test('SSE enforces wire/content size limits and rejects malformed events', async () => {
  const wire = encoder.encode(sse('abcd') + sse(null, 'stop') + 'data: [DONE]\n\n');
  await assert.rejects(readAll(streamBytes(wire), { maxContentChars: 3 }), error => error.kind === 'size');
  await assert.rejects(readAll(streamBytes(wire), { maxWireBytes: 4 }), error => error.kind === 'size');
  for (const text of ['data: {bad}\n\n', sse({ bad: true }), sse('{}', 'content_filter'), sse('{}', 'stop') + sse('more')]) {
    await assert.rejects(readAll(streamBytes(encoder.encode(text))), ModelStreamError);
  }
  await assert.rejects(readAll(streamBytes(Uint8Array.from([255]))), TypeError);
});

test('aborting an upstream SSE read cancels the pending body reader', async () => {
  const controller = new AbortController();
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const reading = readAll(body, { signal: controller.signal });
  controller.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

async function events(response) {
  const text = await response.text();
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
}

test('ignored noise streams only a final unchanged scene; invalid ignore streams an error', async () => {
  for (const valid of [true, false]) {
    const value = ignoredPatch(valid ? {} : { additions: [drawing] });
    const output = await events(imagineStreamResponse(scene, async function* () {
      for (const character of JSON.stringify(value)) yield character;
    }));
    assert.equal(output.length, 1);
    assert.equal(output[0].type, valid ? 'complete' : 'error');
    if (valid) assert.deepEqual(output[0].result, applyScenePatch(scene, value));
    else assert.equal(output[0].failureKind, 'turn');
  }
});

test('NDJSON delivers a validated mark before generation completes, then a final commit', async () => {
  const gate = deferred();
  let continued = false;
  const response = imagineStreamResponse(scene, async function* () {
    yield encoded.slice(0, firstMarkEnd);
    await gate.promise;
    continued = true;
    yield encoded.slice(firstMarkEnd);
  });
  assert.match(response.headers.get('content-type'), /^application\/x-ndjson/);
  const reader = response.body.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal(first.type, 'preview');
  assert.deepEqual(first.scene.objects[1].marks, [marks[0]]);
  assert.equal(continued, false);
  gate.resolve();
  let remaining = '';
  while (true) { const result = await reader.read(); if (result.done) break; remaining += new TextDecoder().decode(result.value); }
  const tail = remaining.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(tail.at(-1).type, 'complete');
  assert.deepEqual(tail.at(-1).result, applyScenePatch(scene, patch()));
});

test('final patch failures and provider failures send error without complete, preserving the original source', async () => {
  const before = structuredClone(scene);
  for (const providerFailure of [false, true]) {
    const bad = JSON.stringify(patch({ removals: ['missing'] }));
    const diagnostics = [];
    const response = imagineStreamResponse(scene, async function* () {
      yield bad.slice(0, firstMarkEnd);
      if (providerFailure) throw new Error('sensitive upstream body');
      yield bad.slice(firstMarkEnd);
    }, { onFailure: diagnostic => diagnostics.push(diagnostic) });
    const output = await events(response);
    assert.equal(output[0].type, 'preview');
    assert.equal(output.at(-1).type, 'error');
    assert.equal(output.at(-1).failureKind, 'turn');
    assert.equal(output.some(event => event.type === 'complete'), false);
    assert.equal(JSON.stringify(output).includes('sensitive'), false);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].stage, providerFailure ? 'stream' : 'final_validation');
    assert.ok(diagnostics[0].previews >= 1);
    assert.equal(diagnostics[0].reason, providerFailure ? 'upstream_or_unknown' : 'invalid_references');
    assert.equal(JSON.stringify(diagnostics).includes('sensitive'), false);
    assert.deepEqual(scene, before);
  }
});

test('advisory layout cannot fail otherwise valid completed art; unsafe reservations are not forwarded', async () => {
  const layout = [{ id: drawing.id, bounds: { x: 400, y: 180, width: 200, height: 160 }, anchors: [{ name: 'support', x: 500, y: 320 }] }];
  for (const plan of [layout, [{...layout[0],id:'missing'}], [{...layout[0],bounds:{x:400,y:600,width:200,height:160}}], [{...layout[0],bounds:{x:400,y:180,width:-1,height:160}}], {wrong:'shape'}]) {
    const value = patch({ layout: plan });
    const response = imagineStreamResponse(scene, async function* () { yield JSON.stringify(value); });
    const output = await events(response);
    assert.equal(output[0].type, 'preview');
    assert.equal('layout' in output[0].scene, false);
    assert.equal(output.at(-1).type, 'complete');
    assert.deepEqual(output.at(-1).result, applyScenePatch(scene, patch()));
    if (!Array.isArray(plan) || plan[0]?.bounds.y===600 || plan[0]?.bounds.width===-1) assert.equal(output[0].layout,undefined);
  }
});

test('ignoring advisory layout never relaxes geometry, references, order or complete-JSON checks',()=>{
 const badPlan=[{id:'missing',bounds:{x:1,y:600,width:10,height:100},anchors:[]}];
 const invalid=[
  patch({layout:badPlan,additions:[{...drawing,marks:[{type:'path',d:'<script>bad</script>'}]}]}),
  patch({layout:badPlan,removals:['missing']}),
  patch({layout:badPlan,object_order:[drawing.id]}),
  patch({layout:badPlan,action:'ignore',additions:[]}),
 ];
 for(const value of invalid){const builder=new ScenePreviewBuilder(scene);builder.push(JSON.stringify(value));assert.throws(()=>builder.finish());}
 const unfinished=new ScenePreviewBuilder(scene);unfinished.push(JSON.stringify(patch({layout:badPlan})).slice(0,-1));assert.throws(()=>unfinished.finish());
});

test('response cancellation aborts generation without a late commit; already-aborted requests never start', async () => {
  const done = deferred();
  let upstreamSignal;
  const response = imagineStreamResponse(scene, async function* (signal) {
    upstreamSignal = signal;
    try {
      yield encoded.slice(0, firstMarkEnd);
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }); });
      yield encoded.slice(firstMarkEnd);
    } finally { done.resolve(); }
  });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  await done.promise;
  assert.equal(upstreamSignal.aborted, true);
  const abort = new AbortController(); abort.abort();
  let started = false;
  assert.deepEqual(await events(imagineStreamResponse(scene, async function* () { started = true; yield encoded; }, { signal: abort.signal })), []);
  assert.equal(started, false);
});

test('the authenticated route defaults to Luna with strict shape streaming marks and preserves Gemini overrides and JSON compatibility', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL, user: globalThis.__modelStreamTestUser };
  process.env.OPENROUTER_API_KEY = 'unit-test-no-real-credential';
  delete process.env.OPENROUTER_MODEL;
  globalThis.__modelStreamTestUser = { userId: 'stream-route-test' };
  const calls = [];
  const efficientValue = efficientPatch(patch());
  const efficientEncoded = JSON.stringify(efficientValue);
  const efficientFirstMark = JSON.stringify(efficientValue.additions[0].marks[0]);
  const efficientFirstMarkEnd = efficientEncoded.indexOf(efficientFirstMark) + efficientFirstMark.length;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    const efficient = body.model === 'openai/gpt-6-luna';
    const content = efficient ? efficientEncoded : encoded;
    const boundary = efficient ? efficientFirstMarkEnd : firstMarkEnd;
    if (!body.stream) return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
    return new Response(sse(content.slice(0, boundary)) + sse(content.slice(boundary), 'stop') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const request = (accept, canvasContext, language = 'en') => new Request('http://localhost/api/imagine', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept }, body: JSON.stringify({ text: '画一个朋友', scene, mode: 'live', language, ...(canvasContext ? { canvasContext } : {}) }) });
  const measuredContext = { version: 1, scene_key: canvasSceneKey(scene), paint_order: ['old-tree'], objects: [{ id: 'old-tree', bounds: [40, 300, 140, 180] }], marks_truncated: false };
  try {
    const streamed = await POST(request('application/x-ndjson', measuredContext));
    const output = await events(streamed);
    assert.equal(streamed.status, 200);
    assert.equal(output[0].type, 'preview');
    assert.deepEqual(output[0].scene.objects[1].marks, [marks[0]]);
    assert.equal(output.at(-1).type, 'complete');
    assert.deepEqual(output.at(-1).result, applyScenePatch(scene, patch({additions:[{...drawing,marks:marks.filter(mark=>mark.type!=='text')}]})));
    assert.equal(calls[0].body.stream, true);
    assert.equal(calls[0].body.max_tokens, 9000);
    assert.equal(calls[0].body.model, 'openai/gpt-6-luna');
    assert.equal(calls[0].body.reasoning.effort, 'low');
    assert.deepEqual(calls[0].body.provider, { only: ['openai'], require_parameters: true, allow_fallbacks: false });
    assert.equal(Object.hasOwn(calls[0].body, 'temperature'), false);
    assert.equal(calls[0].body.response_format.json_schema.strict, true);
    assert.deepEqual(calls[0].body.response_format.json_schema.schema, efficientPatchJsonSchema);
    assert.match(calls[0].body.messages[0].content, /action,sky,weather,ground,object_order,layout,additions,updates,removals,title,message/);
    assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content).current_scene, scene);
    assert.equal(JSON.parse(calls[0].body.messages[1].content).reply_language, 'English');
    assert.equal(JSON.parse(calls[0].body.messages[1].content).instruction, '画一个朋友');
    assert.deepEqual(JSON.parse(calls[0].body.messages[1].content).canvas_context.objects, [{ id: 'old-tree', transform: [110, 470, 1], geometry_bounds: [40, 300, 140, 180] }]);
    // Stale/unknown optional geometry never aborts the actual drawing route.
    const ordinary = await POST(request('application/json', { ...measuredContext, paint_order: ['missing'] }, 'zh'));
    assert.match(ordinary.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await ordinary.json(), applyScenePatch(scene, patch({additions:[{...drawing,marks:marks.filter(mark=>mark.type!=='text')}]})));
    assert.equal(calls[1].body.stream, false);
    assert.equal(calls[1].body.model, 'openai/gpt-6-luna');
    assert.equal(JSON.parse(calls[1].body.messages[1].content).reply_language, '简体中文');
    assert.equal('canvas_context' in JSON.parse(calls[1].body.messages[1].content), false);
    assert.equal(Object.hasOwn(calls[1].body, 'temperature'), false);
    assert.deepEqual(calls[1].body.response_format.json_schema.schema, efficientPatchJsonSchema);
    process.env.OPENROUTER_MODEL = 'google/gemini-3.6-flash';
    const overridden = await events(await POST(request('application/x-ndjson')));
    assert.equal(overridden.at(-1).type, 'complete');
    assert.deepEqual(overridden.at(-1).result, applyScenePatch(scene, patch({additions:[{...drawing,marks:marks.filter(mark=>mark.type!=='text')}]})));
    assert.equal(calls[2].body.model, 'google/gemini-3.6-flash');
    assert.equal(calls[2].body.reasoning.effort, 'minimal');
    assert.deepEqual(calls[2].body.provider, { only: ['google-ai-studio'], require_parameters: true, allow_fallbacks: false });
    assert.equal(calls[2].body.temperature, 0.2);
    assert.deepEqual(calls[2].body.response_format.json_schema.schema, compactPatchJsonSchema);
    delete process.env.OPENROUTER_MODEL;
    globalThis.__modelStreamTestUser = null;
    assert.equal((await POST(request('application/x-ndjson'))).status, 401);
    assert.equal(calls.length, 3);
    globalThis.__modelStreamTestUser = { userId: 'stream-route-test' };
    process.env.OPENROUTER_API_KEY = '';
    const missing = await POST(request('application/x-ndjson'));
    assert.equal(missing.status, 503);
    assert.match(missing.headers.get('content-type'), /^application\/json/);
    assert.equal(calls.length, 3);
    process.env.OPENROUTER_API_KEY = 'unit-test-no-real-credential';
    const unfinished = ['Draw a princess in the middle.'];
    const recovered = await POST(new Request('http://localhost/api/imagine', {method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({text:'There are some goldfish swimming around her.',scene,mode:'live',language:'en',unfinished})}));
    assert.equal((await events(recovered)).at(-1).type,'complete');
    assert.deepEqual(JSON.parse(calls.at(-1).body.messages[1].content).unfinished_instructions,unfinished);
    assert.match(calls.at(-1).body.messages[0].content,/unfinished_instructions/);
    assert.ok(!calls[0].body.messages[0].content.includes('unfinished_instructions'),'normal turns carry no recovery prompt');
    assert.equal(calls.length,4,'recovery uses the next request, not an extra model call');
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.__modelStreamTestUser = previous.user;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.key;
    if (previous.model === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = previous.model;
  }
});

test('the explicit model experiment is isolated and never changes the ordinary configured model', async () => {
  const previous = {fetch:globalThis.fetch,key:process.env.OPENROUTER_API_KEY,model:process.env.OPENROUTER_MODEL,user:globalThis.__modelStreamTestUser};
  process.env.OPENROUTER_API_KEY='unit-test-no-real-credential';
  process.env.OPENROUTER_MODEL='openai/gpt-6-luna';
  globalThis.__modelStreamTestUser={userId:'experiment-test'};
  const calls=[]; const encodedPatch=JSON.stringify(efficientPatch(patch()));
  globalThis.fetch=async (_url,options)=>{const b=JSON.parse(options.body);calls.push(b);const content=b.model==='inception/mercury-3'?JSON.stringify({...patch({action:'clarify',additions:[],layout:[]}),mark_edits:[],layer_moves:[]}):encodedPatch;return new Response(sse(content,'stop')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});};
  const request=url=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({text:'Draw a dog',scene,mode:'live'})});
  try {
    for(const url of ['http://localhost/api/imagine','http://localhost/api/imagine?draw-lab=other','http://localhost/api/imagine?draw-lab=mercury3','http://localhost/api/imagine']){
      const result=await events(await POST(request(url)));assert.equal(result.at(-1).type,'complete');
    }
    assert.deepEqual(calls.map(value=>value.model),['openai/gpt-6-luna','openai/gpt-6-luna','inception/mercury-3','openai/gpt-6-luna']);
    assert.equal(calls[2].reasoning.enabled,false);
    assert.notDeepEqual(calls[2].response_format.json_schema.schema,efficientPatchJsonSchema);
    assert.notEqual(calls[2].messages[0].content,calls[0].messages[0].content);
    assert.deepEqual(calls[3],calls[0]);
  } finally {
    globalThis.fetch=previous.fetch;globalThis.__modelStreamTestUser=previous.user;
    if(previous.key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=previous.key;
    if(previous.model===undefined)delete process.env.OPENROUTER_MODEL;else process.env.OPENROUTER_MODEL=previous.model;
  }
});

test('upstream cancellation is propagated and length errors are sanitized after real token parsing', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENROUTER_API_KEY };
  process.env.OPENROUTER_API_KEY = 'unit-test-no-real-credential';
  try {
    let providerSignal;
    let readerCancelled = false;
    globalThis.fetch = async (_url, options) => {
      providerSignal = options.signal;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(sse('{'))); }, cancel() { readerCancelled = true; } }));
    };
    const abort = new AbortController();
    const generator = openRouterStreamingCompletion({}, abort.signal);
    assert.equal((await generator.next()).value, '{');
    const waiting = generator.next();
    abort.abort();
    await assert.rejects(waiting, error => error.name === 'AbortError');
    assert.equal(providerSignal.aborted, true);
    assert.equal(readerCancelled, true);
    globalThis.fetch = async () => new Response(sse('{}') + sse(null, 'length'));
    await assert.rejects(async () => { for await (const _ of openRouterStreamingCompletion({})) { /* consume */ } }, error => error.status === 502 && error.message.includes('分两句话'));
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.key;
  }
});

test('HTTP failures log only bounded transport metadata and never provider bodies or credentials', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENROUTER_API_KEY, warn: console.warn };
  process.env.OPENROUTER_API_KEY = 'unit-test-no-real-credential';
  const logs = [];
  console.warn = (...args) => logs.push(args);
  try {
    globalThis.fetch = async () => new Response('sensitive provider body and private scene', { status: 400, headers: { 'x-request-id': 'req-safe-123' } });
    await assert.rejects(async () => { for await (const _ of openRouterStreamingCompletion({ messages: [{ content: 'private prompt' }] })) { /* consume */ } }, error => error.status === 502);
    assert.deepEqual(logs, [['OpenRouter request failed', { status: 400, requestId: 'req-safe-123' }]]);
    globalThis.fetch = async () => new Response('sensitive upstream failure', { status: 500, headers: { 'x-request-id': 'Bearer do-not-log-this' } });
    await assert.rejects(async () => { for await (const _ of openRouterStreamingCompletion({})) { /* consume */ } });
    assert.deepEqual(logs[1], ['OpenRouter request failed', { status: 500 }]);
    assert.equal(/sensitive|private|credential|do-not-log/.test(JSON.stringify(logs)), false);
  } finally {
    globalThis.fetch = previous.fetch; console.warn = previous.warn;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.key;
  }
});

test('streamed error metadata distinguishes a skipped drawing from a service outage without leaking upstream data', async () => {
  for (const error of [new ApiError(502, '描述太复杂', 'turn'), new ApiError(503, '连接配置需要检查'), new TypeError('private transport detail')]) {
    const output = await events(imagineStreamResponse(scene, async function* () { throw error; }, {
      errorMessage: value => value instanceof ApiError ? value.message : '连接暂时中断',
      errorKind: drawingFailureKind,
    }));
    assert.equal(output.length, 1);
    assert.equal(output[0].type, 'error');
    assert.equal(output[0].failureKind, drawingFailureKind(error));
    assert.equal(JSON.stringify(output).includes('private'), false);
  }
  for (const [status, kind] of [[400, 'turn'], [401, 'service'], [403, 'service'], [429, 'service'], [503, 'service'], [504, 'service']]) {
    const output = errorResponse(new ApiError(status, '安全的提示'));
    assert.equal(output.status, status);
    assert.deepEqual(await output.json(), { error: '安全的提示', failureKind: kind });
  }
});

test('imagine route keeps malformed output turn-local while provider/network/config failures remain service failures', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENROUTER_API_KEY, user: globalThis.__modelStreamTestUser, warn: console.warn };
  process.env.OPENROUTER_API_KEY = 'unit-test-no-real-credential';
  globalThis.__modelStreamTestUser = { userId: 'failure-kind-route-test' };
  console.warn = () => {};
  const request = accept => new Request('http://localhost/api/imagine', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept }, body: JSON.stringify({ text: '画一个朋友', scene, mode: 'live' }) });
  try {
    for (const accept of ['application/json', 'application/x-ndjson']) {
      const outputFor = async () => {
        const result = await POST(request(accept));
        return result.headers.get('content-type').includes('application/x-ndjson') ? (await events(result)).at(-1) : result.json();
      };
      globalThis.fetch = async () => accept === 'application/json'
        ? Response.json({ choices: [{ message: { content: '{broken}' }, finish_reason: 'stop' }] })
        : new Response(sse('{broken}', 'stop') + 'data: [DONE]\n\n');
      assert.equal((await outputFor()).failureKind, 'turn');
      globalThis.fetch = async () => accept === 'application/json'
        ? Response.json({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] })
        : new Response(sse('{}') + sse(null, 'length'));
      assert.equal((await outputFor()).failureKind, 'turn');
      globalThis.fetch = async () => accept === 'application/json'
        ? Response.json({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] })
        : new Response(sse(null, 'content_filter'));
      assert.equal((await outputFor()).failureKind, 'turn');
      for (const status of [401, 402, 429, 500]) {
        globalThis.fetch = async () => new Response('private provider body', { status });
        const output = await outputFor();
        assert.equal(output.failureKind, 'service');
        assert.equal(JSON.stringify(output).includes('private'), false);
      }
      globalThis.fetch = async () => { throw new TypeError('private network detail'); };
      assert.equal((await outputFor()).failureKind, 'service');
    }
    process.env.OPENROUTER_API_KEY = '';
    assert.equal((await (await POST(request('application/x-ndjson'))).json()).failureKind, 'service');
  } finally {
    globalThis.fetch = previous.fetch; globalThis.__modelStreamTestUser = previous.user; console.warn = previous.warn;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.key;
  }
});

test('clarification prompt treats a standalone new idea as replacement and only combines actual answers', () => {
  assert.match(SYSTEM_PROMPT, /clarification 只是可选的上一轮澄清上下文，绝不是必须完成的待办/);
  assert.match(SYSTEM_PROMPT, /只有确实回答或延续时，才结合 clarification.instruction 与 question/);
  assert.match(SYSTEM_PROMPT, /放下旧要求，只执行新意图/);
  assert.match(SYSTEM_PROMPT, /不得顺便执行旧修改/);
});

test('the same drawing request classifies only wholly unintelligible noise and protects imagination and mixed speech', () => {
  assert.match(SYSTEM_PROMPT, /只有整段当前 instruction 都是无法理解的乱音/);
  assert.match(SYSTEM_PROMPT, /儿童幻想、超现实组合、抽象情绪、自创词、夸张、不符合现实、口吃、自我纠正和没说完但有意义的话都不是乱音/);
  assert.match(SYSTEM_PROMPT, /任何部分含有有意义的绘画内容，就按有意义部分画，绝不能把混合整段判为ignore/);
  assert.match(SYSTEM_PROMPT, /不确定时也clarify/);
  assert.match(SYSTEM_PROMPT, /不用于模型生成失败、技术错误或服务问题/);
});

test('both route transports accept a no-op ignore from one model call and reject contradictory or duplicate actions', async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENROUTER_API_KEY, user: globalThis.__modelStreamTestUser };
  process.env.OPENROUTER_API_KEY = 'unit-test-no-real-credential';
  globalThis.__modelStreamTestUser = { userId: 'ignore-route-test' };
  const value = efficientPatch(ignoredPatch());
  const encodedIgnore = JSON.stringify(value);
  let calls = 0;
  try {
    for (const accept of ['application/json', 'application/x-ndjson']) {
      const request = () => new Request('http://localhost/api/imagine', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept },
        body: JSON.stringify({ text: '噜叭嘶啦嗯哒', scene, mode: 'live' }),
      });
      for (const [content, valid] of [
        [encodedIgnore, true],
        [JSON.stringify(efficientPatch(ignoredPatch({ removals: ['old-tree'] }))), false],
        [encodedIgnore.replace('"action":"ignore"', '"action":"update","action":"ignore"'), false],
        [encodedIgnore.slice(0, -1), false],
      ]) {
        globalThis.fetch = async (_url, options) => {
          calls++;
          assert.equal(JSON.parse(options.body).messages[1].content.includes('噜叭嘶啦嗯哒'), true);
          return accept === 'application/json'
            ? Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] })
            : new Response(sse(content, 'stop') + 'data: [DONE]\n\n');
        };
        const before = calls;
        const output = await POST(request());
        if (accept === 'application/json') {
          const payload = await output.json();
          if (valid) assert.deepEqual(payload, applyScenePatch(scene, ignoredPatch()));
          else { assert.equal(output.status, 502); assert.equal(payload.failureKind, 'turn'); assert.equal(payload.action, undefined); }
        } else {
          const payload = await events(output);
          assert.equal(payload.length, 1, 'no provisional drawings for noise');
          assert.equal(payload[0].type, valid ? 'complete' : 'error');
          if (valid) assert.deepEqual(payload[0].result, applyScenePatch(scene, ignoredPatch()));
          else assert.equal(payload[0].failureKind, 'turn');
        }
        assert.equal(calls, before + 1, 'classification shares the drawing request');
      }
    }
  } finally {
    globalThis.fetch = previous.fetch; globalThis.__modelStreamTestUser = previous.user;
    if (previous.key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previous.key;
  }
});

test('complete validated reservations travel with early marks, before the whole model response completes',async()=>{
 const layout=[{id:'new-friend',bounds:{x:400,y:180,width:200,height:180},anchors:[{name:'head',x:500,y:200}]}];
 const value={action:'update',message:'画朋友',title:null,sky:null,ground:null,weather:null,object_order:null,layout,additions:[drawing],updates:[],removals:[]};
 const text=JSON.stringify(value),end=text.indexOf(JSON.stringify(marks[0]))+JSON.stringify(marks[0]).length;
 const builder=new ScenePreviewBuilder(scene);const before=text.indexOf(JSON.stringify(layout))+JSON.stringify(layout).length-1;
 builder.push(text.slice(0,before));assert.equal(builder.layout(),undefined);
 const preview=builder.push(text.slice(before,end));assert.ok(preview);assert.deepEqual(builder.layout(),layout);
 const response=imagineStreamResponse(scene,async function*(){yield text.slice(0,end);yield text.slice(end);});
 const frames=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(frames.find(frame=>frame.type==='preview').layout,layout);
 const malformed=new ScenePreviewBuilder(scene);malformed.push(text.replace('"width":200','"width":-200'));assert.equal(malformed.layout(),undefined);
});

test('unsolicited lettering is removed from previews and final art, while intentional lettering is opt-in',()=>{
 const model=JSON.stringify(patch());
 const without=new ScenePreviewBuilder(scene,{allowText:false});const preview=without.push(model);assert.ok(preview);assert.equal(preview.objects.at(-1).marks.some(mark=>mark.type==='text'),false);assert.equal(without.finish().scene.objects.at(-1).marks.some(mark=>mark.type==='text'),false);
 const explicit=new ScenePreviewBuilder(scene,{allowText:true});explicit.push(model);assert.equal(explicit.finish().scene.objects.at(-1).marks.some(mark=>mark.type==='text'),true);
 const textOnly=new ScenePreviewBuilder(scene,{allowText:false});textOnly.push(JSON.stringify(patch({additions:[{...drawing,marks:[marks[2]]}]})));assert.deepEqual(textOnly.finish().scene.objects,scene.objects);
});

test('lettering intent does not treat realism or an event name as a request for labels',async()=>{
 const {requestsLettering,omitUnrequestedText}=await import(pathToFileURL(`${directory}/drawing-text.mjs`));
 for(const phrase of ['世界杯踢足球','画一个写实的小屋','不要文字','不要写字'])assert.equal(requestsLettering(phrase),false);
 for(const phrase of ['在牌子上写你好','写着欢迎的招牌','加字母 A','write hello'])assert.equal(requestsLettering(phrase),true);
 const old={...scene,objects:[drawing]};assert.deepEqual(omitUnrequestedText(old,old),old,'existing chosen lettering is not erased');
});


test('provider generation timeout is a skippable turn, not a service-wide queue pause',async()=>{
 const oldFetch=globalThis.fetch,oldTimeout=globalThis.setTimeout,oldKey=process.env.OPENROUTER_API_KEY;let abortRequest;
 process.env.OPENROUTER_API_KEY='local-test-only';
 globalThis.setTimeout=(callback,delay,...args)=>delay===90_000?oldTimeout(callback,10,...args):oldTimeout(callback,delay,...args);
 globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>{abortRequest=signal;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
 try{await assert.rejects(async()=>{for await(const _ of openRouterStreamingCompletion({})){}},e=>e.status===504&&e.kind==='turn');assert.equal(abortRequest.aborted,true);}
 finally{globalThis.fetch=oldFetch;globalThis.setTimeout=oldTimeout;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;}
});
