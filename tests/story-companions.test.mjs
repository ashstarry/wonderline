import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import ts from 'typescript';

const names=['story-companions','scene-validation','eraser','freehand','object-pose','paper-viewport','content-filter'];
const files=names.map(name=>new URL(`../.sites-runtime/companions-${name}.mjs`,import.meta.url));
await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
for(const [index,name] of names.entries()){
  let output=ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const dependency of names)output=output.replaceAll(`'./${dependency}'`,`'./companions-${dependency}.mjs'`);
  await writeFile(files[index],output);
}
after(()=>Promise.all(files.map(file=>unlink(file))));
const api=await import(files[0].href);
const {sceneSchema}=await import(files[1].href);
const {objectMarkKeys,legacyErasureKey}=await import(files[2].href);
const {paperToLocal}=await import(files[4].href);
const paper={x:0,y:0,width:1000,height:640};
const empty=()=>({title:'Our story',sky:'paper',weather:'clear',ground:'none',objects:[],paper:{...paper}});
const object=()=>({id:'bear',kind:'drawing',x:300,y:280,scale:1,rotation:25,stackRank:4,color:'#a87344',label:'Bear with a blue scarf',marks:[{type:'ellipse',x:0,y:0,w:90,h:110,fill:'#a87344',stroke:'#664422',strokeWidth:3},{type:'rect',x:-35,y:-20,w:70,h:15,fill:'#6699cc'}]});
const bounds={x:225,y:210,width:150,height:140};
function scene(){
  const bear=object();const other={...object(),id:'tree',label:'Tree',x:600,y:300};
  return {...empty(),objects:[bear,other],erasures:[{id:'erase-1',paths:['M275 270L325 290'],width:20,shape:'square',targets:[{key:objectMarkKeys(bear)[0],x:300,y:280,scale:1,rotation:25},{key:objectMarkKeys(other)[0],x:600,y:300,scale:1,rotation:25}]},{id:'other-only',paths:['M580 270L600 290'],width:8,targets:[{key:objectMarkKeys(other)[0],x:600,y:300,scale:1,rotation:25}]}]};
}
const entry=(id='doudou',name='DouDou')=>api.createCompanion(scene(),'bear',name,'crayon',bounds,id,1000);
const reason=(action,expected)=>assert.throws(action,error=>error instanceof api.CompanionError&&error.reason===expected);
function storage(initial=null){let raw=initial;return {getItem(key){assert.equal(key,api.COMPANION_KEY);return raw;},setItem(key,value){assert.equal(key,api.COMPANION_KEY);raw=value;},value:()=>raw};}

