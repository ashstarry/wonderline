import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import ts from 'typescript';
const file=new URL('../.sites-runtime/drawing-sounds-test.mjs',import.meta.url);
await writeFile(file,ts.transpileModule(await readFile(new URL('../components/drawing-sounds.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);
const {DrawingSounds,workshopTouchCue,soundWorkshopCue}=await import(file.href);after(()=>unlink(file));
function fixture(){
 const listeners=new Map(),created=[];
 const oldWindow=globalThis.window,OldAudio=globalThis.AudioContext;
 const param=()=>({value:0,events:[],setValueAtTime(value,at){this.events.push({value,at});},linearRampToValueAtTime(value,at){this.events.push({value,at});},exponentialRampToValueAtTime(value,at){this.events.push({value,at});},setTargetAtTime(value){this.value=value;}});
 const node=()=>({gain:param(),frequency:param(),pan:param(),connect(){},disconnect(){this.disconnected=true;},start(at){this.starts=at;},stop(at){this.ends=at??0;}});
 class Context{currentTime=1;state='suspended';sampleRate=48000;destination={};voices=[];gains=[];constructor(){created.push(this);}createGain(){const n=node();this.gains.push(n);return n;}createOscillator(){const n=node();this.voices.push(n);return n;}createStereoPanner(){return node();}async resume(){this.state='running';}async close(){this.state='closed';}advance(time){this.currentTime=time;for(const voice of this.voices)if(!voice.disconnected&&voice.ends<=time)voice.onended?.();}}
 globalThis.window={addEventListener(name,callback){listeners.set(name,callback);},removeEventListener(name){listeners.delete(name);}};globalThis.AudioContext=Context;
 return{listeners,created,Context,restore(){globalThis.window=oldWindow;globalThis.AudioContext=OldAudio;}};
}
test('audio unlocks only on a gesture; muting cancels delayed cues and disposal cleans listeners',async()=>{
 const f=fixture();try{
  const sounds=new DrawingSounds();sounds.setEnabled(true);sounds.begin('outline','house');assert.equal(f.created.length,0);
  f.listeners.get('pointerdown')();const ctx=f.created[0];sounds.begin('outline','house');assert.ok(ctx.voices.length>0);
  await sounds.preview();await Promise.resolve();const count=ctx.voices.length;
  sounds.setEnabled(false);assert.equal(ctx.gains[0].gain.value,0);assert.ok(ctx.voices.every(v=>v.ends===0),'future preview notes stop immediately');
  sounds.begin('outline','tree');sounds.touch('wash');sounds.finish('tree');assert.equal(ctx.voices.length,count);
  sounds.dispose();assert.equal(ctx.state,'closed');assert.equal(f.listeners.size,0);
 }finally{f.restore();}
});
test('three painters share a sparse cue budget and never retrigger identical start or finish cues',()=>{
 const f=fixture();try{
  const sounds=new DrawingSounds();sounds.setEnabled(true);f.listeners.get('pointerdown')();const ctx=f.created[0];
  sounds.begin('outline','mermaid','0');const start=ctx.voices.length;
  sounds.begin('outline','mermaid','0');sounds.begin('outline','fish','1');sounds.begin('outline','sun','2');assert.equal(ctx.voices.length,start,'simultaneous starts merge');
  ctx.advance(2);sounds.touch('pen',0);const touch=ctx.voices.length;sounds.touch('wash',1);sounds.touch('wash',2);assert.equal(ctx.voices.length,touch,'global rather than per-painter limit');
  ctx.advance(4);sounds.finish('mermaid');const finish=ctx.voices.length;sounds.finish('mermaid');sounds.finish('fish');assert.equal(ctx.voices.length,finish);
  for(let i=0;i<60;i++){ctx.advance(4+i*.1);sounds.touch(i%2?'wash':'pen',i%3);}
  assert.ok(ctx.voices.length-finish<35,'busy 6-second passage still leaves many rests');
  assert.ok(ctx.voices.filter(v=>!v.disconnected).length<=18,'bounded polyphony');
  sounds.reset();assert.ok(ctx.voices.every(v=>v.disconnected||v.ends===0));sounds.dispose();
 }finally{f.restore();}
});
test('microphone activity lowers the mix without toggling the sound preference',()=>{
 const f=fixture();try{
  const sounds=new DrawingSounds();sounds.setEnabled(true);f.listeners.get('pointerdown')();const ctx=f.created[0],normal=ctx.gains[0].gain.value;
  sounds.setQuiet(true);assert.ok(ctx.gains[0].gain.value>0&&ctx.gains[0].gain.value<normal);
  sounds.setQuiet(false);assert.equal(ctx.gains[0].gain.value,normal);
  sounds.setEnabled(false);sounds.setQuiet(true);assert.equal(ctx.gains[0].gain.value,0);sounds.dispose();
 }finally{f.restore();}
});
test('tools have distinct timbres and a varied, gentle pitch palette without audio files or noise loops',()=>{
 const cues=Array.from({length:12},(_,i)=>workshopTouchCue('pen','crayon',i));
 assert.ok(new Set(cues.map(c=>c.frequency)).size>=5);assert.ok(new Set(cues.map(c=>c.timbre)).size>=2);
 assert.equal(workshopTouchCue('pen','pencil',1).timbre,'pluck');
 assert.equal(workshopTouchCue('wash','watercolor',1).timbre,'bell');
 assert.equal(workshopTouchCue('eraser','crayon',1).timbre,'wood');
 for(const cue of cues)assert.ok(cue.volume<=.09&&cue.duration<=.32&&cue.frequency>=250&&cue.frequency<900);
 const f=fixture();try{
  const ctx=new f.Context();let ended=0;const stop=soundWorkshopCue(ctx,ctx.destination,{timbre:'drop',frequency:440,volume:.07,duration:.16,delay:.2},()=>ended++);
  assert.ok(ctx.voices.every(v=>v.starts===1.2&&v.ends>v.starts));ctx.advance(2);assert.equal(ended,1);assert.ok(ctx.voices.every(v=>v.disconnected));stop();
 }finally{f.restore();}
});
test('preview is explicit, short, and repeated clicks do not pile up little orchestras',async()=>{
 const f=fixture();try{
  const sounds=new DrawingSounds();sounds.setEnabled(true);f.listeners.get('pointerdown')();const ctx=f.created[0];
  sounds.preview();await Promise.resolve();const count=ctx.voices.length;assert.ok(count>=10);
  sounds.preview();await Promise.resolve();assert.equal(ctx.voices.length,count);
  assert.ok(Math.max(...ctx.voices.map(v=>v.ends))-ctx.currentTime<1.6);
  sounds.reset();ctx.advance(3);sounds.setStyle('watercolor');sounds.touch('wash');assert.ok(ctx.voices.length>count);sounds.dispose();
 }finally{f.restore();}
});
