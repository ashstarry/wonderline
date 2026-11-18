import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import ts from 'typescript';
const dir=await mkdtemp(new URL('../.sites-runtime/pages-origin-',import.meta.url));
for(const name of ['studio-origin','studio-endpoint','speech-endpoint'])await writeFile(`${dir}/${name}.mjs`,ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:99,module:99}}).outputText.replace("'./studio-endpoint'","'./studio-endpoint.mjs'"));
const {PAGES_ORIGIN,isStudioRequest,pagesPreflight,pagesResponse}=await import(`${dir}/studio-origin.mjs`);
const req=(origin=PAGES_ORIGIN,path='/api/imagine',method='POST',extra={})=>new Request('https://cloud.example'+path,{method,headers:{origin,'sec-fetch-site':'cross-site',...extra}});
after(async()=>{delete globalThis.__WONDERLINE_PAGES__;delete globalThis.window;await rm(dir,{recursive:true,force:true});});
test('only the public Pages origin and supported routes are admitted',()=>{
 assert.ok(isStudioRequest(req(),true));assert.equal(isStudioRequest(req(),false),false);
 for(const origin of ['https://evil.example','https://ashstarry.github.io.evil.example','null'])assert.equal(isStudioRequest(req(origin),true),false);
 assert.equal(isStudioRequest(req(PAGES_ORIGIN,'/api/host/register'),true),false);
 assert.equal(isStudioRequest(new Request('https://cloud.example/api/speech/realtime'),true,true),false);
});
test('preflight allows JSON drawing without credentials or arbitrary headers',()=>{
 const response=pagesPreflight(req(PAGES_ORIGIN,'/api/imagine','OPTIONS',{'access-control-request-method':'POST','access-control-request-headers':'content-type,accept'}),true);
 assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),PAGES_ORIGIN);assert.equal(response.headers.get('access-control-allow-credentials'),null);
 assert.equal(pagesPreflight(req(PAGES_ORIGIN,'/api/imagine','OPTIONS',{'access-control-request-method':'POST','access-control-request-headers':'authorization'}),true).status,403);
});
test('CORS preserves drawing chunks before the stream is complete',async()=>{
 let controller;const stream=new ReadableStream({start(c){controller=c;}});
 const response=pagesResponse(req(),new Response(stream),true);const reader=response.body.getReader();
 controller.enqueue(new TextEncoder().encode('first stroke\n'));assert.equal(new TextDecoder().decode((await reader.read()).value),'first stroke\n');
 controller.enqueue(new TextEncoder().encode('second stroke\n'));controller.close();assert.equal(new TextDecoder().decode((await reader.read()).value),'second stroke\n');assert.ok((await reader.read()).done);
});
test('Pages speech uses only the fixed cloud gateway and rejects endpoint overrides',async()=>{
 globalThis.__WONDERLINE_PAGES__=true;globalThis.window={location:{origin:PAGES_ORIGIN}};
 const {speechEndpoint}=await import(`${dir}/speech-endpoint.mjs`);
 assert.equal(speechEndpoint('realtime'),'https://softspoken-paper-garden.dongyuanshun.chatgpt.site/api/speech/english');
 assert.throws(()=>speechEndpoint('realtime','http://127.0.0.1:8765/api/speech/realtime'));
 assert.throws(()=>speechEndpoint('realtime','https://evil.example/api/speech/realtime'));
});

test('owned custom domains use their own CORS origin and preserve streaming replies', async () => {
 for (const origin of ['https://wonderline.fun','https://www.wonderline.fun']) {
  for (const path of ['/api/status','/api/imagine','/api/speech/health','/api/speech/realtime','/api/speech/health-chinese','/api/speech/chinese']) {
   const request=req(origin,path);assert.equal(isStudioRequest(request,true),true);assert.equal(isStudioRequest(request,false),false);
   const preflight=pagesPreflight(req(origin,path,'OPTIONS',{'access-control-request-method':path==='/api/imagine'?'POST':'GET'}),true);
   assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
   assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
  }
  let controller;const stream=new ReadableStream({start(value){controller=value;}});
  const response=pagesResponse(req(origin),new Response(stream),true),reader=response.body.getReader();
  controller.enqueue(new TextEncoder().encode('first action'));assert.equal(new TextDecoder().decode((await reader.read()).value),'first action');
  assert.equal(response.headers.get('access-control-allow-origin'),origin);controller.close();assert.equal((await reader.read()).done,true);
 }
 for(const origin of ['http://wonderline.fun','https://wonderline.fun.evil.example','https://fakewonderline.fun','https://sub.wonderline.fun','null'])assert.equal(isStudioRequest(req(origin),true),false);
 assert.equal(isStudioRequest(req('https://wonderline.fun','/api/host/register'),true),false);
});

test('the same public bundle resolves links and assets at either the old path or custom domain root',async()=>{
 globalThis.__WONDERLINE_PAGES__=true;
 const {studioPage,studioAsset}=await import(`${dir}/studio-endpoint.mjs`);
 for(const hostname of ['wonderline.fun','www.wonderline.fun','ashstarry.github.io']){
  globalThis.window={location:{hostname,origin:'https://'+hostname}};
  const base=hostname==='ashstarry.github.io'?'/wonderline/':'/';
  assert.equal(studioPage('/'),base);assert.equal(studioPage('/examples'),base+'?view=examples');
  assert.equal(studioAsset('/fonts/LXGWMarkerGothic-Regular.ttf'),base+'LXGWMarkerGothic-Regular.ttf');
 }
});
