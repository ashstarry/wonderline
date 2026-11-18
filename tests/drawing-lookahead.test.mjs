import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import ts from 'typescript';
const root=new URL('../.sites-runtime/',import.meta.url);await mkdir(root,{recursive:true});
const files=[];
for(const name of ['scene-validation','drawing-failure','drawing-lookahead','live-painting','preview-buffer','stroke-playback-queue']){
 const file=new URL(`ahead-${name}.mjs`,root);files.push(file);
 let source=ts.transpileModule(await readFile(new URL(`../${name==='stroke-playback-queue'?'components':'lib'}/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const dep of ['scene-validation','drawing-failure'])source=source.replaceAll(`'./${dep}'`,`'./ahead-${dep}.mjs'`);
 await writeFile(file,source);
}
after(()=>Promise.all(files.map(f=>unlink(f))));
const {DrawingLookahead,rebaseAdditions,canLookAhead}=await import(new URL('ahead-drawing-lookahead.mjs',root));
const {LivePaintingQueue}=await import(new URL('ahead-live-painting.mjs',root));
const {StrokePlaybackQueue}=await import(new URL('ahead-stroke-playback-queue.mjs',root));
const {PreviewBuffer}=await import(new URL('ahead-preview-buffer.mjs',root));
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const obj=id=>({id,kind:'drawing',x:100,y:300,scale:1,color:'#66aabb',marks:[{type:'ellipse',x:0,y:0,w:30,h:30,fill:'#66aabb'}]});
const base={title:'球场',sky:'paper',weather:'clear',ground:'none',paper:{x:0,y:0,width:1000,height:640},objects:[obj('field')]};
const context={scene:base,layout:[{id:'field',bounds:{x:0,y:300,width:1000,height:300},anchors:[]}],instruction:'画世界杯足球场和球员',recent:[]};
const candidate={...base,objects:[...base.objects,obj('helicopter')]};
const result={action:'update',scene:candidate,message:'直升机来了'};

test('a confirmed helicopter request starts while the field model is still pending; ordered commits preserve its finished players',async()=>{
 const ahead=new DrawingLookahead(),first=deferred(),second=deferred();
 const requests=[],commits=[],previews=[];let current=base;
 let queue;
 const reserve=()=>{const next=queue.peekNext();if(next&&!ahead.occupied&&canLookAhead(next.text)){queue.reserveNext(next.id);ahead.start(next.text,context,async(text,_context,signal,onPreview)=>{requests.push(text);onPreview(candidate);await second.promise;assert.equal(signal.aborted,false);return result;});}};
 queue=new LivePaintingQueue(async(text,signal)=>{
  if(text==='世界杯踢足球'){requests.push(text);await first.promise;current={...base,objects:[{...base.objects[0],marks:[...base.objects[0].marks,{type:'line',x:0,y:0,x2:30,y2:30}]},obj('player')]};}
  else {const value=await ahead.take(text,current,signal,p=>previews.push(p));assert.ok(value);current=value.scene;}
  commits.push(text);
 },()=>{if(queue)reserve();});
 queue.add([{id:'field',text:'世界杯踢足球'}]);await tick();
 queue.add([{id:'helicopter',text:'天上有个直升机直播'}]);await tick();
 assert.deepEqual(requests,['世界杯踢足球','天上有个直升机直播']);assert.deepEqual(commits,[]);assert.deepEqual(previews,[]);
 second.resolve();await tick();assert.deepEqual(commits,[],'the ahead result cannot overwrite the in-flight field');
 first.resolve();await tick();await tick();
 assert.deepEqual(commits,['世界杯踢足球','天上有个直升机直播']);
 assert.deepEqual(current.objects.map(o=>o.id),['field','player','helicopter']);assert.equal(current.objects[0].marks.length,2);
 assert.equal(previews.length,1);assert.equal(ahead.occupied,false);queue.cancel();
});

test('dependent hand/pose/color instructions use complete geometry, and lookahead is bounded to one',async()=>{
 for(const phrase of ['他手上拿着一个泰迪熊','给它换成红色','不是猫应该是狗','抱着一只小熊'])assert.equal(canLookAhead(phrase),false);
 const ahead=new DrawingLookahead(),gate=deferred();let calls=0;
 assert.ok(ahead.start('天上有直升机',context,async()=>{calls++;await gate.promise;return result;}));
 assert.equal(ahead.start('再画一朵云',context,async()=>result),false);await tick();assert.equal(calls,1);
 gate.resolve();ahead.cancel();
});

test('reserved speech is never coalesced with later speech or silently dropped',async()=>{
 const gate=deferred(),texts=[];const queue=new LivePaintingQueue(async text=>{texts.push(text);if(text==='first')await gate.promise;},()=>{});
 queue.add([{id:'a',text:'first'}]);await tick();queue.add([{id:'b',text:'second'}]);assert.ok(queue.reserveNext(queue.peekNext().id));queue.add([{id:'c',text:'third'}]);gate.resolve();await tick();await tick();
 assert.deepEqual(texts,['first','second','third']);queue.cancel();
});

test('ahead merge refuses old edits, removals, reorder, global changes, collisions and changed paper',()=>{
 const current={...base,objects:[...base.objects,obj('player')]};
 const invalid=[{...candidate,sky:'night'},{...candidate,objects:[{...obj('field'),color:'#ff0000'},obj('helicopter')]},{...candidate,objects:[obj('helicopter')]},{...candidate,objects:[obj('helicopter'),obj('field')]},{...candidate,objects:[obj('field'),obj('player')]}];
 for(const scene of invalid)assert.equal(rebaseAdditions(base,scene,current),null);
 assert.equal(rebaseAdditions(base,candidate,{...current,paper:{...base.paper,width:800}}),null);
 const full={...base,objects:Array.from({length:40},(_,i)=>obj(i?'existing'+i:'field'))};assert.equal(rebaseAdditions(base,candidate,full),null);
 const erased={...current,erasures:[{id:'rub',paths:['M100 100L110 110'],width:30,targets:[{key:'field:0',x:100,y:300,scale:1}]}]};
 assert.deepEqual(rebaseAdditions(base,candidate,erased).erasures,erased.erasures);
});

test('unsafe or dependent prepared result is discarded without displaying internal clarification',async()=>{
 for(const value of [{...result,action:'clarify',message:'等关联位置确定后继续。'}, {...result,scene:{...candidate,ground:'lake'}}]){
  const ahead=new DrawingLookahead(),display=[];ahead.start('画直升机',context,async()=>value);
  const prepared=await ahead.take('画直升机',base,new AbortController().signal,s=>display.push(s));
  assert.equal(prepared,null);assert.deepEqual(display,[]);
 }
});

test('a late descriptive title does not reject already drawn additions or cancel the next idea',async()=>{
 const ahead=new DrawingLookahead(),gate=deferred(),child=deferred(),painted=[];let childSignal;
 ahead.start('Draw two snowmen.',context,async(_p,_c,_s,preview)=>{
  preview(candidate,context.layout);await gate.promise;
  return {...result,scene:{...candidate,title:'A new snowy scene'}};
 });await tick();
 const current={...base,title:'The current paper'};
 const taking=ahead.take('Draw two snowmen.',current,new AbortController().signal,s=>painted.push(s),(scene,layout)=>{
  ahead.start('Draw a cloud.',{...context,scene,layout},async(_p,_c,signal)=>{childSignal=signal;await child.promise;return result;});
 });await tick();gate.resolve();const finished=await taking;
 assert.deepEqual(finished.scene.objects,candidate.objects);
 assert.equal(finished.scene.title,current.title);
 assert.equal(painted.length,1,'the title does not replay the same geometry');
 assert.equal(childSignal.aborted,false,'the prepared next idea is still usable');
 ahead.cancel();child.resolve();
});

test('network failure is surfaced once without automatic paid retry; cancellation aborts active work',async()=>{
 const ahead=new DrawingLookahead();let calls=0;
 ahead.start('画直升机',context,async()=>{calls++;throw new Error('network');});await tick();
 await assert.rejects(ahead.take('画直升机',base,new AbortController().signal,()=>{}),/network/);assert.equal(calls,1);
 const gate=deferred();let modelSignal;ahead.start('画直升机',context,async(_p,_c,signal)=>{modelSignal=signal;await gate.promise;return result;});await tick();
 const caller=new AbortController(),taking=ahead.take('画直升机',base,caller.signal,()=>assert.fail('stale preview'));caller.abort();assert.equal(modelSignal.aborted,true);gate.resolve();await assert.rejects(taking,{name:'AbortError'});
 ahead.start('画直升机',context,async()=>result);ahead.cancel();assert.equal(ahead.occupied,false);
});

test('preview burst keeps first geometry immediate and coalesces later frames; final disposal drops stale work',async()=>{
 const values=[],buffer=new PreviewBuffer(v=>values.push(v),10);buffer.offer(1);assert.deepEqual(values,[1]);buffer.offer(2);buffer.offer(3);
 await new Promise(r=>setTimeout(r,25));assert.deepEqual(values,[1,3]);buffer.offer(4);buffer.dispose();await new Promise(r=>setTimeout(r,25));assert.deepEqual(values,[1,3]);
});

test('planning relay reaches the third and fourth ideas before the current model finishes, streaming safe additions after the predecessor commits',async()=>{
 const ahead=new DrawingLookahead(),gates=[deferred(),deferred(),deferred()];let active=0,peak=0;
 const requests=[],painted=[];
 const c2={...base,objects:[...base.objects,obj('fish')]};
 const c3={...c2,objects:[...c2.objects,obj('dog')]};
 const c4={...c3,objects:[...c3.objects,obj('ufo')]};
 const layout=id=>[{id,bounds:{x:600,y:80,width:80,height:80},anchors:[]}];
 const generate=(index,scene,id)=>async(text,_ctx,signal,preview)=>{
  requests.push(text);peak=Math.max(peak,++active);preview(scene,layout(id));await gates[index].promise;active--;if(signal.aborted)throw new DOMException('cancelled','AbortError');return{action:'update',scene,message:'ok'};
 };
 ahead.start('画小鱼',context,generate(0,c2,'fish'));await tick();
 const second=ahead.take('画小鱼',base,new AbortController().signal,s=>painted.push(s),(scene,layout)=>ahead.start('画小狗',{...context,scene,layout},generate(1,c3,'dog')));
 await tick();assert.deepEqual(requests,['画小鱼','画小狗']);assert.equal(painted.length,1);
 gates[0].resolve();const secondResult=await second;
 const third=ahead.take('画小狗',secondResult.scene,new AbortController().signal,s=>painted.push(s),(scene,layout)=>ahead.start('画飞碟',{...context,scene,layout},generate(2,c4,'ufo')));
 await tick();assert.deepEqual(requests,['画小鱼','画小狗','画飞碟']);assert.equal(painted.length,2);
 gates[1].resolve();const thirdResult=await third;gates[2].resolve();
 const fourth=await ahead.take('画飞碟',thirdResult.scene,new AbortController().signal,s=>painted.push(s));
 assert.equal(peak,2);assert.deepEqual(fourth.scene.objects.map(o=>o.id),['field','fish','dog','ufo']);assert.equal(painted.length,3);
});

test('an invalid parent cancels its speculative descendant; stale planning cannot restart a cancelled chain',async()=>{
 const ahead=new DrawingLookahead(),parent=deferred(),child=deferred(),painted=[];let childSignal,calls=0;
 ahead.start('画小鱼',context,async(_p,_c,_s,preview)=>{preview(candidate,context.layout);await parent.promise;return{...result,action:'clarify'};});await tick();
 const take=ahead.take('画小鱼',base,new AbortController().signal,scene=>painted.push(scene),(scene,layout)=>ahead.start('画小狗',{...context,scene,layout},async(_p,_c,signal)=>{calls++;childSignal=signal;await child.promise;return result;}));
 await tick();assert.equal(calls,1);parent.resolve();await assert.rejects(take,{kind:'turn'});assert.equal(painted.length,1,'safe progress stays available for the normal retention path');assert.equal(childSignal.aborted,true);assert.equal(ahead.occupied,false);child.resolve();
});


test('a green horse gets its own artist before the red horse finishes and before its own model completes',async()=>{
 const tasks=new Map(),artists=new StrokePlaybackQueue(({key})=>{
  const task={hasColor:true,artist:null,phases:[],retarget(){},assignPainter(i){this.artist=i;},play(phase,done){this.phases.push(phase);this.done=done;},dispose(){}};
  tasks.set(key,task);return task;
 });
 artists.reconcile([]);
 const red=obj('red-horse'),green={...obj('green-horse'),x:700};
 const redScene={...base,objects:[red]},greenScene={...redScene,objects:[red,green]};
 const entries=scene=>scene.objects.flatMap(o=>o.marks.map((mark,i)=>({key:o.id+':'+i,owner:o.id,target:mark})));
 artists.reconcile(entries(redScene),false,1);
 const previous=tasks.get('red-horse:0'),ahead=new DrawingLookahead(),gate=deferred();let send;
 ahead.start('A green horse on the right.',{...context,scene:redScene},async(_p,_c,_s,preview)=>{send=preview;await gate.promise;return{action:'update',scene:greenScene,message:'ok'};});
 await tick();send(greenScene);
 assert.equal(tasks.has('green-horse:0'),false,'no ahead art before parent model commit');
 const take=ahead.take('A green horse on the right.',redScene,new AbortController().signal,scene=>artists.reconcile(entries(scene),false,2));
 await tick();
 assert.deepEqual(previous.phases,['outline']);
 assert.deepEqual(tasks.get('green-horse:0').phases,['outline']);
 assert.notEqual(previous.artist,tasks.get('green-horse:0').artist);
 assert.equal(artists.snapshot().painters.length,2);
 gate.resolve();await take;
 assert.deepEqual(previous.phases,['outline'],'finishing the next model never fast-forwards the previous artist');
 ahead.cancel();artists.dispose();
});

test('independent subjects may start early, but an edit or relative layer needs the committed scene', () => {
  for (const text of ['A green horse on the right.', 'Draw a green horse on the right.', 'Another owl on the left of the page.', '右边一匹绿马。', '左上角两颗星星。']) {
    assert.equal(canLookAhead(text), true, text);
  }
  for (const text of ['Move the ball over there.', 'Draw a forest behind the castle.', 'A horse on the right of the castle.', '在城堡后面画一片森林。', '把球移到有小猫的地方。']) {
    assert.equal(canLookAhead(text), false, text);
  }
});
