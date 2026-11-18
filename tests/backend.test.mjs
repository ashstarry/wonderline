import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

// Compile the pure validation module without introducing a test-only runtime dependency.
const temporary = new URL('../.sites-runtime/backend-validation-test.mjs', import.meta.url);
await mkdir(new URL('../.sites-runtime/', import.meta.url), { recursive: true });
const source = await readFile(new URL('../lib/scene-validation.ts', import.meta.url), 'utf8');
await writeFile(temporary, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { applyScenePatch, sceneSchema, drawingMarkSchema, isSafeDrawingPath, imagineInputSchema, patchJsonSchema, compactPatchJsonSchema, efficientPatchJsonSchema, inspectWav, paperViewportSchema } = await import(temporary.href);
const asrTemporary = new URL('../.sites-runtime/local-asr-test.mjs', import.meta.url);
const asrSource = await readFile(new URL('../lib/local-asr.ts', import.meta.url), 'utf8');
await writeFile(asrTemporary, ts.transpileModule(asrSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { validateLocalAsrUrl, getLocalAsrStatus, transcribeLocally, LocalAsrError } = await import(asrTemporary.href);
const limiterTemporary = new URL('../.sites-runtime/request-rate-limit-test.mjs', import.meta.url);
const limiterSource = await readFile(new URL('../lib/request-rate-limit.ts', import.meta.url), 'utf8');
await writeFile(limiterTemporary, ts.transpileModule(limiterSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { createRequestLimiter } = await import(limiterTemporary.href);
const modelTemporary = new URL('../.sites-runtime/drawing-model-test.mjs', import.meta.url);
const modelSource = await readFile(new URL('../lib/drawing-model.ts', import.meta.url), 'utf8');
await writeFile(modelTemporary, ts.transpileModule(modelSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
const { DEFAULT_DRAWING_MODEL, getDrawingModelSettings } = await import(modelTemporary.href);
after(() => Promise.all([unlink(temporary), unlink(asrTemporary), unlink(limiterTemporary), unlink(modelTemporary)]));

test('the selected Luna drawing model uses low reasoning and preserves earlier Gemini configurations', () => {
  assert.equal(DEFAULT_DRAWING_MODEL, 'openai/gpt-6-luna');
  const chosen = getDrawingModelSettings(DEFAULT_DRAWING_MODEL);
  assert.equal(chosen.schema, 'efficient');
  assert.equal(chosen.compactMarks, false);
  assert.equal(chosen.request.reasoning.effort, 'low');
  assert.deepEqual(chosen.request.provider.only, ['openai']);
  assert.equal(chosen.request.provider.require_parameters, true);
  assert.equal(chosen.request.provider.allow_fallbacks, false);
  const flash = getDrawingModelSettings('google/gemini-3.8-flash');
  assert.equal(flash.schema, 'compact');
  assert.equal(flash.compactMarks, true);
  assert.equal(flash.request.reasoning.effort, 'low');
  assert.deepEqual(flash.request.provider, { only: ['google-ai-studio'], require_parameters: true, allow_fallbacks: false });
  const earlier = getDrawingModelSettings('google/gemini-3.6-flash');
  assert.equal(earlier.compactMarks, true);
  assert.equal(earlier.request.reasoning.effort, 'minimal');
  assert.deepEqual(earlier.request.provider, flash.request.provider);
  assert.equal(getDrawingModelSettings('google/gemini-2.5-flash').compactMarks, true);
  assert.deepEqual(getDrawingModelSettings('google/gemini-3.1-pro-preview').request, {});
  assert.deepEqual(getDrawingModelSettings('another/model'), { schema: 'full', compactMarks: false, request: {} });
});

const scene = { title: '湖边', sky: 'sunset', weather: 'clear', ground: 'lake', objects: [
  { id: 'house', kind: 'house', x: 200, y: 400, scale: 1, color: '#bc9478' },
  { id: 'tree', kind: 'tree', x: 800, y: 430, scale: 1, color: '#739876' },
] };
const blank = () => ({ action: 'update', message: '树往左挪了一点。', title: null, sky: null, weather: null, ground: null, additions: [], updates: [], removals: [] });
const update = (id, fields) => ({ id, x: null, y: null, scale: null, color: null, label: null, ...fields });

test('a local edit preserves every unrelated scene value', () => {
  const patch = { ...blank(), updates: [update('tree', { x: 700 })] };
  const result = applyScenePatch(scene, patch);
  assert.deepEqual(result.scene.objects[0], scene.objects[0]);
  assert.deepEqual(result.scene.objects[1], { ...scene.objects[1], x: 700 });
  assert.equal(scene.objects[1].x, 800);
  assert.equal(result.scene.sky, scene.sky);
  assert.equal(result.scene.title, scene.title);
});

test('changing color preserves the target ID, kind, position and all other objects', () => {
  const result = applyScenePatch(scene, { ...blank(), updates: [update('house', { color: '#789abc' })] });
  assert.deepEqual(result.scene.objects, [
    { ...scene.objects[0], color: '#789abc' },
    scene.objects[1],
  ]);
  assert.equal(result.scene.objects.length, scene.objects.length);
  assert.equal(result.scene.objects[0].id, 'house');
  assert.equal(result.scene.objects[0].kind, 'house');
  assert.equal(scene.objects[0].color, '#bc9478');
  assert.throws(() => applyScenePatch(scene, { ...blank(), updates: [update('house', { kind: 'boat', color: '#789abc' })] }));
});

test('undo and clarify cannot accidentally apply model mutations', () => {
  for (const action of ['undo', 'clarify']) {
    const result = applyScenePatch(scene, { ...blank(), action, sky: 'night', removals: ['house'], object_order: ['tree', 'house'] });
    assert.deepEqual(result.scene, scene);
    assert.equal(result.action, action);
  }
});

test('unknown references, ID collisions, conflicting updates and oversized scenes are rejected', () => {
  assert.throws(() => applyScenePatch(scene, { ...blank(), removals: ['missing'] }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), updates: [update('missing', { x: 30 })] }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), removals: ['tree'], updates: [update('tree', { x: 30 })] }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [{ ...scene.objects[0], label: null }] }));
  assert.throws(() => sceneSchema.parse({ ...scene, objects: Array.from({ length: 41 }, (_, i) => ({ ...scene.objects[0], id: `tree-${i}` })) }));
  assert.throws(() => sceneSchema.parse({ ...scene, objects: [{ ...scene.objects[0], color: 'url(https://example.com)' }] }));
});

test('a new opaque background can be placed behind existing objects without repainting them', () => {
  const background = { id: 'sky-backdrop', kind: 'drawing', x: 0, y: 0, scale: 1, color: '#d5cce5', label: '淡紫色背景', marks: [{ type: 'rect', x: 0, y: 0, w: 1000, h: 640, fill: '#d5cce5', stroke: 'none' }] };
  const result = applyScenePatch(scene, { ...blank(), ground: 'none', additions: [background], object_order: ['sky-backdrop', 'house', 'tree'] });
  assert.deepEqual(result.scene.objects, [background, ...scene.objects]);
  assert.deepEqual(scene.objects.map(object => object.id), ['house', 'tree']);
  assert.equal(result.scene.ground, 'none');
});

test('generation-only layout plans use page coordinates without changing the canonical scene contract', () => {
  const addition = { id: 'new-friend', kind: 'drawing', x: 500, y: 320, scale: 1, color: '#88bbcc', label: '新朋友', marks: [{ type: 'ellipse', x: 0, y: 0, w: 200, h: 100 }] };
  const layout = [{ id: addition.id, bounds: { x: 400, y: 270, width: 200, height: 100 }, anchors: [{ name: 'support', x: 500, y: 370 }] }];
  const base = { ...blank(), additions: [addition] };
  const result = applyScenePatch(scene, { ...base, layout });
  assert.deepEqual(result, applyScenePatch(scene, base));
  assert.equal('layout' in result.scene, false);
  assert.equal('layout' in result.scene.objects.at(-1), false);
  assert.deepEqual(applyScenePatch(scene, { ...blank(), layout: [] }).scene, scene);
  for (const schema of [patchJsonSchema, compactPatchJsonSchema, efficientPatchJsonSchema]) {
    assert.ok(schema.required.includes('layout'));
    assert.ok(Object.keys(schema.properties).indexOf('layout') < Object.keys(schema.properties).indexOf('additions'));
    assert.equal('maxItems' in schema.properties.layout, false);
    assert.equal('maxItems' in schema.properties.layout.items.properties.anchors, false);
  }
});

test('layout rejects off-page bounds or anchors, duplicate references and non-resulting IDs', () => {
  const item = { id: 'house', bounds: { x: 100, y: 200, width: 100, height: 200 }, anchors: [{ name: 'support', x: 150, y: 400 }] };
  for (const layout of [
    [item, item], [{ ...item, id: 'unknown' }],
    [{ ...item, bounds: { ...item.bounds, x: 950 } }],
    [{ ...item, bounds: { ...item.bounds, y: 600 } }],
    [{ ...item, bounds: { ...item.bounds, width: -1 } }],
    [{ ...item, anchors: [{ name: 'outside', x: 1001, y: 400 }] }],
    [{ ...item, anchors: [{ name: 'outside', x: 150, y: -1 }] }],
    [{ ...item, anchors: [item.anchors[0], item.anchors[0]] }],
    [{ ...item, anchors: [{ name: ' ', x: 100, y: 100 }] }],
    [{ ...item, script: 'not a geometry field' }],
  ]) assert.throws(() => applyScenePatch(scene, { ...blank(), layout }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), removals: ['house'], layout: [item] }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), layout: [{ ...item, anchors: Array.from({ length: 9 }, (_, i) => ({ name: `point-${i}`, x: 150, y: 400 })) }] }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), layout: Array.from({ length: 41 }, (_, i) => ({ ...item, id: `object-${i}` })) }));
});

