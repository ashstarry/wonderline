import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile,unlink,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const file=new URL('../.sites-runtime/object-transform-test.mjs',import.meta.url);
await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
const compiled=await build({stdin:{contents:"export * from './lib/object-transform';export * from './lib/scene-paint-order';export * from './lib/object-pose';export * from './lib/eraser';export * from './lib/drawing-history';export * from './lib/freehand';export * from './lib/scene-validation';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,packages:'external',platform:'node',format:'esm',write:false});
await writeFile(file,compiled.outputFiles[0].text);after(()=>unlink(file));
const {bringObjectToFront,getScenePaintOrder,removeObject,rotateObject,localToPaper,paperToLocal,applyScenePatch,moveObject,resizeObject,transformedBox,commitObjectPose,appendErasure,objectMarkKeys,sceneForModel,readDrawingHistory,writeDrawingHistory,appendHandStroke,sceneSchema}=await import(file.href);
const paper={x:0,y:0,width:1000,height:640};
const object={id:'fish',kind:'drawing',x:300,y:250,scale:1.5,color:'#447799',marks:[{type:'ellipse',x:-20,y:-30,w:100,h:60,fill:'#447799',stroke:'#334455',strokeWidth:3}]};
const box={x:270,y:205,width:150,height:90};
const scene={title:'Our picture',sky:'paper',ground:'none',weather:'clear',objects:[object,{id:'sun',kind:'sun',x:700,y:100,scale:1,color:'#ffee88'}],paper};
test('drag moves only its stable object; model continuation sees the committed location',()=>{
 const pose=moveObject(object,box,{x:80,y:45},paper),next=commitObjectPose(scene,'fish',pose);
 assert.deepEqual(pose,{x:380,y:295,scale:1.5});assert.equal(scene.objects[0].x,300);assert.equal(next.objects[1],scene.objects[1]);assert.equal(next.objects[0].marks,object.marks);
 assert.deepEqual(sceneForModel(next).objects[0],next.objects[0]);assert.deepEqual(next.objects.map(o=>o.id),scene.objects.map(o=>o.id));assert.ok(sceneSchema.safeParse(next).success);
});
test('resize keeps its top-left fixed, preserves proportions and never warps individual marks',()=>{
 const pose=resizeObject(object,box,{x:150,y:90},paper),after=transformedBox(box,object,pose);
 assert.deepEqual(after,{x:270,y:205,width:300,height:180});assert.equal(pose.scale,3);assert.equal(commitObjectPose(scene,'fish',pose).objects[0].marks,object.marks);
});
test('drag and resize stop at paper edges and legal scale limits',()=>{
 const moved=moveObject(object,box,{x:9999,y:9999},paper),b=transformedBox(box,object,moved);assert.equal(b.x+b.width,1000);assert.equal(b.y+b.height,640);
 const tiny=resizeObject(object,box,{x:-9999,y:-9999},paper);assert.equal(tiny.scale,.2);
 const large=resizeObject(object,box,{x:9999,y:9999},paper);assert.equal(large.scale,3.5);
 assert.equal(commitObjectPose(scene,'fish',{x:NaN,y:0,scale:1}),scene);assert.equal(commitObjectPose(scene,'missing',object),scene);assert.equal(commitObjectPose(scene,'fish',object),scene);
});
test('partial erasures stay attached to their pigment, other objects and erasures stay untouched',()=>{
 const erased=appendErasure(scene,[{x:300,y:250},{x:330,y:255}],24,'erase');
 const next=commitObjectPose(erased,'fish',{x:450,y:320,scale:2});
 assert.equal(next.erasures,erased.erasures);assert.deepEqual(objectMarkKeys(next.objects[0]),objectMarkKeys(object));
 assert.deepEqual(next.erasures[0].targets,erased.erasures[0].targets);
 // Erasure points are converted using the old frame, then painted in the new frame.
 const target=next.erasures[0].targets.find(t=>t.key===objectMarkKeys(object)[0]);
 assert.equal((300-target.x)/target.scale*next.objects[0].scale+next.objects[0].x,450);
});
test('one transform round-trips as one undoable persisted history entry',()=>{
 const moved=commitObjectPose(scene,'fish',{x:450,y:320,scale:2});
 const entries=[scene,moved].map((scene,index)=>({scene,phrase:index?'Moved an object':'',message:'',paperId:'paper-test',style:'crayon'}));
 const saved=readDrawingHistory(writeDrawingHistory({history:entries,cursor:1,style:'crayon'}));
 assert.equal(saved.history.length,2);assert.deepEqual(saved.history[1].scene,moved);assert.deepEqual(saved.history[0].scene,scene);
});
test('drawing by hand after moving hand marks starts a fresh frame instead of offsetting new strokes',()=>{
 const hand=appendHandStroke({...scene,objects:[]},[{x:10,y:10},{x:70,y:10}],'#447799',5);
 const moved=commitObjectPose(hand,hand.objects[0].id,{x:60,y:40,scale:2});
 const continued=appendHandStroke(moved,[{x:100,y:150},{x:160,y:150}],'#447799',5);
 assert.equal(continued.objects.length,2);assert.deepEqual(continued.objects[0],moved.objects[0]);assert.equal(continued.objects[1].marks[0].d,'M100 150L160 150');assert.equal(continued.objects[1].scale,1);
});

const near=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} != ${b}`);
test('rotation preserves the visible centre and mark identity, even with a page-origin drawing',()=>{
 for(const subject of [object,{...object,x:0,y:0}]){
  const pose=rotateObject(subject,box,90,paper),after=transformedBox(box,subject,pose);
  near(after.x+after.width/2,box.x+box.width/2);near(after.y+after.height/2,box.y+box.height/2);
  near(after.width,box.height);near(after.height,box.width);assert.equal(pose.rotation,90);
  const restored=rotateObject(pose,after,-90,paper);near(restored.x,subject.x);near(restored.y,subject.y);assert.equal(restored.rotation,0);
 }
 assert.equal(commitObjectPose(scene,'fish',{...object,rotation:NaN}),scene);
 assert.equal(rotateObject({...object,rotation:175},box,15,paper).rotation,-170);
});
test('rotation survives movement, resizing, new strokes, model color edits and history reload',()=>{
 const pose=rotateObject(object,box,30,paper),rotated=commitObjectPose(scene,'fish',pose),bounds=transformedBox(box,object,pose);
 assert.equal(moveObject(pose,bounds,{x:20,y:10},paper).rotation,30);
 assert.equal(resizeObject(pose,bounds,{x:20,y:10},paper).rotation,30);
 const patch={action:'update',message:'done',title:null,sky:null,weather:null,ground:null,additions:[],removals:[],updates:[{id:'fish',x:null,y:null,scale:null,color:'#aabbcc',label:null}]};
 const changed=applyScenePatch(rotated,patch).scene;
 assert.equal(changed.objects[0].rotation,30);assert.deepEqual(changed.objects[0].marks,object.marks);assert.deepEqual(changed.objects[1],scene.objects[1]);
 const erased=appendErasure(rotated,[{x:300,y:250},{x:330,y:255}],24,'tilted-erase',undefined,'square');
 assert.equal(erased.erasures[0].targets.find(t=>t.key===objectMarkKeys(object)[0]).rotation,30);
 const saved=readDrawingHistory(writeDrawingHistory({history:[scene,erased].map(scene=>({scene,phrase:'',message:'',paperId:'paper',style:'crayon'})),cursor:1,style:'crayon'}));
 assert.deepEqual(saved.history[1].scene,erased);
 assert.deepEqual(sceneForModel(erased).objects[0],rotated.objects[0]);
 const local=paperToLocal({x:330,y:255},pose);const global=localToPaper(local,pose);near(global.x,330);near(global.y,255);
 const hand=appendHandStroke({...scene,objects:[]},[{x:10,y:10},{x:70,y:10}],'#447799',5);
 const tilted=commitObjectPose(hand,hand.objects[0].id,{x:0,y:0,scale:1,rotation:15});
 assert.equal(appendHandStroke(tilted,[{x:100,y:150},{x:160,y:150}],'#447799',5).objects.length,2);
});

test('deleting a selection removes only that object, prunes its erase targets, and is undoable',()=>{
 const erased=appendErasure(scene,[{x:300,y:250},{x:720,y:100}],24,'shared-erase');
 const deleted=removeObject(erased,'fish');
 assert.deepEqual(deleted.objects,[scene.objects[1]]);
 assert.equal(deleted.objects[0],scene.objects[1]);
 assert.ok(deleted.erasures[0].targets.length>0);
 assert.ok(deleted.erasures[0].targets.every(target=>!objectMarkKeys(object).includes(target.key)));
 assert.equal(erased.objects.length,2);
 assert.equal(sceneForModel(deleted).objects.some(object=>object.id==='fish'),false);
 const history=[erased,deleted].map(scene=>({scene,phrase:'',message:'',paperId:'test',style:'crayon'}));
 const saved=readDrawingHistory(writeDrawingHistory({history,cursor:1,style:'crayon'}));
 assert.deepEqual(saved.history[0].scene,erased);
 assert.deepEqual(saved.history[1].scene,deleted);
 assert.equal(removeObject(deleted,'fish'),deleted);
 assert.equal(removeObject(scene,'missing'),scene);
});
test('removing the last hand-drawn object leaves valid blank paper',()=>{
 const hand=appendHandStroke({...scene,objects:[]},[{x:10,y:10},{x:70,y:10}],'#447799',5);
 const erased=appendErasure(hand,[{x:20,y:10},{x:30,y:10}],24,'hand-erase');
 const deleted=removeObject(erased,hand.objects[0].id);
 assert.deepEqual(deleted.objects,[]);
 assert.ok(deleted.erasures.every(stroke=>stroke.targets.every(target=>target.key.startsWith('background:'))));
 assert.ok(sceneSchema.safeParse(deleted).success);assert.equal(deleted.paper,hand.paper);
});


test('bring to front is explicit, preserves all pigment and geometry, and is undoable',()=>{
 const erased=appendErasure(scene,[{x:300,y:250},{x:330,y:255}],24,'front-mask');
 const next=bringObjectToFront(erased,'fish');
 assert.deepEqual(getScenePaintOrder(erased).map(o=>o.id),['fish','sun']);
 assert.deepEqual(getScenePaintOrder(next).map(o=>o.id),['sun','fish']);
 assert.deepEqual(next.objects.map(({stackRank,...o})=>o),erased.objects);
 assert.equal(next.erasures,erased.erasures);assert.equal(next.objects[0].marks,object.marks);
 assert.equal(bringObjectToFront(next,'fish'),next);assert.equal(bringObjectToFront(next,'missing'),next);
 const again=bringObjectToFront(next,'sun');assert.deepEqual(getScenePaintOrder(again).map(o=>o.id),['fish','sun']);
 const saved=readDrawingHistory(writeDrawingHistory({history:[erased,next].map(scene=>({scene,phrase:'',message:'',paperId:'front-test',style:'crayon'})),cursor:1,style:'crayon'}));
 assert.deepEqual(saved.history[1].scene,next);assert.deepEqual(saved.history[0].scene,erased);
});
test('manual depth survives model additions, color edits and moves without another model request',()=>{
 const raised=bringObjectToFront(scene,'fish');
 const patch={action:'update',message:'done',title:null,sky:null,weather:null,ground:null,removals:[],updates:[{id:'fish',x:null,y:null,scale:null,color:'#aabbcc',label:null}],additions:[{id:'cloud',kind:'cloud',x:200,y:100,scale:1,color:'#aabbcc',label:'cloud'}]};
 const next=applyScenePatch(sceneForModel(raised),patch).scene;
 assert.equal(next.objects.find(o=>o.id==='fish').stackRank,1);assert.equal(getScenePaintOrder(next).at(-1).id,'fish');
 assert.equal(getScenePaintOrder(commitObjectPose(next,'fish',{...object,x:350})).at(-1).id,'fish');
 assert.equal(getScenePaintOrder(removeObject(next,'fish')).some(o=>o.id==='fish'),false);
});
