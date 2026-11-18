import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const file=new URL('../.sites-runtime/ui-language-test.mjs',import.meta.url);
await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
const output=await build({stdin:{contents:"export * from './lib/ui-language'; export {LanguageProvider} from './components/LanguageProvider'; export {default as VoiceControls} from './components/VoiceControls'; export {imagineInputSchema} from './lib/scene-validation';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},define:{__WONDERLINE_PAGES__:'true'},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},write:false});
await writeFile(file,output.outputFiles[0].text);after(()=>unlink(file));
const {readLanguage,translateUi,VoiceControls,LanguageProvider,imagineInputSchema}=await import(file.href);
test('bilingual release defaults to English and restores an explicit Chinese preference',()=>{
 for(const value of [null,undefined,'','fr','EN',{},'en']) assert.equal(readLanguage(value),'en');
 assert.equal(readLanguage('zh'),'zh');
});
test('UI templates translate before inserting content; names and unknown text remain intact',()=>{
 assert.equal(translateUi('en','说的第 {n} 段',{n:3}),'Spoken idea 3');
 assert.equal(translateUi('zh','说的第 {n} 段',{n:3}),'说的第 3 段');
 assert.equal(translateUi('en','正在使用：{device}。停止后可切换。',{device:'宝宝的麦克风'}),'Using: 宝宝的麦克风. Stop recording to change it.');
 assert.equal(translateUi('en','我想要紫色的小龙，名字叫小小。'),'我想要紫色的小龙，名字叫小小。');
});
test('controls render in the chosen language and keep microphone interaction',()=>{
 const props={state:'listening',brushState:'thinking-drawing',seconds:12,disabled:false,canCancel:true,onToggle(){},onCancel(){}};
 for(const language of ['en','zh']){
  const html=renderToStaticMarkup(createElement(LanguageProvider,{initialLanguage:language},createElement(VoiceControls,props)));
  assert.ok(html.includes('aria-pressed="true"'));assert.ok(html.includes('voice-controls__stop'));assert.ok(html.includes('voice-controls__thinking-orbit'));
  assert.ok(html.includes(language==='en'?'Stop listening and finish drawing what was heard':'停止说话，画完已听到的内容'));
 }
 const idle=renderToStaticMarkup(createElement(VoiceControls,{...props,state:'idle',brushState:'resting'}));
 assert.ok(idle.includes('Keep talking while we draw. Your next idea doesn’t have to wait.'));assert.ok(!idle.includes('麦克风开一次'));
});
test('drawing requests accept only supported reply languages without rewriting the instruction',()=>{
 const base={text:'画一条小龙',scene:{title:'纸',sky:'paper',weather:'clear',ground:'none',objects:[]}};
 for(const language of ['en','zh']){const parsed=imagineInputSchema.parse({...base,language});assert.equal(parsed.language,language);assert.equal(parsed.text,base.text);assert.deepEqual(parsed.scene,base.scene);}
 assert.ok(imagineInputSchema.safeParse(base).success);assert.ok(!imagineInputSchema.safeParse({...base,language:'fr'}).success);
});
test('catch-up feedback follows the selected language and keeps the microphone stoppable',()=>{
 for(const language of ['en','zh']){
  const html=renderToStaticMarkup(createElement(LanguageProvider,{initialLanguage:language},createElement(VoiceControls,{state:'listening',catchingUp:true,seconds:9,disabled:false,canCancel:true,onToggle(){},onCancel(){}})));
  assert.ok(html.includes(language==='en'?'Catching up with your words':'正在跟上你的话'));
  assert.ok(html.includes('aria-pressed="true"'));assert.ok(html.includes('voice-controls__stop'));
 }
});
