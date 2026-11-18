import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(new URL('../.sites-runtime/rollback-',import.meta.url));
for(const name of ['studio-endpoint','conversation','paper-conversation','transcript-omission','drawing-rollback','scene-validation','drawing-failure','imagine-stream-client','live-painting','drawing-lookahead']){
 const code=ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:99,module:99}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");
 await writeFile(`${dir}/${name}.mjs`,code);
}
after(()=>rm(dir,{recursive:true,force:true}));
const get=name=>import(pathToFileURL(`${dir}/${name}.mjs`));
const {rollbackDrawingTurn,ROLLED_BACK_DRAWING_MESSAGE}=await get('drawing-rollback');
const {DrawingFailure,RolledBackDrawingFailure,drawingFailureKind,drawingFailureDiagnostic}=await get('drawing-failure');
const {readImagineResponse,requestImagine}=await get('imagine-stream-client');
const {LivePaintingQueue}=await get('live-painting');
const {DrawingLookahead}=await get('drawing-lookahead');
const {upsertVoiceEntry,appendTextEntry}=await get('conversation');
const {serializePaperConversations,restorePaperConversations}=await get('paper-conversation');
const {VoiceTranscriptIndex}=await get('transcript-omission');
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const base={title:'Forest',sky:'paper',ground:'none',weather:'clear',paper:{x:0,y:0,width:1000,height:640},objects:[{id:'old-tree',kind:'tree',x:100,y:400,scale:1,color:'#78aa77'}]};
const wolf={id:'wolf',kind:'drawing',x:0,y:0,scale:1,color:'#888888',label:'Wolf',marks:[{type:'path',d:'M 300 300 Q 340 250 390 300 Z',fill:'#888888'}]};
const preview={...base,objects:[...base.objects,wolf]};
function response(events){return new Response(events.map(e=>JSON.stringify(e)+'\n').join(''),{headers:{'Content-Type':'application/x-ndjson'}});}
function voiceFixture(texts){
 const index=new VoiceTranscriptIndex();
 const segments=texts.map((text,i)=>({id:`s${i}`,text}));
 const update={sessionId:'one',revision:1,stableText:texts.join(' '),partial:'',done:false,segments};
 index.observe(update);
 return{index,segments,update,entries:upsertVoiceEntry([],update)};
}

test('invalid final output rolls back the entire failed turn, preserving successful art and later words',async()=>{
 const f=voiceFixture(['Draw a tree.','Draw a wolf.','Draw a star.']);
 let shown=base;const history=[base];
 const invalid={...preview,objects:[...base.objects,{...wolf,marks:[...wolf.marks,{type:'path',d:'<script>bad</script>'}]}]};
 await assert.rejects(readImagineResponse(response([{type:'preview',scene:preview},{type:'complete',result:{scene:invalid,message:'Done',action:'update'}}]),{onPreview:s=>shown=s}));
 assert.equal(shown.objects.length,2,'real provisional geometry was shown before the failure');
 const rollback=rollbackDrawingTurn(history.at(-1),f.entries,f.index.validTargets(f.index.targets([f.segments[1]])));
 shown=rollback.scene;
 assert.strictEqual(shown,base);assert.equal(history.length,1,'failed work is never committed to undo history');
 assert.equal(rollback.conversation[0].text.trim(),'Draw a tree.  Draw a star.');
 assert.ok(!rollback.conversation[0].text.includes('wolf'));
});

test('rollback of an edit restores prior color, placement and hand erasures without mutating history',()=>{
 const committed={...base,erasures:[{id:'rub',paths:['M10 10L20 20'],width:20,targets:[{key:'old-tree',x:100,y:400,scale:1}]}]};
 const saved=JSON.stringify(committed),f=voiceFixture(['Move it right and make it red.']);
 const rollback=rollbackDrawingTurn(committed,f.entries,f.index.targets(f.segments));
 assert.strictEqual(rollback.scene,committed);assert.equal(JSON.stringify(committed),saved);
 assert.equal(rollback.conversation[0].text,'');
});

test('omission targets only the failed repetition, survives cumulative updates and persists without deleted words',()=>{
 const f=voiceFixture(['Draw a ball.','Draw a ball.','Draw a star.']);
 const latest=upsertVoiceEntry(f.entries,{...f.update,revision:2,partial:'A little cloud'});
 let entries=rollbackDrawingTurn(base,latest,f.index.targets([f.segments[1]])).conversation;
 assert.equal(entries[0].text,'Draw a ball.  Draw a star.');assert.equal(entries[0].partial,'A little cloud');
 entries=upsertVoiceEntry(entries,{...f.update,revision:3,stableText:f.update.stableText+' Draw a cloud.',partial:'',done:true});
 assert.equal(entries[0].text,'Draw a ball.  Draw a star. Draw a cloud.');
 const raw=serializePaperConversations(new Map(), 'paper',entries,['paper']);
 const restored=restorePaperConversations(raw,[], 'paper').entries;
 assert.equal(restored[0].text,entries[0].text);assert.deepEqual(restored[0].omittedRanges,entries[0].omittedRanges);
 const reopened=upsertVoiceEntry(restored,{sessionId:'two',revision:1,stableText:'Draw a kite.',partial:'',done:false});
 assert.equal(reopened[0].text,entries[0].text);assert.equal(reopened[1].text,'Draw a kite.');
});

