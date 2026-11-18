import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url).pathname;
async function bundle(pages){const r=await build({stdin:{contents:"export*from'./lib/studio-endpoint';export*from'./lib/speech-endpoint';export{requestImagine}from'./lib/imagine-stream-client';",resolveDir:root},bundle:true,platform:'node',format:'esm',define:{__WONDERLINE_PAGES__:String(pages)},write:false});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const scene={title:'Paper',sky:'paper',weather:'clear',ground:'none',objects:[]};
test('public opt-in routes requests to Mercury and back without changing paper, input, or ASR',async()=>{
 const api=await bundle(true),oldWindow=globalThis.window,oldFetch=globalThis.fetch,stored=new Map(),requests=[];
 globalThis.window={location:{origin:'https://wonderline.fun',search:'?draw-lab=mercury3'},sessionStorage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)}};
 globalThis.fetch=async(url,init)=>{requests.push({url,body:init.body});return Response.json({scene,action:'ignore',message:'Listening.'})};
 try{
  assert.equal(api.drawingExperimentEnabled(),false,'URL cannot silently opt public visitors in');
  const speech=api.speechEndpoint('realtime',undefined,'en'),chinese=api.speechEndpoint('realtime',undefined,'zh');
  const input={text:'Draw a cat.',scene,mode:'live'};
  for(const choice of [false,true,false]){
   api.chooseDrawingSpeed(choice);assert.equal(api.drawingExperimentEnabled(),choice);assert.equal(api.drawingPaperStorageKey('paper'),'paper');
   assert.equal(api.speechEndpoint('realtime',undefined,'en'),speech);assert.equal(api.speechEndpoint('realtime',undefined,'zh'),chinese);
   await api.requestImagine(input,{expectedScene:scene,onPreview(){}});
  }
  assert.ok(!requests[0].url.includes('?'));assert.ok(requests[1].url.endsWith('?draw-lab=mercury3'));assert.equal(requests[0].url,requests[2].url);
  assert.equal(requests[0].body,requests[1].body);assert.equal(requests[1].body,requests[2].body);assert.equal(requests.length,3);
 }finally{globalThis.window=oldWindow;globalThis.fetch=oldFetch}
});
test('Site keeps its existing Mercury paper when the model changes',async()=>{
 const api=await bundle(false),previous=globalThis.window;
 globalThis.window={location:{origin:'https://studio.chatgpt.site',search:''},get sessionStorage(){throw Error('unavailable')}};
 try{assert.equal(api.drawingExperimentEnabled(),true);const key=api.drawingPaperStorageKey('paper');api.chooseDrawingSpeed(false);assert.equal(api.drawingExperimentEnabled(),false);assert.equal(api.drawingPaperStorageKey('paper'),key);api.chooseDrawingSpeed(true);assert.equal(api.drawingPaperStorageKey('paper'),key)}finally{globalThis.window=previous}
});
