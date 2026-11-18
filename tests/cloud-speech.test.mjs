import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {readFile,writeFile,unlink} from 'node:fs/promises';
const file=new URL('../.sites-runtime/cloud-speech-test.mjs',import.meta.url);
const built=await build({stdin:{contents:"export * from './lib/speech-budget';export * from './lib/qwen-events';export * from './lib/cloud-speech';export * from './lib/router-speech';",resolveDir:new URL('../',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
await writeFile(file,built.outputFiles[0].text);after(()=>unlink(file));
const api=await import(file.href);
const {reserveSpeech,settleSpeech,SPEECH_CAP,SPEECH_TEST_RESERVE,SPEECH_RESERVATION,SPEECH_BUDGET_ID,speechCharge,QwenTranscript,cloudSpeechConfig,speechWebSocket}=api;
test('ASR redirects never forward credentials and diagnostics exclude raw errors',async()=>{
 const original=globalThis.fetch,warn=console.warn;let request;const diagnostics=[];
 try {
  console.warn=()=>{};
  globalThis.fetch=async(url,init)=>{request={url,init};return new Response('',{status:302,headers:{Location:'https://untrusted.example'}});};
  await assert.rejects(api.transcribeRouter('private-test-key','microsoft/mai-transcribe-2',new Int16Array(6400),new AbortController().signal,d=>diagnostics.push(d)));
  assert.equal(request.url,'https://openrouter.ai/api/v1/audio/transcriptions');
  assert.equal(request.init.redirect,'manual');assert.equal(diagnostics[0].status,302);
  assert.equal(JSON.stringify(diagnostics).includes('private-test-key'),false);
 } finally {globalThis.fetch=original;console.warn=warn;}
});
test('every ASR route receives explicit English without adding a request or changing audio',async()=>{
 const original=globalThis.fetch, requests=[];
 try {
  globalThis.fetch=async(url,init)=>{requests.push(JSON.parse(init.body));return Response.json({text:'Draw a little brown puppy.'});};
  for(const model of api.ROUTER_ASR_MODELS)assert.equal(await api.transcribeRouter('test-only',model,new Int16Array(6400),new AbortController().signal),'Draw a little brown puppy.');
  assert.equal(requests.length,api.ROUTER_ASR_MODELS.length);
  for(const request of requests){assert.equal(request.language,'en');assert.equal(request.input_audio.format,'wav');assert.equal(Buffer.from(request.input_audio.data,'base64').length,12844);}
  assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',64000,'文字误识别',new Set(['microsoft/mai-transcribe-2'])),'elevenlabs/scribe-v2');
 } finally {globalThis.fetch=original;}
});
test('router charges every repeated window and keeps a hard session reservation',async()=>{
 const d=await database(),p=api.ROUTER_BUDGET;
 const {id}=await reserveSpeech(d.db,'router-user',p);
 assert.equal(d.sql.prepare('SELECT used FROM speech_budget WHERE id=?').get(p.id).used,p.tests+p.reserve);
 await settleSpeech(d.db,id,40,p);await settleSpeech(d.db,id,40,p);
 assert.equal(d.sql.prepare('SELECT used FROM speech_budget WHERE id=?').get(p.id).used,p.tests+3200);d.sql.close();
});
test('English uses MAI and short fragments cannot hit the Qwen timeout path',()=>{
 assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',64000,'Draw a mermaid.'),'microsoft/mai-transcribe-2');
 assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',64000,'画一条美人鱼'),'microsoft/mai-transcribe-2');
 assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',9600,'画一条美人鱼'),'microsoft/mai-transcribe-2');
 assert.equal(api.selectSpeechModel('qwen/qwen3-asr-1.7b',9600,''),'microsoft/mai-transcribe-2');
 assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',32000,'画一条美人鱼'),'microsoft/mai-transcribe-2');
 assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',64000,'画一条美人鱼',new Set(['qwen/qwen3-asr-1.7b'])),'microsoft/mai-transcribe-2');
 assert.equal(api.selectSpeechModel('microsoft/mai-transcribe-2',64000,'画一条美人鱼',new Set(api.ROUTER_ASR_MODELS)),undefined);
 assert.equal(api.routerSpeechConfig({OPENROUTER_API_KEY:'test',DB:{},CLOUD_ASR_ENABLED:'true'}).ready,true);
 assert.equal(api.routerSpeechConfig({OPENROUTER_API_KEY:'test',DB:{},CLOUD_ASR_ENABLED:'true',OPENROUTER_ASR_MODEL:'arbitrary-expensive-model'}).ready,false);
});
test('router gateway rejects cross-site and disabled requests before spending',async()=>{
 let calls=0;const env={DB:{prepare(){calls++;throw Error('must not run')}}};
 assert.equal((await api.routerSpeechWebSocket(new Request('https://studio.example/api/speech/realtime',{headers:{Upgrade:'websocket',Origin:'https://evil.example'}}),env,{})).status,403);
 assert.equal((await api.routerSpeechWebSocket(new Request('https://studio.example/api/speech/realtime',{headers:{Upgrade:'websocket',Origin:'https://studio.example'}}),env,{})).status,503);
 assert.equal(calls,0);
});
async function database(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0000_dapper_siren.sql','0001_yummy_maverick.sql']){
  // Use the actual migration SQL, including all constraints.
  sql.exec(await readFile(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 }
 const db={prepare(query){const statement={query,args:[],bind(...args){this.args=args;return this;},first(){return sql.prepare(query).get(...this.args)??null;},run(){return sql.prepare(query).run(...this.args);}};return statement;},batch(items){sql.exec('BEGIN');try{const result=items.map(x=>x.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 return {db,sql,used:()=>sql.prepare('SELECT used FROM speech_budget WHERE id=?').get(SPEECH_BUDGET_ID)?.used};
}
test('simultaneous reservations cannot exceed the lifetime cap and refunds apply only once',async()=>{
 const d=await database();d.sql.exec(`INSERT INTO speech_budget VALUES ('${SPEECH_BUDGET_ID}',${SPEECH_CAP-SPEECH_RESERVATION-1})`);
 const leases=await Promise.all(Array.from({length:8},(_,i)=>reserveSpeech(d.db,'guest-'+i)));
 const admitted=leases.filter(x=>x.id);assert.equal(admitted.length,1);assert.equal(d.used(),SPEECH_CAP-1);
 await Promise.all([settleSpeech(d.db,admitted[0].id,64000),settleSpeech(d.db,admitted[0].id,64000)]);
 assert.equal(d.used(),SPEECH_CAP-SPEECH_RESERVATION-1+speechCharge(64000));d.sql.close();
});
test('concurrency is bounded per visitor and globally; restarting retains spend',async()=>{
 const d=await database();const all=await Promise.all(Array.from({length:5},()=>reserveSpeech(d.db,'same')));
 assert.equal(all.filter(x=>x.id).length,2);assert.equal(d.used(),SPEECH_TEST_RESERVE+2*SPEECH_RESERVATION);
 for(let i=0;i<10;i++)await reserveSpeech(d.db,'visitor-'+i);
 assert.equal(d.sql.prepare('SELECT count(*) AS n FROM speech_lease WHERE settled=0').get().n,8);
 const before=d.used();d.sql.exec('UPDATE speech_lease SET expires=0');await reserveSpeech(d.db,'next-day');
 assert.equal(d.used(),before+SPEECH_RESERVATION,'expired leases do not refund unaccounted money');d.sql.close();
});
test('missing accounting fails closed and invalid upstreams are never accepted',async()=>{
 await assert.rejects(()=>reserveSpeech({prepare(){throw Error('DB unavailable')}},'guest'));
 for(const endpoint of ['http://127.0.0.1:8765','wss://evil.example/api-ws/v1/realtime','wss://ws-safe.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?key=bad']){
  assert.equal(cloudSpeechConfig({DASHSCOPE_API_KEY:'test',DASHSCOPE_REALTIME_URL:endpoint,DB:{},CLOUD_ASR_ENABLED:'true'}).ready,false);
 }
});
test('partial revisions replace the tail; final clauses commit once and survive later utterances',()=>{
 const transcript=new QwenTranscript('session');const type='conversation.item.input_audio_transcription.';
 assert.equal(transcript.consume({type:type+'text',item_id:'a',text:'画一条',stash:'鲸鱼'},0).partial,'画一条鲸鱼');
 assert.equal(transcript.consume({type:type+'text',item_id:'a',text:'画一条',stash:'美人鱼'},0).partial,'画一条美人鱼');
 const final=transcript.consume({type:type+'completed',item_id:'a',transcript:'画一条美人鱼。'},32000);
 assert.equal(final.segments.length,1);assert.equal(final.partial,'');
 assert.equal(transcript.consume({type:type+'completed',item_id:'a',transcript:'画一条美人鱼。'},32000).segments.length,0);
 const next=transcript.consume({type:type+'text',item_id:'b',stash:'右边有小鱼'},64000);
 assert.equal(next.stableText,'画一条美人鱼。');assert.equal(next.partial,'右边有小鱼');
 assert.equal(transcript.consume({type:'session.finished'},64000).done,true);
});
test('cross-site websocket and disabled cloud never reserve money or contact any upstream',async()=>{
 let calls=0;const env={DB:{prepare(){calls++;throw Error('should not run')}}};
 assert.equal((await speechWebSocket(new Request('https://studio.example/api/speech/realtime',{headers:{Upgrade:'websocket',Origin:'https://evil.example'}}),env,{})).status,403);
 assert.equal((await speechWebSocket(new Request('https://studio.example/api/speech/realtime',{headers:{Upgrade:'websocket',Origin:'https://studio.example'}}),env,{})).status,503);
 assert.equal(calls,0);
});