test('cropped drawings may have off-page origins while layout coordinates and local geometry remain bounded', () => {
  const planet = { id: 'planet', kind: 'drawing', x: 500, y: 700, scale: 1, color: '#bb99cc', label: '星球上弧', marks: [{ type: 'ellipse', x: 0, y: 0, w: 800, h: 800 }] };
  const layout = [{ id: planet.id, bounds: { x: 100, y: 300, width: 800, height: 340 }, anchors: [{ name: 'top-surface', x: 500, y: 300 }] }];
  const result = applyScenePatch(scene, { ...blank(), additions: [planet], layout });
  assert.deepEqual(result.scene.objects.at(-1), planet);
  assert.doesNotThrow(() => imagineInputSchema.parse({ text: '在它上面画一个朋友', scene: result.scene }));
  assert.equal(applyScenePatch(result.scene, { ...blank(), updates: [update('planet', { x: -100 })] }).scene.objects.at(-1).x, -100);
  for (const origin of [{ x: -10001 }, { x: 10001 }, { y: -10001 }, { y: 10001 }]) {
    assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [{ ...planet, ...origin }] }));
    assert.throws(() => applyScenePatch(result.scene, { ...blank(), updates: [update('planet', origin)] }));
  }
  assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [planet], layout: [{ ...layout[0], anchors: [{ name: 'origin-is-not-visible', x: 500, y: 700 }] }] }));
  assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [{ ...planet, marks: [{ ...planet.marks[0], x: 10001 }] }] }));
});

