import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
const built=await build({stdin:{contents:"export*from'./lib/speech-hesitations';export{RollingSpeech}from'./lib/rolling-speech';export{ExperimentalRollingSpeech}from'./lib/experimental-rolling-speech';export{ChineseRollingSpeech}from'./lib/chinese-rolling-speech';export{ChineseNeuralActivity}from'./lib/chinese-neural-activity';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
const {stripStandaloneHesitations:strip,cleanExperimentalSpeech:clean,RollingSpeech,ExperimentalRollingSpeech,ChineseRollingSpeech,ChineseNeuralActivity}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const tick=()=>new Promise(r=>setImmediate(r));
const tone=(n=6400)=>Int16Array.from({length:n},(_,i)=>Math.round(Math.sin(i*.1)*1800));
for(const s of ['嗯。嗯。嗯。','嗯，啊，呃。','嗯嗯啊啊','Um. Uh. Hmm.','Ummm, uhhh.','um uh','[music] 嗯。 [sneezing]'])test(`hesitation-only emits nothing: ${s}`,()=>assert.equal(clean(s),''));
for(const [before,after] of [['Um, draw a cat. Uh, make it blue.','draw a cat. make it blue.'],['嗯，画一只猫。啊，改成小狗。','画一只猫。改成小狗。'],['Draw a cat. Um. No, make it a dog.','Draw a cat. No, make it a dog.'],['画一只猫。嗯。不是红色，要蓝色。','画一只猫。不是红色，要蓝色。']])test(`keeps instructions and corrections: ${before}`,()=>assert.equal(clean(before),after));
for(const s of ['umbrella','Draw a human.','Draw an umbrella in the universe.','嗯嗯熊站在啊宝旁边。','Draw a puppy named Um.','Write um, uh on a sign.','Draw a sign saying "Um, uh, hmm".','“嗯，啊，呃”','\'Um, uh, hmm\'.',"Let's draw a cat.",'Uh oh! The bear fell.','画一个打喷嚏的小熊。','No, make it green.','把球放到右上角。','um draw a cat','Draw um a cat.'])test(`preserves meaningful or ambiguous words: ${s}`,()=>assert.equal(strip(s),s));
test('cleanup is idempotent and bounded for long input',()=>{const s='嗯，画一只猫。Um, draw a dog. '.repeat(500);assert.equal(clean(clean(s)),clean(s));const t=performance.now();for(let i=0;i<1000;i++)clean('Um, uh, draw a cat. 嗯，画一只猫。');assert.ok(performance.now()-t<1000);});
async function run(Session,pattern){const calls=[],updates=[];let at=0;const s=new Session('parity',async pcm=>{calls.push({at,length:pcm.length,first:pcm[0],last:pcm.at(-1)});return 'Draw a cat. No, make it blue.'},u=>{const {elapsedMs,...value}=u;updates.push(value)},()=>assert.fail(),0);for(const p of pattern){at+=p.length;s.feed(p.buffer);await tick()}const liveCalls = [...calls];s.finish();for(let i=0;i<10&&!updates.at(-1)?.done;i++)await tick();assert.equal(updates.at(-1)?.done,true);return {liveCalls,updates};}
test('without a detector the isolated English implementation matches legacy live windows and transcript updates',async()=>{for(let trial=0;trial<12;trial++){const pattern=Array.from({length:trial+4},(_,i)=>i%4===3?new Int16Array(9600):tone(3200+(trial%3)*1600));assert.deepEqual(await run(ExperimentalRollingSpeech,pattern),await run(RollingSpeech,pattern));}});
test('English detector rejects noise before ASR and releases exactly once',async()=>{let calls=0,releases=0;const updates=[];const gate=new ChineseNeuralActivity({process(){return .01},release(){releases++}});const s=new ExperimentalRollingSpeech('noise',async()=>{calls++;return 'hallucination'},u=>updates.push(u),()=>assert.fail(),0,gate);for(let i=0;i<40;i++){s.feed(tone(3200).buffer);await tick()}s.finish();await tick();s.cancel();assert.equal(calls,0);assert.equal(releases,1);assert.equal(updates.at(-1).stableText,'');assert.equal(updates.at(-1).done,true);});
test('English processing/release failures clean up without blocking cancellation',()=>{for(const stage of ['processing','release']){let releases=0,errors=0;const seen=[];const gate=new ChineseNeuralActivity({process(){if(stage==='processing')throw Error('test');return .9},release(){releases++;if(stage==='release')throw Error('test')}});const s=new ExperimentalRollingSpeech('error',async()=>'',()=>{},()=>errors++,0,gate,v=>seen.push(v));if(stage==='processing')s.feed(tone().buffer);s.cancel();s.cancel();assert.equal(releases,1);assert.equal(errors,stage==='processing'?1:0);assert.deepEqual(seen,[stage]);}});
for(const Session of [ExperimentalRollingSpeech,ChineseRollingSpeech])test(`${Session.name}: fillers do not appear, later content and corrections still stream`,async()=>{const zh=Session===ChineseRollingSpeech,pending=[],updates=[];const s=new Session('cleanup',()=>new Promise(resolve=>pending.push(t=>resolve(clean(t)))),u=>updates.push(u),()=>assert.fail());const reply=async t=>{assert.ok(pending.length);pending.shift()(t);await tick()};s.feed(tone(9600).buffer);await reply(zh?'嗯。嗯。':'Um. Uh.');assert.equal(updates.at(-1).partial,'');s.feed(tone(9600).buffer);await reply(zh?'嗯，画一只猫。':'Um, draw a cat.');s.feed(tone(9600).buffer);await reply(zh?'嗯，画一只猫。呃，改成蓝色。':'Um, draw a cat. Uh, make it blue.');s.finish();if(zh)await reply('嗯，画一只猫。呃，改成蓝色。');else await tick();assert.equal(updates.at(-1).done,true);assert.equal(updates.at(-1).stableText,zh?'画一只猫。改成蓝色。':'draw a cat. make it blue.');});

for (const stopTiming of ['during inference', 'after preview', 'after more audio']) {
  test('English finalizes the last recognized audio once: ' + stopTiming, async () => {
    const pending = [], sizes = [], updates = [];
    const speech = new ExperimentalRollingSpeech('stop-test', pcm => {
      sizes.push(pcm.length);
      return new Promise(resolve => pending.push(resolve));
    }, update => updates.push(update), () => assert.fail('recognition failed'));
    speech.feed(tone(6400).buffer);
    if (stopTiming === 'after preview') {
      pending.shift()('Draw a puppy.');
      await tick();
    } else if (stopTiming === 'after more audio') {
      speech.feed(tone(800).buffer);
    }
    speech.finish();
    pending.shift()?.('Draw a puppy.');
    await tick();
    if (stopTiming === 'after more audio') {
      assert.deepEqual(sizes, [6400, 7200]);
      pending.shift()('Draw a puppy in red.');
      await tick();
    } else {
      assert.deepEqual(sizes, [6400]);
    }
    const expected = stopTiming === 'after more audio' ? 'Draw a puppy in red.' : 'Draw a puppy.';
    assert.deepEqual(updates.flatMap(update => update.segments.map(segment => segment.text)), [expected]);
    assert.equal(updates.at(-1).stableText, expected);
    assert.equal(updates.filter(update => update.done).length, 1);
  });
}
