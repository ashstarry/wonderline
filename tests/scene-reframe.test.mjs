import {test,after} from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,unlink} from 'node:fs/promises';import ts from 'typescript';
const file=new URL('../.sites-runtime/reframe-test.mjs',import.meta.url);await writeFile(file,ts.transpileModule(await readFile(new URL('../lib/scene-reframe.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);const{depthOnlyChanges,poseOnlyChanges,poseDelta,makeForegroundRoom}=await import(file.href);after(()=>unlink(file));
const mountain={id:'mountains',kind:'drawing',x:0,y:0,scale:1,color:'#88aabb',marks:[{type:'path',d:'M100 530L450 80L900 530Z'}]};
const scene={title:'landscape',sky:'paper',ground:'none',weather:'clear',objects:[mountain],paper:{x:0,y:0,width:1000,height:640},erasures:[{id:'rub',paths:['M110 520L120 520'],width:20,targets:[]}]};const geometry={objects:[{id:'mountains',bounds:[100,80,800,450]}]};
test('group reframe preserves marks, IDs, stacking, holes and object identity apart from pose',()=>{const next=makeForegroundRoom(scene,geometry);assert.ok(next);assert.equal(next.erasures,scene.erasures);assert.equal(next.objects[0].marks,mountain.marks);assert.equal(next.objects[0].id,mountain.id);assert.ok(next.objects[0].scale<1);assert.equal(poseOnlyChanges(scene,next).size,1);});
test('small scenes, unknown bounds, child drawings and fixed terrain stay untouched',()=>{assert.equal(makeForegroundRoom(scene,{objects:[]}),null);assert.equal(makeForegroundRoom(scene,{objects:[{id:'mountains',bounds:[100,100,100,100]}]}),null);assert.equal(makeForegroundRoom({...scene,ground:'lake'},geometry),null);assert.equal(makeForegroundRoom({...scene,objects:[{...mountain,id:'hand-a'}]},geometry),null);});
test('paint or eraser changes never qualify for a transform alias',()=>{assert.equal(poseOnlyChanges(scene,{...scene,objects:[{...mountain,x:50,color:'#ff0000'}]}).size,0);assert.equal(poseOnlyChanges(scene,{...scene,erasures:[],objects:[{...mountain,x:50}]}).size,0);});
test('motion matrix maps the new pose exactly back to the old pose including rotation',()=>{const old={x:110,y:50,scale:1.3,rotation:35},next={x:350,y:200,scale:.7,rotation:-20};const m=poseDelta(old,next);const map=(p,o)=>{const a=o.rotation*Math.PI/180;return{x:o.x+o.scale*(p.x*Math.cos(a)-p.y*Math.sin(a)),y:o.y+o.scale*(p.x*Math.sin(a)+p.y*Math.cos(a))}};for(const p of [{x:0,y:0},{x:18,y:-75}]){const a=map(p,old),b=map(p,next);assert.ok(Math.abs(m[0]*b.x+m[2]*b.y+m[4]-a.x)<1e-8);assert.ok(Math.abs(m[1]*b.x+m[3]*b.y+m[5]-a.y)<1e-8);}});

test('depth changes retain finished ink in both directions, but never conceal real edits',()=>{
 const raised={...scene,objects:[{...mountain,stackRank:1}]};
 assert.deepEqual([...depthOnlyChanges(scene,raised)],['mountains']);
 assert.deepEqual([...depthOnlyChanges(raised,scene)],['mountains']);
 for(const changed of [{...mountain,color:'#ff0000'},{...mountain,x:2},{...mountain,marks:[{type:'path',d:'M1 2L3 4'}]}]){
  assert.equal(depthOnlyChanges(scene,{...scene,objects:[{...changed,stackRank:1}]}).size,0);
 }
 assert.equal(depthOnlyChanges(scene,{...raised,erasures:[]}).size,0);
});