test('ordering addresses the final set after additions, updates and removals', () => {
  const added = { id: 'moon-new', kind: 'moon', x: 500, y: 100, scale: 1, color: '#ffffcc', label: null };
  const patch = { ...blank(), removals: ['house'], updates: [update('tree', { color: '#8866aa' })], additions: [added], object_order: ['moon-new', 'tree'] };
  const result = applyScenePatch(scene, patch);
  assert.deepEqual(result.scene.objects.map(object => object.id), ['moon-new', 'tree']);
  assert.deepEqual(result.scene.objects[1], { ...scene.objects[1], color: '#8866aa' });
  for (const order of [['tree'], ['tree', 'tree'], ['tree', 'unknown'], ['house', 'tree']]) {
    assert.throws(() => applyScenePatch(scene, { ...patch, object_order: order }));
  }
  assert.deepEqual(applyScenePatch(scene, { ...blank(), object_order: null }).scene, scene);
  assert.deepEqual(applyScenePatch(scene, blank()).scene, scene);
  assert.deepEqual(applyScenePatch(scene, { ...blank(), removals: ['house', 'tree'], object_order: [] }).scene.objects, []);
  assert.ok(patchJsonSchema.required.includes('object_order'));
});

const whaleMarks = [
  { type: 'path', d: 'M -95 -60 C -95 -130 65 -130 80 -65 C 60 -5 -70 -5 -95 -60 Z', fill: '#719dae', stroke: '#425b69', strokeWidth: 2 },
  { type: 'path', d: 'M 75 -65 Q 110 -100 100 -115 Q 135 -90 110 -60 Q 140 -40 110 -25 Q 100 -45 75 -65 Z', fill: '#719dae', stroke: '#425b69' },
  { type: 'ellipse', x: -60, y: -68, w: 8, h: 8, fill: '#343d48', stroke: 'none' },
  { type: 'path', d: 'M -73 -50 Q -53 -39 -35 -49', fill: 'none', stroke: '#425b69', strokeWidth: 2 },
];