test('typed rollback removes only the matching typed entry and stale voice positions cannot erase new paper text',()=>{
 let entries=appendTextEntry([], 'Draw a tree.','tree');
 entries=appendTextEntry(entries,'Draw a wolf.','wolf');
 entries=appendTextEntry(entries,'Draw a star.','star');
 assert.deepEqual(rollbackDrawingTurn(base,entries,[],'wolf').conversation.map(e=>e.id),['tree','star']);
 const f=voiceFixture(['Draw a wolf.']),targets=f.index.targets(f.segments);f.index.reset();
 assert.deepEqual(rollbackDrawingTurn(base,entries,f.index.validTargets(targets)).conversation,entries);
});

for(const cause of [new DrawingFailure('bad geometry','turn'),new TypeError('network interruption'),new DrawingFailure('deadline','turn')]){
 test(`${cause.message}: next queued sentence runs once and never sees the failed scene or words`,async()=>{
  const gate=deferred(),f=voiceFixture(['Draw a wolf.','Draw a star.','Draw a cloud.']);
  let committed=base,shown=base,entries=f.entries;
  const calls=[],states=[],history=[base];
  const queue=new LivePaintingQueue(async(text,_signal,segments)=>{
   calls.push({text,scene:committed,history:history.slice()});
   if(text==='Draw a wolf.'){
    shown=preview;await gate.promise;
    const rollback=rollbackDrawingTurn(committed,entries,f.index.validTargets(f.index.targets(segments)));
    shown=rollback.scene;entries=rollback.conversation;
    throw new RolledBackDrawingFailure(ROLLED_BACK_DRAWING_MESSAGE,drawingFailureKind(cause));
   }
   assert.equal(committed.objects.some(o=>o.id==='wolf'),false);
   assert.ok(!entries[0].text.includes('wolf'));
  },s=>states.push(s),{maxSegmentsPerTurn:1});
  queue.add(f.segments);await tick();assert.strictEqual(shown,preview);gate.resolve();await tick();
  assert.deepEqual(calls.map(c=>c.text),f.segments.map(s=>s.text));
  assert.strictEqual(calls[1].scene,base);assert.strictEqual(shown,base);assert.equal(history.length,1);
  assert.ok(states.some(s=>s.error&&s.failureKind===drawingFailureKind(cause)&&!s.paused&&!s.failedText));
  assert.equal(queue.snapshot().error,'');assert.equal(queue.snapshot().pendingCount,0);
  queue.retry();queue.add(f.segments);await tick();assert.equal(calls.length,3);queue.cancel();
 });
}

test('a rolled-back service error cannot be retried on its own; new speech retires its notice',async()=>{
 const calls=[];const queue=new LivePaintingQueue(async text=>{calls.push(text);if(calls.length===1)throw new RolledBackDrawingFailure('cleared','service');},()=>{},{maxSegmentsPerTurn:1});
 queue.add([{id:'1',text:'first'}]);await tick();
 assert.equal(queue.snapshot().paused,false);assert.equal(queue.snapshot().failedText,'');
 queue.retry();await tick();assert.deepEqual(calls,['first']);
 queue.dismissTurnFailure();assert.equal(queue.snapshot().error,'');
 queue.add([{id:'2',text:'second'}]);await tick();assert.deepEqual(calls,['first','second']);assert.equal(queue.snapshot().failureKind,null);queue.cancel();
});

test('a stalled response hits the existing deadline and enters rollback rather than blocking the queue',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>new Promise(()=>{});
 try{
  const f=voiceFixture(['Draw a wolf.']);let failure;
  try{await requestImagine({text:f.segments[0].text},{onPreview:()=>{}},{firstPreviewMs:10,idleMs:10,totalMs:100});}catch(e){failure=e;}
  assert.ok(failure instanceof DrawingFailure);assert.equal(failure.kind,'turn');
  const rollback=rollbackDrawingTurn(base,f.entries,f.index.targets(f.segments));
  assert.strictEqual(rollback.scene,base);assert.equal(rollback.conversation[0].text,'');
 }finally{globalThis.fetch=previous;}
});

test('failed parent cancels its speculative descendant; the next idea prepares from committed artwork',async()=>{
 const ahead=new DrawingLookahead(),gate=deferred();let signal;
 const context={scene:preview,layout:[{id:'wolf',bounds:{x:300,y:250,width:90,height:50},anchors:[]}],instruction:'Draw a wolf.',recent:[]};
 ahead.start('Draw a star.',context,async(_text,_context,s)=>{signal=s;await gate.promise;return{action:'update',scene:preview,message:'Done'};});
 await tick();ahead.cancel();assert.ok(signal.aborted);
 gate.resolve();await tick();
 assert.equal(await ahead.take('Draw a star.',base,new AbortController().signal,()=>assert.fail('stale scene must never be displayed')),null);
 assert.equal(ahead.occupied,false);
});

test('cancelled queue ignores late failure instead of retaining a retry or blocking later input',async()=>{
 const gate=deferred(),states=[];
 const queue=new LivePaintingQueue(async()=>{await gate.promise;throw new RolledBackDrawingFailure('cleared','turn');},s=>states.push(s));
 queue.add([{id:'1',text:'old paper'}]);await tick();queue.cancel();gate.resolve();await tick();
 assert.equal(queue.snapshot().error,'');assert.equal(queue.snapshot().painting,false);assert.equal(queue.snapshot().failedText,'');
});

test('failure diagnostics do not include speech or provider exception messages',()=>{
 assert.deepEqual(drawingFailureDiagnostic(new Error('Layout bounds or anchors exceed the current paper')),{reason:'off_paper_layout',issueCount:0});
 const privateText='sensitive speech and provider credentials';
 assert.ok(!JSON.stringify(drawingFailureDiagnostic(new Error(privateText))).includes(privateText));
 assert.deepEqual(drawingFailureDiagnostic({issues:[{path:['additions',0,'marks',2,'d'],message:privateText}]}),{reason:'invalid_geometry',issueCount:1});
});
