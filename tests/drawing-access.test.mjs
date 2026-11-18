import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const dir=await mkdtemp(new URL('../.sites-runtime/drawing-access-',import.meta.url));
for(const name of ['openrouter','openrouter-stream','request-rate-limit','drawing-model','drawing-failure','studio-origin']){
 const code=ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{target:99,module:99}}).outputText
  .replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'")
  .replace("from '../app/chatgpt-auth'","from './auth.mjs'");
 await writeFile(`${dir}/${name}.mjs`,code);
}
// Isolate request identity and Worker bindings; exercise the real authorization
// function and in-memory limiter without a network call or a model charge.
await writeFile(`${dir}/auth.mjs`,'export async function getChatGPTUser(){return globalThis.__drawingAccessUser??null;}');
await writeFile(`${dir}/speech-host.mjs`, `
 export async function hostingConfig(){return {publicAccess:globalThis.__drawingAccessPublic,db:{prepare(){throw Error('drawing must not consult persisted quotas');}}};}
 export async function visitorKey(){globalThis.__drawingIdentityReads++;return 'test-visitor';}
`);
const {authorizeRequest}=await import(pathToFileURL(`${dir}/openrouter.mjs`));
after(async()=>{delete globalThis.__drawingAccessUser;delete globalThis.__drawingAccessPublic;delete globalThis.__drawingIdentityReads;await rm(dir,{recursive:true,force:true});});
const request=(headers={})=>new Request('https://drawing.example/api/imagine',{method:'POST',headers:{origin:'https://drawing.example','sec-fetch-site':'same-origin',...headers}});

test('public drawing can exceed the old minute, visitor-day and whole-site limits without consulting quota storage',async()=>{
 globalThis.__drawingAccessPublic=true;globalThis.__drawingAccessUser=null;globalThis.__drawingIdentityReads=0;
 for(let i=0;i<1000;i++)await authorizeRequest(request(),'imagine');
 assert.equal(globalThis.__drawingIdentityReads,0,'drawing has no hidden per-visitor minute limiter');
});

test('signed-in testing also has unlimited drawing request counts',async()=>{
 globalThis.__drawingAccessPublic=false;globalThis.__drawingAccessUser={userId:'owner'};
 await Promise.all(Array.from({length:100},()=>authorizeRequest(request(),'imagine')));
});

test('unlimited drawing does not bypass private-site access or cross-site checks',async()=>{
 globalThis.__drawingAccessPublic=false;globalThis.__drawingAccessUser=null;
 await assert.rejects(authorizeRequest(request(),'imagine'),e=>e.status===401);
 globalThis.__drawingAccessPublic=true;
 await assert.rejects(authorizeRequest(request({'sec-fetch-site':'cross-site'}),'imagine'),e=>e.status===403);
 await assert.rejects(authorizeRequest(request({origin:'https://elsewhere.example'}),'imagine'),e=>e.status===403);
});

test('removing drawing quotas does not change the independent transcription limiter',async()=>{
 globalThis.__drawingAccessPublic=true;globalThis.__drawingAccessUser=null;
 for(let i=0;i<24;i++)await authorizeRequest(request(),'transcribe');
 await assert.rejects(authorizeRequest(request(),'transcribe'),e=>e.status===429);
 await authorizeRequest(request(),'imagine');
});