test('compact provider output omits null fields without weakening local shape or SVG validation', () => {
  const markSchema = compactPatchJsonSchema.properties.additions.items.properties.marks.anyOf[0].items;
  assert.deepEqual(markSchema.required, ['type']);
  assert.equal(markSchema.additionalProperties, false);
  assert.equal(markSchema.properties.d.type, 'string');
  assert.ok(patchJsonSchema.properties.additions.items.properties.marks.anyOf[0].items.required.includes('d'));
  const custom = { id: 'sketch', kind: 'drawing', x: 500, y: 320, scale: 1, color: '#719dae', label: '自由画', marks: whaleMarks };
  assert.deepEqual(applyScenePatch(scene, { ...blank(), additions: [custom] }).scene.objects.at(-1), custom);
  for (const mark of [
    { type: 'path' },
    { type: 'ellipse', x: 0, y: 0, w: 20 },
    { type: 'line', x: 0, y: 0, x2: 10, y2: 10, onclick: 'alert(1)' },
    { type: 'path', d: 'M 0 0 L 20 20', fill: 'url(https://example.com)' },
  ]) assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [{ ...custom, marks: [mark] }] }));
});

test('strict shape branches preserve every geometry type with nullable styles and no unrelated fields', () => {
  const types = [
    { type: 'path', d: 'M 0 0 Q 10 -20 30 0', fill: 'none', stroke: '#445566', strokeWidth: 2 },
    { type: 'ellipse', x: 0, y: 0, w: 30, h: 20 },
    { type: 'rect', x: -10, y: -10, w: 20, h: 20 },
    { type: 'line', x: 0, y: 0, x2: 20, y2: 10, fill: 'none' },
    { type: 'text', x: 0, y: 20, text: '你好' },
  ];
  const branches = efficientPatchJsonSchema.properties.additions.items.properties.marks.anyOf[0].items.anyOf;
  const styles = ['fill', 'stroke', 'strokeWidth', 'opacity'];
  assert.equal(branches.length, types.length);
  assert.deepEqual(efficientPatchJsonSchema.properties.updates.items.properties.marks.anyOf[0].items.anyOf, branches);
  const providerMarks = types.map(mark => {
    const branch = branches.find(candidate => candidate.properties.type.enum[0] === mark.type);
    const geometry = Object.keys(mark).filter(key => !styles.includes(key));
    assert.equal(branch.additionalProperties, false);
    assert.deepEqual(new Set(Object.keys(branch.properties)), new Set([...geometry, ...styles]));
    assert.deepEqual(new Set(branch.required), new Set(Object.keys(branch.properties)));
    for (const field of geometry) assert.equal('anyOf' in branch.properties[field], false);
    return Object.fromEntries(branch.required.map(field => [field, mark[field] ?? null]));
  });
  const custom = { id: 'all-shapes', kind: 'drawing', x: 500, y: 320, scale: 1, color: '#719dae', label: '五种笔触', marks: providerMarks };
  assert.deepEqual(applyScenePatch(scene, { ...blank(), additions: [custom] }).scene.objects.at(-1).marks, types);
  const keys = Object.keys(efficientPatchJsonSchema.properties);
  assert.ok(keys.indexOf('layout') < keys.indexOf('additions'));
  assert.ok(keys.indexOf('title') > keys.indexOf('updates'));
  assert.ok(keys.indexOf('message') > keys.indexOf('updates'));
  assert.deepEqual(efficientPatchJsonSchema.required, keys);
  for (const mark of [
    { ...providerMarks[0], d: 'M0 0 L10001 0' },
    { ...providerMarks[1], w: null },
    { ...providerMarks[2], onclick: 'bad' },
    { ...providerMarks[3], stroke: 'url(https://example.com)' },
    { ...providerMarks[4], text: '字'.repeat(61) },
  ]) assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [{ ...custom, marks: [mark] }] }));
});