test('empty and malformed versioned collections remain distinct',()=>{
  assert.deepEqual(api.readCompanions(null),[]);
  for(const raw of ['', '{}','[]','null','{broken','{"version":2,"entries":[]}'])assert.equal(api.readCompanions(raw),null);
  assert.deepEqual(api.readCompanions(api.serializeCompanions([])),[]);
});
test('capturing one character keeps exact geometry, pose and only that object’s masks',()=>{
  const source=scene(),snapshot=entry();
  assert.deepEqual(snapshot.object,source.objects[0]);
  assert.deepEqual(snapshot.bounds,bounds);
  assert.equal(snapshot.erasures.length,1);
  assert.deepEqual(snapshot.erasures[0],{...source.erasures[0],targets:[source.erasures[0].targets[0]]});
  assert.deepEqual(api.readCompanions(api.serializeCompanions([snapshot])),[snapshot]);
});
test('snapshot and collection operations clone their inputs',()=>{
  const source=scene(),snapshot=api.createCompanion(source,'bear','豆豆','pencil',bounds,'first',20);
  const list=api.addCompanion([],snapshot);
  source.objects[0].marks[0].fill='#ff0000';source.erasures[0].paths[0]='M0 0L1 1';snapshot.name='changed';
  assert.equal(list[0].name,'豆豆');assert.equal(list[0].object.marks[0].fill,'#a87344');
  assert.equal(list[0].erasures[0].paths[0],'M275 270L325 290');
});
test('valid English and Chinese names normalize without requiring a model',()=>{
  for(const [input,expected] of [['  豆豆  ','豆豆'],['Little   Bear','Little Bear'],['Ｆｉｎｎ','Finn'],["O’Bear",'O’Bear'],['Mr. Bear','Mr. Bear'],['Kiki-2','Kiki-2']])assert.equal(api.normalizeCompanionName(input),expected);
});
for(const name of ['', '   ','- .', 'a'.repeat(25),'<script>','https://example.com','name\u0000','bear🐻'])test(`invalid companion name ${JSON.stringify(name)} rejected`,()=>reason(()=>api.normalizeCompanionName(name),'invalid'));
for(const name of ['fuck','bullshit','you are stupid'])test(`name content rule blocks ${JSON.stringify(name)}`,()=>reason(()=>api.normalizeCompanionName(name),'blocked'));
test('same normalized name or ID cannot silently replace a saved friend',()=>{
  const entries=[entry()];reason(()=>api.addCompanion(entries,entry('other','doudou')),'duplicate-name');reason(()=>api.addCompanion(entries,entry('doudou','Other')),'duplicate-id');
  assert.equal(entries[0].name,'DouDou');
});
test('eight companions fit; adding a ninth never evicts an earlier one',()=>{
  const entries=Array.from({length:8},(_,n)=>entry(`id-${n}`,`Friend ${n}`));
  assert.equal(api.readCompanions(api.serializeCompanions(entries)).length,8);
  reason(()=>api.addCompanion(entries,entry('ninth','Ninth')),'full');assert.equal(entries.length,8);
});
test('unknown object, corrupt geometry and unexpected stored fields are rejected',()=>{
  reason(()=>api.createCompanion(scene(),'missing','Milo','crayon',bounds,'milo'),'missing-object');
  for(const change of [{id:'../bad'},{createdAt:Infinity},{style:'oil'},{extra:true},{bounds:{...bounds,width:0}},{object:{...object(),marks:[{type:'path',d:'M0 0<script>'}]}},{name:'  padded  '}])reason(()=>api.serializeCompanions([{...entry(),...change}]),'invalid');
});
test('unrelated or corrupt erasure targets cannot be injected into a companion',()=>{
  const snapshot=entry();snapshot.erasures[0].targets.push({key:'background:sky:day',x:0,y:0,scale:1});
  reason(()=>api.serializeCompanions([snapshot]),'invalid');
});
test('oversized collection is bounded without truncation',()=>{
  assert.equal(api.readCompanions(' '.repeat(api.COMPANION_MAX_BYTES/2+1)),null);
  const makeLarge=(id)=>{
    const base=entry(id,id);const d='M0 0'+Array.from({length:180},()=> 'L1 1').join('');
    base.object.marks=Array.from({length:80},()=>({type:'path',d}));base.erasures=[{id:'large-erase',paths:Array.from({length:50},()=>`M0 0${'L1 1'.repeat(590)}`),width:12,targets:[{key:objectMarkKeys(base.object)[0],x:0,y:0,scale:1}]}];return base;
  };
  // Individual path bounds remain valid; total serialized content is capped.
  const large=Array.from({length:8},(_,i)=>makeLarge(`large${i}`));
  reason(()=>api.serializeCompanions(large),'too-large');
});
test('storage saves atomically and rejects another tab’s newer copy',()=>{
  const local=storage(),initial=api.loadCompanions(local),saved=api.storeCompanions(local,[entry()],initial.raw);
  assert.deepEqual(api.loadCompanions(local).entries,[entry()]);
  local.setItem(api.COMPANION_KEY,api.serializeCompanions([entry('new','New')]));
  reason(()=>api.storeCompanions(local,[],saved.raw),'changed');assert.equal(api.loadCompanions(local).entries[0].name,'New');
});
test('quota denial, inaccessible storage and corruption preserve the prior raw bytes',()=>{
  const raw=api.serializeCompanions([entry()]),local=storage(raw);
  reason(()=>api.storeCompanions({getItem:local.getItem,setItem(){throw new DOMException('quota','QuotaExceededError');}},[],raw),'unavailable');assert.equal(local.value(),raw);
  reason(()=>api.loadCompanions({getItem(){throw Error();},setItem(){}}),'unavailable');
  const corrupt=storage('{broken');reason(()=>api.loadCompanions(corrupt),'invalid');reason(()=>api.storeCompanions(corrupt,[],'{broken'),'invalid');assert.equal(corrupt.value(),'{broken');
});
test('removal and guarded undo retain complete companion snapshots',()=>{
  const original=[entry(),entry('other','Other')],local=storage(api.serializeCompanions(original));const before=api.loadCompanions(local);
  const removed=api.storeCompanions(local,api.removeCompanion(before.entries,'doudou'),before.raw);assert.equal(removed.entries.length,1);
  assert.deepEqual(api.storeCompanions(local,before.entries,removed.raw).entries,original);
});
test('thumbnail includes no unrelated scene or background and owns its snapshot',()=>{
  const saved=entry(),thumbnail=api.companionScene(saved);assert.equal(thumbnail.objects.length,1);assert.equal(thumbnail.ground,'none');assert.equal(thumbnail.sky,'paper');assert.equal(thumbnail.paper,undefined);assert.ok(sceneSchema.safeParse(thumbnail).success);
  thumbnail.objects[0].x=999;assert.equal(saved.object.x,300);
});
test('stable safe identity and bounded named label let subsequent speech see the companion',()=>{
  assert.equal(api.companionObjectId(entry()),'companion-doudou');assert.equal(api.companionObjectId('doudou'),'companion-doudou');
  assert.equal(api.namedObjectLabel('豆豆',object()),'豆豆 · Bear with a blue scarf');assert.equal(api.namedObjectLabel('Milo',undefined),'Milo');
  assert.equal(api.namedObjectLabel('River',{...object(),label:undefined}),'River · drawing');
  assert.equal(api.namedObjectLabel('Ocean',{id:'cat',kind:'cat',x:0,y:0,scale:1,color:'#bb7744'}),'Ocean · cat');
  assert.equal(api.namedObjectLabel('Milo','Milo · Bear'),'Milo · Bear');assert.ok(api.namedObjectLabel('x'.repeat(24),'a'.repeat(40)).length<=40);
});
test('recall preserves marks, color, rotation, aspect ratio and exact original masks',()=>{
  const saved=entry(),destination=empty(),before=structuredClone(saved),result=api.placeCompanion(destination,saved,paper),placed=result.scene.objects[0];
  assert.equal(result.added,true);assert.equal(placed.id,'companion-doudou');assert.equal(placed.rotation,25);assert.equal(placed.color,saved.object.color);assert.deepEqual(placed.marks,saved.object.marks);assert.equal(placed.stackRank,undefined);
  const factor=placed.scale/saved.object.scale;assert.ok(Math.max(bounds.width*factor/paper.width,bounds.height*factor/paper.height)<=.320001);
  const stroke=result.scene.erasures[0];assert.equal(stroke.targets[0].key,objectMarkKeys(placed)[0]);assert.deepEqual(stroke.paths,saved.erasures[0].paths);assert.deepEqual({...stroke.targets[0],key:saved.erasures[0].targets[0].key},saved.erasures[0].targets[0]);assert.deepEqual(saved,before);assert.deepEqual(destination,empty());assert.ok(sceneSchema.safeParse(result.scene).success);
});
test('recalling an already present companion returns original scene without duplicated paint',()=>{
  const first=api.placeCompanion(empty(),entry(),paper),second=api.placeCompanion(first.scene,entry(),paper);assert.equal(second.added,false);assert.equal(second.scene,first.scene);assert.equal(second.objectId,first.objectId);
});
test('undo then recall produces the same stable object and erasure IDs',()=>{
  const initial=empty(),saved=entry();assert.deepEqual(api.placeCompanion(initial,saved,paper),api.placeCompanion(structuredClone(initial),saved,paper));
});
test('recall leaves unrelated geometry, layer ranks, backgrounds and masks byte-equivalent',()=>{
  const initial=scene(),before=JSON.stringify(initial),result=api.placeCompanion(initial,entry(),paper);
  assert.equal(JSON.stringify(initial),before);assert.deepEqual(result.scene.objects.slice(0,initial.objects.length),initial.objects);assert.deepEqual(result.scene.erasures.slice(0,initial.erasures.length),initial.erasures);assert.equal(result.scene.sky,initial.sky);assert.deepEqual(result.scene.paper,initial.paper);
});
test('local slot choice prefers empty space without shifting the existing artwork',()=>{
  const initial={...empty(),objects:[{id:'left',kind:'drawing',x:0,y:0,scale:1,color:'#ff0000',marks:[{type:'rect',x:0,y:0,w:600,h:640,fill:'#ff0000'}]}]};
  const added=api.placeCompanion(initial,entry(),paper).scene.objects.at(-1);const factor=added.scale/entry().object.scale;
  const left=added.x+(bounds.x-entry().object.x)*factor;assert.ok(left>=600);assert.deepEqual(initial.objects[0].marks[0].w,600);
});
test('legacy character erasure key is remapped too',()=>{
  const cat={id:'cat',kind:'cat',x:100,y:100,scale:1,color:'#bb7744'};const source={...empty(),objects:[cat],erasures:[{id:'erase',paths:['M90 90L110 110'],width:12,targets:[{key:legacyErasureKey(cat),x:100,y:100,scale:1}]}]};
  const saved=api.createCompanion(source,'cat','Mittens','crayon',{x:50,y:30,width:100,height:80},'mittens');const placed=api.placeCompanion(empty(),saved,paper).scene;
  assert.equal(placed.erasures[0].targets[0].key,legacyErasureKey(placed.objects[0]));
});
test('copied mask coordinate space rebases onto another paper without moving local holes',()=>{
  const saved=entry(),destination={...empty(),paper:{x:-1000,y:-800,width:500,height:400}};
  const result=api.placeCompanion(destination,saved,destination.paper).scene;
  const originalStroke=saved.erasures[0],placedStroke=result.erasures[0];
  const points=path=>[...path.matchAll(/[ML]([-+\d.]+) ([-+\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}));
  const old=points(originalStroke.paths[0]).map(point=>paperToLocal(point,originalStroke.targets[0]));const next=points(placedStroke.paths[0]).map(point=>paperToLocal(point,placedStroke.targets[0]));
  for(let i=0;i<old.length;i++){assert.ok(Math.abs(old[i].x-next[i].x)<1e-4);assert.ok(Math.abs(old[i].y-next[i].y)<1e-4);}
  assert.ok(Math.abs(originalStroke.width/originalStroke.targets[0].scale-placedStroke.width/placedStroke.targets[0].scale)<1e-6);assert.ok(sceneSchema.safeParse(result).success);
});
test('an erasure made before a character was moved still stays attached on recall',()=>{
  const source=scene();source.objects[0].x=450;source.objects[0].scale=1.5;source.objects[0].rotation=-35;
  const saved=api.createCompanion(source,'bear','Moved','crayon',{x:320,y:170,width:240,height:210},'moved');const result=api.placeCompanion(empty(),saved,paper).scene;
  assert.equal(result.objects[0].rotation,-35);assert.equal(result.erasures[0].targets[0].rotation,25);assert.equal(result.erasures[0].targets[0].scale,1);assert.deepEqual(result.erasures[0].paths,saved.erasures[0].paths);
});
test('large mask coordinates scale with their frame and width on a smaller sheet',()=>{
  const saved=entry();saved.erasures[0].paths=['M0 0L1000 640'];
  const destination={...empty(),paper:{x:-1000,y:-800,width:500,height:400}};
  const placed=api.placeCompanion(destination,saved,destination.paper).scene.erasures[0];
  assert.ok(placed.targets[0].scale<saved.erasures[0].targets[0].scale);
  const nums=[...placed.paths[0].matchAll(/[ML]([-+\d.]+) ([-+\d.]+)/g)];
  for(const [index,point] of [{x:0,y:0},{x:1000,y:640}].entries()){
    const before=paperToLocal(point,saved.erasures[0].targets[0]),after=paperToLocal({x:Number(nums[index][1]),y:Number(nums[index][2])},placed.targets[0]);
    assert.ok(Math.abs(before.x-after.x)<1e-4);assert.ok(Math.abs(before.y-after.y)<1e-4);
  }
  assert.ok(Math.abs(placed.width/placed.targets[0].scale-20)<1e-6);
});
test('scene capacities and impossible fit fail explicitly without losing existing work',()=>{
  const full={...empty(),objects:Array.from({length:40},(_,n)=>({...object(),id:`object-${n}`}))};const before=JSON.stringify(full);reason(()=>api.placeCompanion(full,entry(),paper),'full');assert.equal(JSON.stringify(full),before);
  const tiny={x:0,y:0,width:5,height:5};reason(()=>api.placeCompanion({...empty(),paper:tiny},entry(),tiny),'no-room');
  const marks={...empty(),objects:Array.from({length:5},(_,n)=>({...object(),id:`many-${n}`,marks:Array.from({length:n===4?50:100},()=>object().marks[0])}))};reason(()=>api.placeCompanion(marks,entry(),paper),'full');
});
test('existing erasure ID collisions are resolved without deleting either gesture',()=>{
  const initial=scene();initial.erasures[0].id='companion-doudou-e0';const result=api.placeCompanion(initial,entry(),paper).scene;assert.equal(new Set(result.erasures.map(stroke=>stroke.id)).size,result.erasures.length);assert.equal(result.erasures.at(-1).id,'companion-doudou-e0-1');
});
test('unsafe incoming viewport and geometry never produce fallback replacement',()=>{
  reason(()=>api.placeCompanion(empty(),entry(),{...paper,width:NaN}),'invalid');reason(()=>api.placeCompanion({...empty(),objects:[{...object(),scale:100}]},entry(),paper),'invalid');
});
