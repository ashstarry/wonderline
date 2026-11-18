import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFile,unlink,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const file=new URL(`../.sites-runtime/object-selection-actions-${process.pid}.mjs`,import.meta.url);
await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
const compiled=await build({stdin:{contents:"export {companionActionPosition,ObjectCompanionAction,COMPANION_ACTION_WIDTH,COMPANION_ACTION_HEIGHT,companionActionWidth} from './components/ObjectTransformLayer';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,packages:'external',platform:'node',format:'esm',write:false,loader:{'.css':'empty'}});
await writeFile(file,compiled.outputFiles[0].text);after(()=>unlink(file));
const {companionActionPosition,ObjectCompanionAction,COMPANION_ACTION_WIDTH,COMPANION_ACTION_HEIGHT,companionActionWidth}=await import(file.href);
const paper={x:0,y:0,width:1000,height:640};
const box={x:270,y:205,width:150,height:90};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
function assertSeparate(rect,box,paper,scale){
 assert.ok(rect,'an accessible position fits the paper');
 assert.ok(rect.x>=paper.x+8/scale&&rect.y>=paper.y+8/scale);
 assert.ok(rect.x+rect.width<=paper.x+paper.width-8/scale+.00001);
 assert.ok(rect.y+rect.height<=paper.y+paper.height-8/scale+.00001);
 const handles=[{x:box.x+box.width+5/scale,y:box.y-5/scale},{x:clamp(box.x+box.width+5/scale,paper.x+12/scale,paper.x+paper.width-12/scale),y:clamp(box.y+box.height+5/scale,paper.y+12/scale,paper.y+paper.height-12/scale)}];
 for(const h of handles)assert.ok(Math.hypot(h.x-clamp(h.x,rect.x,rect.x+rect.width),h.y-clamp(h.y,rect.y,rect.y+rect.height))>=26/scale-.00001,'touch area must not overlap delete or resize');
}
test('selected-character action attaches near the frame with a readable 44px button',()=>{
 assert.equal(COMPANION_ACTION_HEIGHT,44);
 const rect=companionActionPosition(box,paper,1,COMPANION_ACTION_WIDTH);
 assertSeparate(rect,box,paper,1);assert.equal(rect.y,box.y+box.height+5+6);assert.equal(rect.height,COMPANION_ACTION_HEIGHT);
 assert.deepEqual(box,{x:270,y:205,width:150,height:90});
});
test('corner and large objects keep the action onscreen and clear of the two controls',()=>{
 for(const scale of [.35,.6,1,2]){
  for(const box of [{x:0,y:0,width:120,height:160},{x:850,y:480,width:150,height:160},{x:0,y:480,width:150,height:160},{x:850,y:0,width:150,height:160},{x:0,y:0,width:1000,height:640},{x:490,y:300,width:20,height:20}]){
   const rect=companionActionPosition(box,paper,scale,COMPANION_ACTION_WIDTH);assertSeparate(rect,box,paper,scale);
   assert.ok(Math.abs(rect.height*scale-COMPANION_ACTION_HEIGHT)<.00001);assert.ok(Math.abs(rect.width*scale-COMPANION_ACTION_WIDTH)<.00001);
  }
 }
});
test('narrow and translated canvases preserve a usable label without overlapping handles',()=>{
 const phone={x:-120,y:-30,width:320,height:151};
 for(const box of [{x:-120,y:-30,width:320,height:151},{x:-50,y:35,width:40,height:60},{x:155,y:80,width:40,height:40}])assertSeparate(companionActionPosition(box,phone,1,COMPANION_ACTION_WIDTH),box,phone,1);
 assert.equal(companionActionPosition(box,{...paper,width:COMPANION_ACTION_WIDTH+15},1,COMPANION_ACTION_WIDTH),null);
});
test('action is one native labeled button in either language, not an icon-only command',()=>{
 for(const [language,label] of [['en','Save companion'],['zh','保存为伙伴']]){
  const html=renderToStaticMarkup(createElement('svg',null,createElement(ObjectCompanionAction,{id:'bear',language,position:companionActionPosition(box,paper,1,companionActionWidth(language)),screenScale:1,onKeep(){}})));
  assert.match(html,/<button type="button"/);assert.match(html,/aria-haspopup="dialog"/);assert.ok(html.includes(`aria-label="${label}"`));assert.match(html,/aria-describedby="save-companion-hint-bear"/);assert.match(html,/data-keep-companion="bear"/);
  assert.ok(html.includes(`object-companion-action__label">${label}</span>`));
  assert.ok(html.includes(language==='zh'?'下次画画还能用':'Use in another picture'));
  assert.equal((html.match(/<button /g)||[]).length,1);
 }
});
test('the contextual action stops drag and keyboard shortcuts without suppressing native activation',()=>{
 let saved=0,stopped=0,prevented=0;
 const tree=ObjectCompanionAction({id:'bear',language:'en',position:companionActionPosition(box,paper,1,COMPANION_ACTION_WIDTH),screenScale:1,onKeep(){saved++;}});
 const button=tree.props.children.props.children;
 const event={stopPropagation(){stopped++;},preventDefault(){prevented++;}};
 button.props.onPointerDown(event);assert.equal(saved,0);assert.equal(stopped,1);
 for(const key of [' ','Enter','Delete','Backspace']){button.props.onKeyDown({...event,key});button.props.onKeyUp({...event,key});}
 assert.equal(saved,0);assert.equal(prevented,0);assert.equal(stopped,9);
 button.props.onClick(event);assert.equal(saved,1);assert.equal(stopped,10);
});