test('a wholly new subject can use a paper scene and custom geometry immediately', () => {
  const result = applyScenePatch(scene, {
    ...blank(), title: '鲸鱼的太空音乐会', sky: 'paper', ground: 'none',
    removals: ['house', 'tree'],
    additions: [{ id: 'space-whale', kind: 'drawing', x: 480, y: 390, scale: 1.8, color: '#719dae', label: '在宇宙弹钢琴的鲸鱼', marks: whaleMarks }],
  });
  assert.equal(result.action, 'update');
  assert.equal(result.scene.sky, 'paper');
  assert.equal(result.scene.ground, 'none');
  assert.equal(result.scene.objects[0].kind, 'drawing');
  assert.deepEqual(result.scene.objects[0].marks, whaleMarks);
});

test('custom detail edits preserve geometry and unrelated objects, normalizing unused null fields', () => {
  const withDrawing = { ...scene, objects: [...scene.objects, { id: 'whale', kind: 'drawing', x: 500, y: 300, scale: 1, color: '#719dae', label: '鲸鱼', marks: whaleMarks }] };
  const blueEye = whaleMarks.map((mark, index) => index === 2 ? { ...mark, fill: '#1266aa', d: null, text: null } : mark);
  const result = applyScenePatch(withDrawing, { ...blank(), updates: [update('whale', { marks: blueEye })] });
  assert.deepEqual(result.scene.objects.slice(0, 2), scene.objects);
  assert.equal(result.scene.objects[2].id, 'whale');
  assert.equal(result.scene.objects[2].x, 500);
  assert.deepEqual(result.scene.objects[2].marks[0], whaleMarks[0]);
  assert.deepEqual(result.scene.objects[2].marks[2], { ...whaleMarks[2], fill: '#1266aa' });
  assert.equal(withDrawing.objects[2].marks[2].fill, '#343d48');
});

