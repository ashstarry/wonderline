import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile,unlink} from 'node:fs/promises';
const file=new URL('../.sites-runtime/rolling-speech-test.mjs',import.meta.url);
const result=await build({entryPoints:[new URL('../lib/rolling-speech.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
await writeFile(file,result.outputFiles[0].text);after(()=>unlink(file));
const {RollingSpeech,stripCommitted,sharedClause,stripOverlap,pcmWav}=await import(file.href);
const tick=()=>new Promise(r=>setImmediate(r));
const voice=(seconds=.6)=>new Int16Array(Math.round(seconds*16000)).fill(1800).buffer;
test('audio received while inference is pending is coalesced, never dropped or queued behind painting',async()=>{
 const requests=[],updates=[];let active=0,peak=0;
 const s=new RollingSpeech('a',pcm=>{active++;peak=Math.max(peak,active);return new Promise(r=>requests.push({samples:pcm.length,resolve:text=>{active--;r(text)}}));},u=>updates.push(u),()=>assert.fail('recognition failed'));
 s.feed(voice());s.feed(voice());s.feed(voice());assert.equal(requests.length,1);
 requests[0].resolve('Draw a mermaid.');await tick();assert.equal(requests.length,2);assert.equal(requests[1].samples,28800);
 requests[1].resolve('Draw a mermaid. Add a goldfish.');await tick();assert.equal(peak,1);assert.equal(updates[1].segments[0].text,'Draw a mermaid.');
 s.cancel();
});
test('stop drains in-flight audio and commits the tail exactly once',async()=>{
 let resolve;const updates=[];
 const s=new RollingSpeech('stop',()=>new Promise(r=>resolve=r),u=>updates.push(u),()=>assert.fail());
 s.feed(voice());s.finish();resolve('Draw a whale.');await tick();resolve('Draw a whale.');await tick();
 assert.equal(updates.at(-1).done,true);assert.equal(updates.at(-1).stableText,'Draw a whale.');
 assert.equal(updates.flatMap(u=>u.segments).length,1);
});
test('cancel discards late ASR and stops additional paid requests',async()=>{
 let resolve,signal,calls=0;const updates=[];
 const s=new RollingSpeech('cancel',(_pcm,sig)=>{calls++;signal=sig;return new Promise(r=>resolve=r);},u=>updates.push(u),()=>assert.fail());
 s.feed(voice());s.cancel();resolve('Too late');s.feed(voice());await tick();assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(updates.length,0);
});
test('silence never calls ASR and finishing an empty session succeeds',()=>{
 const updates=[];const s=new RollingSpeech('quiet',()=>assert.fail('silence must not spend'),u=>updates.push(u),()=>assert.fail());
 for(let i=0;i<20;i++)s.feed(new ArrayBuffer(6400));s.finish();assert.equal(updates.at(-1).done,true);assert.equal(updates.at(-1).stableText,'');
});
test('pause boundary does not drop the following utterance that arrived during inference',async()=>{
 const pending=[],updates=[];
 const s=new RollingSpeech('pause',pcm=>new Promise(r=>pending.push({length:pcm.length,resolve:r})),u=>updates.push(u),()=>assert.fail());
 s.feed(voice());pending.shift().resolve('Draw a cat.');await tick();
 s.feed(new ArrayBuffer(16000));s.feed(voice());pending.shift().resolve('Draw a cat.');await tick();
 assert.equal(pending[0].length,9600);pending.shift().resolve('Add a dog.');await tick();s.finish();pending.shift().resolve('Add a dog.');await tick();
 assert.equal(updates.at(-1).stableText,'Draw a cat. Add a dog.');assert.equal(updates.flatMap(x=>x.segments).length,2);
});
test('prefix revisions and punctuation changes do not replay committed commands',()=>{
 assert.equal(sharedClause('画一条美人鱼。','画一条美人鱼，小鱼在旁边。'),'画一条美人鱼，');
 assert.equal(stripCommitted('Draw a mermaid, add a whale.','Draw a mermaid.'),'add a whale.');
 assert.equal(stripCommitted('Make her scarf red. Add a dog.','Make her scarve red.'),'Add a dog.');
});
test('WAV is little endian mono 16k PCM, with exact lengths',()=>{
 const b=pcmWav(new Int16Array([-32768,1234,32767]));const v=new DataView(b.buffer);
 assert.equal(b.length,50);assert.equal(v.getUint32(24,true),16000);assert.equal(v.getUint32(40,true),6);assert.equal(v.getInt16(44,true),-32768);
});
test('late internal punctuation releases a stable clause without trusting a new terminal period',()=>{
 assert.equal(sharedClause('Draw a mermaid add a','Draw a mermaid. Add a fish.'),'Draw a mermaid.');
 assert.equal(sharedClause('我想画一只蓝色鲸鱼慢慢游过','我想画一只蓝色鲸鱼，慢慢游过星云。'),'我想画一只蓝色鲸鱼，');
 assert.equal(sharedClause('Draw a','Draw a.'),'');
});
test('a revised word in the retained overlap cannot duplicate an old instruction',()=>{
 assert.equal(stripOverlap('银色的光芒旁边漂浮着一个粉色的棉花糖星球','小木屋的窗户发出金色的光芒旁边漂浮着一'),'个粉色的棉花糖星球');
 assert.equal(stripOverlap('再画一条鲸鱼','这里有一座房子'),'再画一条鲸鱼');
});
