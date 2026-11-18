import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const dir = new URL('../.sites-runtime/mirror-drawing/', import.meta.url);
await mkdir(dir, { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText;
for (const name of ['freehand', 'object-pose', 'paper-viewport', 'scene-validation']) {
  const source = await readFile(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  await writeFile(new URL(`${name}.mjs`, dir), compile(source).replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"));
}
const { appendHandStroke, appendMirrorHandStroke, mirrorHandStrokePaths, findHandStroke } = await import(new URL('freehand.mjs', dir));
const { sceneSchema, isSafeDrawingPath } = await import(new URL('scene-validation.mjs', dir));
// Fixed pre-experiment checkpoint: default manual drawing must be byte-for-byte
// equivalent, including hand-layer allocation and existing erasure references.
const legacySource = execFileSync('git', ['show', 'e89449fab53809e0532e7fa947b94a77b906e880:lib/freehand.ts'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8' });
await writeFile(new URL('legacy-freehand.mjs', dir), compile(legacySource).replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"));
const { appendHandStroke: appendLegacyHandStroke } = await import(new URL('legacy-freehand.mjs', dir));
after(() => rm(dir, { recursive: true, force: true }));
const blank = paper => ({ title: 'A little picture', sky: 'paper', weather: 'clear', ground: 'none', ...(paper ? { paper } : {}), objects: [] });
const paths = scene => scene.objects.flatMap(o => o.marks ?? []).map(m => m.d);
const polylines = d => d.split(/(?=M)/).filter(Boolean).map(path => [...path.matchAll(/[ML]([-+]?\d*\.?\d+) ([-+]?\d*\.?\d+)/g)].map(p => ({ x: Number(p[1]), y: Number(p[2]) })));
const line = [{ x: 100, y: 200 }, { x: 220, y: 300 }, { x: 180, y: 400 }];

// Exercise the actual pointer handlers with deterministic hooks/screen transforms.
// Only browser plumbing and the already-covered live eraser are mocked.
await writeFile(new URL('hooks.mjs',dir),`let active;export const setHarness=h=>{active=h;};
export const useRef=v=>{const i=active.index++;return active.slots[i]??=( {current:v} );};
export const useState=v=>{const h=active,i=h.index++;if(!(i in h.slots))h.slots[i]=v;return[h.slots[i],next=>{h.slots[i]=typeof next==='function'?next(h.slots[i]):next;}];};
export const useEffect=(fn,deps)=>{const h=active,i=h.index++,old=h.slots[i];if(!old||!deps||deps.some((v,k)=>!Object.is(v,old.deps[k]))){h.effects.push(()=>{old?.cleanup?.();h.slots[i]={deps,cleanup:fn()};});}};
export const useImperativeHandle=(ref,create)=>{active.index++;if(ref)ref.current=create();};
export const jsx=(type,props,key)=>({type,props:props??{},key});export const jsxs=jsx;
export const useLanguage=()=>({t:s=>s});export const drawingCursor='crosshair';export const ERASER_DIAMETER_PX=30;export const manualEraserWidth=(width,scale)=>width*6/scale;
export const appendErasure=(scene,points,width,id,targets,shape)=>({...scene,testErasure:{points,width,id,targets,shape}});
export class LiveErasurePreview{update(points){this.points=points;}dispose(){}targets(){return[];}}
`);
let layerSource=compile(await readFile(new URL('../components/FreehandLayer.tsx',import.meta.url),'utf8'));
layerSource=layerSource.replace(/from ['"](?:react(?:\/jsx-runtime)?|\.\/LanguageProvider|\.\.\/lib\/eraser|\.\/svg-stroke-playback|\.\/live-erasure-preview|\.\.\/lib\/manual-tools)['"]/g,"from './hooks.mjs'").replace(/from ['"]\.\.\/lib\/(freehand|paper-viewport)['"]/g,"from './$1.mjs'");
await writeFile(new URL('layer.mjs',dir),layerSource);
const {default:FreehandLayer}=await import(new URL('layer.mjs',dir));
const {setHarness}=await import(new URL('hooks.mjs',dir));
function makeHarness(extra={}) {
  const frames=new Map();let frame=0;
  globalThis.requestAnimationFrame=fn=>{frames.set(++frame,fn);return frame;};globalThis.cancelAnimationFrame=id=>frames.delete(id);
  globalThis.DOMPoint=class {constructor(x,y){this.x=x;this.y=y;}matrixTransform(matrix){return{x:this.x*matrix.a+matrix.e,y:this.y*matrix.d+matrix.f};}};
  let capture=null;
  const element={getScreenCTM:()=>({a:2,b:0,d:2,e:40,f:60,inverse(){return{a:.5,d:.5,e:-20,f:-30};}}),setPointerCapture:id=>{capture=id;},hasPointerCapture:id=>capture===id,releasePointerCapture:()=>{capture=null;},parentElement:{querySelector:()=>({})}};
  const commits=[],errors=[],controls={current:null};
  const h={slots:[],index:0,effects:[],props:{scene:blank(),tool:'pen',color:'#123456',width:5,controlsRef:controls,onCommit:(...args)=>commits.push(args),onError:e=>errors.push(e),...extra}};
  function render(){h.index=0;h.effects=[];setHarness(h);h.tree=FreehandLayer(h.props);h.tree.props.ref.current=element;for(const fn of h.effects)fn();return h.tree;}
  function event(x,y,extra={}) {return{clientX:x*2+40,clientY:y*2+60,pointerId:1,isPrimary:true,button:0,currentTarget:element,nativeEvent:{clientX:x*2+40,clientY:y*2+60},preventDefault(){},...extra};}
  function flush(now=16){const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(now);render();}
  function nodes(predicate,node=h.tree){if(!node||typeof node!=='object')return[];const children=[node.props?.children].flat(Infinity);return[...(predicate(node)?[node]:[]),...children.filter(child=>child&&typeof child==='object').flatMap(child=>nodes(predicate,child))];}
  render();return{h,render,event,flush,nodes,commits,errors,controls,frames};
}


// Pure geometry and storage boundaries use the production helpers and schema.
test('default pen matches the pre-experiment checkpoint exactly for 50 seeded strokes across six existing-scene states', () => {
  let seed = 0x5f17cafe;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (let sample = 0; sample < 50; sample++) {
    const paper = [undefined, {x:-300,y:0,width:1600,height:640}, {x:0,y:-300,width:1000,height:1240}, {x:-10.23,y:-5.45,width:1001.66,height:641.66}][sample % 4];
    const viewport = paper ?? {x:0,y:0,width:1000,height:640};
    const count = sample % 10 === 0 ? 1 : sample === 49 ? 1200 : 8 + Math.floor(random()*120);
    const points = Array.from({length:count}, (_, i) => ({
      x: viewport.x - 20 + random() * (viewport.width + 40),
      y: sample % 5 === 0 ? viewport.y + viewport.height/2 : viewport.y - 20 + random() * (viewport.height + 40),
    }));
    const color = `#${Math.floor(random()*0x1000000).toString(16).padStart(6,'0')}`, width = 1 + sample % 24;
    const initial = blank(paper);
    const hand = appendLegacyHandStroke(initial, line, '#123456', 4).objects[0];
    const moved = {...hand, x:73, y:-41, scale:1.3, rotation:25};
    const ai = {id:'tree',kind:'tree',x:500,y:300,scale:1,color:'#345678'};
    const erasures = [{id:'erase-1',paths:['M100 200L150 220'],width:20,targets:[{key:'mark:hand-1:0',x:0,y:0,scale:1}]}];
    const states = [initial,
      {...initial,objects:[hand]},
      {...initial,objects:[moved]},
      {...initial,objects:[hand],erasures},
      {...initial,objects:[hand,ai]},
      {...initial,objects:[{...hand,marks:Array.from({length:99},()=>({...hand.marks[0]}))}]},
    ];
    for (let state = 0; state < states.length; state++) {
      const before = states[state], serialized = JSON.stringify(before);
      const expected = appendLegacyHandStroke(before, points, color, width);
      const actual = appendHandStroke(before, points, color, width);
      assert.equal(JSON.stringify(actual), JSON.stringify(expected), `sample ${sample}, scene ${state}`);
      assert.equal(JSON.stringify(before), serialized, `input mutated in sample ${sample}, scene ${state}`);
      if (before.erasures) assert.equal(actual.erasures, before.erasures);
    }
  }
});

test('mirror pen creates two matched halves in one mark without changing its input', () => {
  const before = blank(), serialized = JSON.stringify(before);
  const next = appendMirrorHandStroke(before, line, '#aabbcc', 7);
  assert.equal(JSON.stringify(before), serialized);
  assert.equal(next.objects.length, 1); assert.equal(next.objects[0].marks.length, 1);
  const [a, b] = polylines(paths(next)[0]);
  assert.deepEqual(a, line); assert.deepEqual(b, line.map(p => ({ x: 1000 - p.x, y: p.y })));
  assert.equal(next.objects[0].marks[0].stroke, '#aabbcc'); assert.equal(next.objects[0].marks[0].strokeWidth, 7);
  assert.ok(sceneSchema.safeParse(next).success);
});

test('the axis follows wide, tall, shifted and fractional paper rather than a hard-coded canvas', () => {
  for (const paper of [{x:-300,y:0,width:1600,height:640},{x:0,y:-300,width:1000,height:1240},{x:150,y:90,width:440,height:700},{x:-10.23,y:-5.45,width:1001.66,height:641.66}]) {
    const next = appendMirrorHandStroke(blank(paper), [{x:paper.x+20,y:paper.y+20},{x:paper.x+80,y:paper.y+80}], '#123456', 4);
    const [a,b] = polylines(paths(next)[0]);
    for(let i=0;i<a.length;i++) {assert.ok(Math.abs(a[i].x+b[i].x-(2*paper.x+paper.width))<.000001); assert.equal(a[i].y,b[i].y);}
    assert.deepEqual(next.paper,paper); assert.ok(sceneSchema.safeParse(next).success);
  }
});

test('axis strokes are painted once; crossing strokes share one painted compound shape', () => {
  const centered = mirrorHandStrokePaths([{x:500,y:10},{x:500,y:600}]);
  assert.deepEqual(centered,['M500 10L500 600']);
  const crossed = mirrorHandStrokePaths([{x:450,y:150},{x:550,y:250}]);
  assert.equal(crossed.length,1); assert.equal(polylines(crossed[0]).length,2);
});

test('a click makes mirrored dots on both edges and a single centered painted shape', () => {
  for(const point of [{x:0,y:0},{x:1000,y:640},{x:500,y:320}]) {
    const next=appendMirrorHandStroke(blank(),[point], '#123456',5);
    assert.equal(paths(next).length,1); assert.ok(sceneSchema.safeParse(next).success);
    const [a,b]=polylines(paths(next)[0]); assert.ok(a.length>=2); assert.equal(a[0].x+b[0].x,1000);
  }
});

test('off-paper samples clamp safely and invalid gestures never mutate a scene', () => {
  const before=blank();
  const result=appendMirrorHandStroke(before,[{x:-100,y:-200},{x:1200,y:900}], '#123456',5);
  assert.ok(sceneSchema.safeParse(result).success);
  for(const args of [[[], '#123456',5],[[{x:NaN,y:1}],'#123456',5],[line,'url(bad)',5],[line,'#123456',25],[Array.from({length:20001},()=>({x:2,y:2})),'#123456',5]]) {
    assert.throws(()=>appendMirrorHandStroke(before,...args)); assert.equal(before.objects.length,0);
  }
});

test('long mirrored scribbles split safely and preserve both final endpoints', () => {
  const points=Array.from({length:1500},(_,i)=>({x:i%900,y:i%2?600:20}));
  const result=mirrorHandStrokePaths(points);
  assert.ok(result.length>1); assert.ok(result.every(p=>p.length<=2500&&isSafeDrawingPath(p)));
  assert.equal(result.reduce((sum,p)=>sum+(p.match(/L/g)??[]).length,0),(points.length-1)*2);
  const [lastA,lastB]=polylines(result.at(-1));
  assert.deepEqual(lastA.at(-1),points.at(-1));assert.deepEqual(lastB.at(-1),{x:1000-points.at(-1).x,y:points.at(-1).y});
});

test('new mirrored ink preserves prior AI art, manual transforms, order and erasures', () => {
  const oldHand={...appendHandStroke(blank(),line,'#123456',5).objects[0],x:10,y:40,scale:1.3,rotation:20};
  const ai={id:'tree',kind:'tree',x:500,y:300,scale:1,color:'#345678'};
  const erasures=[{id:'erase-1',paths:['M10 20L40 20'],width:20,targets:[{key:'legacy:tree',x:500,y:300,scale:1}]}];
  const before={...blank(),objects:[oldHand,ai],erasures};
  const next=appendMirrorHandStroke(before,line,'#aabbcc',4);
  assert.equal(next.objects[0],oldHand);assert.equal(next.objects[1],ai);assert.equal(next.erasures,erasures);
  assert.equal(next.objects[2].id,'hand-2');assert.equal(next.objects[2].x,0);assert.ok(sceneSchema.safeParse(next).success);
});

test('hit testing both halves does not create an invisible bridge between them', () => {
  const next=appendMirrorHandStroke(blank(),[{x:100,y:200},{x:100,y:300}],'#123456',5);
  assert.ok(findHandStroke(next,{x:100,y:250}));assert.ok(findHandStroke(next,{x:900,y:250}));
  assert.equal(findHandStroke(next,{x:500,y:250}),null);
});

test('scene limits reject both halves atomically; existing art stays byte-identical', () => {
  const mark={type:'path',d:'M10 20L30 40',fill:'none',stroke:'#123456',strokeWidth:4};
  const full={...blank(),objects:Array.from({length:5},(_,i)=>({id:`hand-${i+1}`,kind:'drawing',x:0,y:0,scale:1,color:'#123456',marks:Array.from({length:90},()=>({...mark}))}))};
  const many={...blank(),objects:Array.from({length:40},(_,i)=>({id:`tree-${i}`,kind:'tree',x:100,y:200,scale:1,color:'#123456'}))};
  const long={...blank(),objects:[{id:'hand-1',kind:'drawing',x:0,y:0,scale:1,color:'#123456',marks:Array.from({length:24},()=>({...mark,d:`M0 0${'L10 10'.repeat(400)}`}))}]};
  for(const before of [full,many,long]) {
    const snapshot=JSON.stringify(before),points=before===long?Array.from({length:1000},(_,i)=>({x:i,y:i%2?600:20})):line;
    assert.throws(()=>appendMirrorHandStroke(before,points,'#123456',5),/没有保存/);assert.equal(JSON.stringify(before),snapshot);
  }
});

test('ordinary pen defaults to the original path and emits one commit despite duplicate release', () => {
  const h=makeHarness();h.h.tree.props.onPointerDown(h.event(100,200));h.h.tree.props.onPointerMove(h.event(220,300));h.h.tree.props.onPointerUp(h.event(180,400));h.h.tree.props.onPointerUp(h.event(180,400));
  assert.equal(h.commits.length,1);assert.deepEqual(h.commits[0][0],appendHandStroke({...blank(),paper:{x:0,y:0,width:1000,height:640}},line,'#123456',5));
  assert.equal(h.nodes(n=>n.props?.['data-freehand-mirror-guide']).length,0);
});

test('mirror preview and final marks have identical geometry through transformed screen coordinates', () => {
  const h=makeHarness({symmetry:'mirror'});h.h.tree.props.onPointerDown(h.event(100,200));h.h.tree.props.onPointerMove(h.event(220,300));h.h.tree.props.onPointerMove(h.event(180,400));h.flush();
  const preview=h.nodes(n=>n.props?.['data-freehand-draft'])[0].props.d;
  h.h.tree.props.onPointerUp(h.event(180,400));h.render();
  assert.equal(h.commits.length,1);assert.equal(paths(h.commits[0][0]).join(''),preview);assert.equal(h.nodes(n=>n.props?.['data-freehand-draft']).length,0);
  assert.equal(h.nodes(n=>n.props?.['data-freehand-mirror-guide']).length,1);
});

test('release synchronously includes the last sample before a pending mirror preview frame', () => {
  const h=makeHarness({symmetry:'mirror'});h.h.tree.props.onPointerDown(h.event(100,200));h.h.tree.props.onPointerUp(h.event(200,320));h.flush();
  assert.equal(h.commits.length,1);assert.equal(paths(h.commits[0][0]).join(''),'M100 200L200 320M900 200L800 320');
  assert.equal(h.nodes(n=>n.props?.['data-freehand-draft']).length,0);
});

test('cancel removes both mirrored halves without committing and clears the erasing decorations', () => {
  const h=makeHarness({symmetry:'mirror'});h.h.tree.props.onPointerDown(h.event(100,200));h.h.tree.props.onPointerMove(h.event(180,400));h.flush();
  h.h.tree.props.onPointerCancel(h.event(180,400));h.render();
  assert.equal(h.commits.length,0);assert.equal(h.nodes(n=>n.props?.['data-freehand-draft']).length,0);
  const cancelled=h.nodes(n=>n.props?.['data-freehand-cancelled-draft']);assert.equal(cancelled.length,1);
  assert.equal(h.nodes(n=>n.props?.['data-cancel-eraser-mirror']).length,1);
  assert.ok(h.nodes(n=>n.type==='path'&&n.props?.transform==='translate(1000 0) scale(-1 1)').length);
  for(let i=0;i<20;i++)h.flush(i*40);
  assert.equal(h.nodes(n=>n.props?.['data-freehand-cancelled-draft']).length,0);assert.equal(h.frames.size,0);
});

test('disabling, changing symmetry/tool/viewport, or an incoming scene cancels a mirrored draft', () => {
  for(const change of [{disabled:true},{symmetry:'none'},{tool:'eraser'},{scene:blank()},{viewport:{x:-100,y:0,width:1200,height:640}}]) {
    const h=makeHarness({symmetry:'mirror',reducedMotion:true});h.h.tree.props.onPointerDown(h.event(100,200));h.h.tree.props.onPointerMove(h.event(180,400));h.flush();
    Object.assign(h.h.props,change);h.render();h.h.tree.props.onPointerUp(h.event(200,400));h.render();
    assert.equal(h.commits.length,0);assert.equal(h.nodes(n=>n.props?.['data-freehand-draft']).length,0);
  }
});

test('eraser remains single-sided and changing symmetry does not cancel an eraser gesture', () => {
  const h=makeHarness({tool:'eraser',symmetry:'mirror'});h.h.tree.props.onPointerDown(h.event(100,200));h.h.props.symmetry='none';h.render();h.h.tree.props.onPointerUp(h.event(180,400));h.render();
  assert.equal(h.commits.length,1);assert.deepEqual(h.commits[0][0].testErasure.points,[{x:100,y:200},{x:180,y:400}]);
  assert.equal(h.nodes(n=>n.props?.['data-freehand-mirror-guide']).length,0);assert.equal(h.commits[0][0].objects.length,0);
});

test('a different pointer cannot move, cancel or release the active mirrored gesture', () => {
  const h=makeHarness({symmetry:'mirror'});h.h.tree.props.onPointerDown(h.event(100,200));
  h.h.tree.props.onPointerMove(h.event(700,500,{pointerId:2}));h.h.tree.props.onPointerCancel(h.event(700,500,{pointerId:2}));h.h.tree.props.onPointerUp(h.event(700,500,{pointerId:2}));
  assert.equal(h.commits.length,0);h.h.tree.props.onPointerUp(h.event(180,400));assert.equal(h.commits.length,1);
  assert.equal(paths(h.commits[0][0]).join(''),'M100 200L180 400M900 200L820 400');
});