test('drawing validation rejects scripts, external resources, invalid paths and excessive geometry', () => {
  for (const path of ['M0 0 L10 10Z', 'm -.5 .5 q 20 -30 40 0', 'M 0 0 A 20 10 45 0 1 30 30 Z']) assert.equal(isSafeDrawingPath(path), true, path);
  for (const path of ['<script>alert(1)</script>', 'M0 0;alert(1)', 'M0 0 L10001 0', 'M0 0 LNaN 10', 'M0 0 L2', 'M0 0 A10 10 0 7 1 20 20', 'M0 0L1e999 0']) assert.equal(isSafeDrawingPath(path), false, path);
  assert.throws(() => drawingMarkSchema.parse({ type: 'path', d: 'M0 0L10 10', onload: 'alert(1)' }));
  assert.throws(() => drawingMarkSchema.parse({ type: 'image', href: 'https://example.com/image.svg' }));
  assert.throws(() => drawingMarkSchema.parse({ type: 'ellipse', x: 0, y: 0, w: 10, h: 10, fill: 'url(https://example.com)' }));
  assert.throws(() => drawingMarkSchema.parse({ type: 'line', x: 0, y: 0, x2: 10 }));
  assert.doesNotThrow(() => drawingMarkSchema.parse({ type: 'text', x: 0, y: 0, text: '<script>plain text</script>' }));
  const drawing = { id: 'whale', kind: 'drawing', x: 500, y: 300, scale: 1, color: '#719dae', marks: whaleMarks };
  assert.throws(() => sceneSchema.parse({ ...scene, objects: [{ ...drawing, marks: [] }] }));
  assert.throws(() => sceneSchema.parse({ ...scene, objects: [{ ...drawing, marks: Array(101).fill(whaleMarks[0]) }] }));
  assert.throws(() => sceneSchema.parse({ ...scene, objects: Array.from({ length: 5 }, (_, index) => ({ ...drawing, id: `whale-${index}`, marks: Array(91).fill(whaleMarks[0]) })) }));
});

test('short recent instruction history is available for pronouns without unbounded context', () => {
  assert.doesNotThrow(() => imagineInputSchema.parse({ text: '把它变成粉色', recent: ['画一条鲸鱼'], scene }));
  assert.throws(() => imagineInputSchema.parse({ text: '把它变成粉色', recent: Array(6).fill('画一条鲸鱼'), scene }));
});

test('clarification answers retain the original instruction and bounded question', () => {
  const clarification = { instruction: '把那只猫改成紫色', question: '你想改左边还是右边的猫？' };
  const parsed = imagineInputSchema.parse({ text: '左边那个', scene, clarification });
  assert.equal(parsed.text, '左边那个');
  assert.deepEqual(parsed.clarification, clarification);
  for (const invalid of [
    { question: clarification.question },
    { instruction: clarification.instruction },
    { ...clarification, instruction: ' '.repeat(3) },
    { ...clarification, instruction: '字'.repeat(601) },
    { ...clarification, question: '问'.repeat(201) },
    { ...clarification, injected: 'unknown field' },
  ]) assert.throws(() => imagineInputSchema.parse({ text: '左边那个', scene, clarification: invalid }));
});

test('live mode is explicit and omitted mode preserves the existing finish behavior', () => {
  assert.equal(imagineInputSchema.parse({ text: '画一个新世界', scene }).mode, 'finish');
  for (const mode of ['live', 'finish']) {
    const parsed = imagineInputSchema.parse({ text: '把它的帽子变紫色', scene, mode, recent: ['画一个太空探险家'], clarification: { instruction: '把帽子改成紫色', question: '哪一个角色的帽子？' } });
    assert.equal(parsed.mode, mode);
    assert.equal(parsed.clarification.instruction, '把帽子改成紫色');
    assert.deepEqual(parsed.scene, scene);
  }
  for (const mode of ['unlimited', '', null, 1]) assert.throws(() => imagineInputSchema.parse({ text: '画一个新世界', scene, mode }));
});

test('authenticated drawing and batch transcription have independent per-user minute limits', () => {
  const limiter = createRequestLimiter();
  for (let i = 0; i < 48; i++) assert.equal(limiter.allow('user-a', 'imagine', 10_000), true);
  assert.equal(limiter.allow('user-a', 'imagine', 10_000), false);
  for (let i = 0; i < 24; i++) assert.equal(limiter.allow('user-a', 'transcribe', 10_000), true);
  assert.equal(limiter.allow('user-a', 'transcribe', 10_000), false);
  assert.equal(limiter.allow('user-a', 'imagine', 10_001), false);
  assert.equal(limiter.allow('user-b', 'imagine', 10_001), true);
  assert.equal(limiter.allow('user-b', 'transcribe', 10_001), true);
});

test('the rolling minute releases only expired capacity and invalid identities or buckets fail closed', () => {
  const limiter = createRequestLimiter();
  assert.equal(limiter.allow('', 'imagine', 0), false);
  assert.equal(limiter.allow('user-a', 'unlimited', 0), false);
  assert.equal(limiter.allow('user-a', '__proto__', 0), false);
  assert.equal(limiter.allow('user-a', 'imagine', 0), true);
  for (let i = 0; i < 47; i++) assert.equal(limiter.allow('user-a', 'imagine', 1000), true);
  assert.equal(limiter.allow('user-a', 'imagine', 59_999), false);
  assert.equal(limiter.allow('user-a', 'imagine', 60_000), true);
  assert.equal(limiter.allow('user-a', 'imagine', 60_000), false);
  assert.equal(limiter.allow('user-a', 'imagine', 61_000), true);
});

function wav(seconds, amplitude = 1000) {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * seconds);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(amplitude * Math.sin(i / 8)), 44 + i * 2);
  return bytes;
}

test('PCM duration is measured from actual WAV bytes, and silence avoids ASR', () => {
  assert.deepEqual(inspectWav(wav(2).toString('base64')), { duration: 2, silent: false });
  assert.deepEqual(inspectWav(wav(2, 0).toString('base64')), { duration: 2, silent: true });
  assert.throws(() => inspectWav(wav(31).toString('base64')));
  const forged = wav(1); forged.writeUInt32LE(1, 28);
  assert.throws(() => inspectWav(forged.toString('base64')));
  assert.throws(() => inspectWav(wav(1).subarray(0, 70).toString('base64')));
});

test('ASR accepts only loopback service origins and rejects paths or credentials', () => {
  assert.equal(validateLocalAsrUrl('http://127.0.0.1:8765'), 'http://127.0.0.1:8765');
  assert.equal(validateLocalAsrUrl('http://localhost:8765/'), 'http://localhost:8765');
  assert.equal(validateLocalAsrUrl('http://[::1]:8765'), 'http://[::1]:8765');
  for (const value of ['https://openrouter.ai', 'http://127.0.0.1.evil.test', 'http://192.168.1.5:8765', 'http://user:password@localhost:8765', 'http://localhost:8765/path', 'http://localhost:8765/?target=remote']) {
    assert.throws(() => validateLocalAsrUrl(value), LocalAsrError);
  }
});

test('local ASR sends WAV only to loopback, with redirects disabled and no cloud credentials', async () => {
  const requests = [];
  const text = await transcribeLocally('audio-base64', undefined, { baseUrl: 'http://127.0.0.1:8765', fetchImpl: async (url, init) => {
    requests.push({ url, init });
    return Response.json({ text: '  在湖边加一只小猫。 ', elapsedMs: 600, model: 'local-qwen' });
  } });
  assert.equal(text, '在湖边加一只小猫。');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://127.0.0.1:8765/transcribe');
  assert.equal(requests[0].init.redirect, 'manual');
  assert.equal(new Headers(requests[0].init.headers).has('Authorization'), false);
  assert.deepEqual(JSON.parse(requests[0].init.body), { audio: 'audio-base64', format: 'wav' });
});

test('local ASR fails closed without retrying a cloud service', async () => {
  const requests = [];
  await assert.rejects(transcribeLocally('audio', undefined, { baseUrl: 'http://127.0.0.1:8765', fetchImpl: async url => {
    requests.push(url);
    throw new Error('Connection refused');
  } }), error => error instanceof LocalAsrError && error.status === 503 && error.message.includes('Qwen3-ASR'));
  assert.deepEqual(requests, ['http://127.0.0.1:8765/transcribe']);
  let redirects = 0;
  await assert.rejects(transcribeLocally('audio', undefined, { baseUrl: 'http://127.0.0.1:8765', fetchImpl: async () => {
    redirects++;
    return new Response(null, { status: 307, headers: { Location: 'https://example.com/audio' } });
  } }), error => error.status === 503 && error.message.includes('跳转'));
  assert.equal(redirects, 1);
  await assert.rejects(transcribeLocally('audio', undefined, { baseUrl: 'http://127.0.0.1:8765', fetchImpl: async () => Response.json({ text: 'x'.repeat(601) }) }), error => error.status === 502);
  await assert.rejects(transcribeLocally('audio', undefined, { baseUrl: 'http://127.0.0.1:8765', fetchImpl: async () => new Response('not-json') }), error => error.status === 502);
});

test('status reports local readiness and stops unavailable health checks after one second', async () => {
  const ready = await getLocalAsrStatus({ baseUrl: 'http://localhost:8765', fetchImpl: async () => Response.json({ ready: true, model: 'Qwen3-ASR-test' }) });
  assert.deepEqual(ready, { provider: 'local-qwen', ready: true, model: 'Qwen3-ASR-test' });
  const start = Date.now();
  const unavailable = await getLocalAsrStatus({ baseUrl: 'http://localhost:8765', fetchImpl: (_url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.provider, 'local-qwen');
  assert.ok(Date.now() - start < 1800, 'Health checks must not block the hosted page');
});


test('saved paper and request viewport accept expanded sheets while retaining bounded geometry', () => {
  const paper = { x: -400, y: -120, width: 1800, height: 880 };
  assert.deepEqual(sceneSchema.parse({ ...scene, paper }).paper, paper);
  assert.deepEqual(imagineInputSchema.parse({ text: '边上画一朵花', scene: { ...scene, paper }, canvasViewport: paper }).canvasViewport, paper);
  for (const bad of [
    { ...paper, x: -10001 }, { ...paper, y: -10001 }, { ...paper, x: 9999 },
    { ...paper, width: 0 }, { ...paper, width: 20001 }, { ...paper, height: Infinity },
    { ...paper, x: NaN }, { ...paper, extra: 1 },
  ]) assert.equal(paperViewportSchema.safeParse(bad).success, false);
  assert.ok(isSafeDrawingPath('M-10000 -10000L10000 10000'));
  assert.doesNotThrow(() => drawingMarkSchema.parse({ type: 'rect', x: -10000, y: -10000, w: 20000, h: 20000 }));
  assert.throws(() => drawingMarkSchema.parse({ type: 'rect', x: -10000, y: -10000, w: 20001, h: 20000 }));
});

test('layout uses the saved full sheet, preserves paper on patches, and rejects its actual outer edge', () => {
  const paper = { x: -400, y: -120, width: 1800, height: 880 };
  const extended = { ...scene, paper };
  const addition = { id: 'margin-friend', kind: 'drawing', x: -250, y: 640, scale: 1, color: '#55aacc', label: '边上的朋友', marks: [{ type: 'ellipse', x: 0, y: 0, w: 80, h: 60 }] };
  const layout = [{ id: addition.id, bounds: { x: -290, y: 610, width: 80, height: 60 }, anchors: [{ name: 'foot', x: -250, y: 670 }] }];
  const result = applyScenePatch(extended, { ...blank(), additions: [addition], layout });
  assert.deepEqual(result.scene.paper, paper);
  assert.equal(result.scene.objects.at(-1).x, -250);
  assert.throws(() => applyScenePatch(scene, { ...blank(), additions: [addition], layout }));
  assert.throws(() => applyScenePatch(extended, { ...blank(), additions: [addition], layout: [{ ...layout[0], anchors: [{ name: 'foot', x: 1401, y: 670 }] }] }));
  assert.throws(() => applyScenePatch(extended, { ...blank(), additions: [addition], layout: [{ ...layout[0], bounds: { x: 1350, y: 610, width: 100, height: 60 } }] }));
});
