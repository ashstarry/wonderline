import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const temporary=new URL('../.sites-runtime/waiting-feedback-test.mjs',import.meta.url);
await mkdir(new URL('../.sites-runtime/',import.meta.url),{recursive:true});
const compiled=await build({stdin:{contents:"export {default as VoiceControls} from './components/VoiceControls'; export {LanguageProvider} from './components/LanguageProvider'; export {default as PaperResponse} from './components/PaperResponse';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,packages:'external',platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},write:false});
await writeFile(temporary,compiled.outputFiles[0].text);
const {VoiceControls,PaperResponse,LanguageProvider}=await import(temporary.href);after(()=>unlink(temporary));
const voice=(state,brushState)=>renderToStaticMarkup(createElement(LanguageProvider,{initialLanguage:'zh'},createElement(VoiceControls,{state,brushState,seconds:12,disabled:false,canCancel:true,onToggle(){},onCancel(){}})));
test('waiting with an open microphone is visible without changing its stop control',()=>{
 const html=voice('listening','preparing');
 assert.ok(html.includes('想一想，马上落笔'));
 assert.ok(html.includes('麦克风还开着，可以接着说'));
 assert.ok(html.includes('aria-label="停止说话，画完已听到的内容"'));
 assert.ok(html.includes('aria-pressed="true"'));
 assert.ok(html.includes('voice-controls__stop'));
 assert.ok(html.includes('voice-controls__thinking-orbit'));
});
test('real drawing and idle listening remove preparation feedback',()=>{
 for(const state of ['drawing','listening']){
  const html=voice(state,'drawing');assert.ok(!html.includes('想一想，马上落笔'));assert.ok(!html.includes('voice-controls__thinking-orbit'));
 }
});
test('waiting after microphone stop never claims the microphone is still listening',()=>{
 const html=voice('drawing','preparing');assert.ok(html.includes('想法收到了，正在安排这一笔'));assert.ok(!html.includes('麦克风还开着'));assert.ok(!html.includes('voice-controls__stop'));
});
test('paper response is decorative, pointer-free by design, and has a reduced-motion state',()=>{
 const html=renderToStaticMarkup(createElement(PaperResponse,{state:'preparing',medium:'watercolor',reducedMotion:true}));
 assert.ok(html.includes('data-state="preparing"'));assert.ok(html.includes('data-still="true"'));assert.ok(html.includes('aria-hidden="true"'));assert.ok(html.includes('paper-response__trail'));assert.ok(!html.includes('<button'));
});

test('new thinking remains visible during an earlier drawing without changing the live microphone control',()=>{
 const html=voice('listening','thinking-drawing');
 assert.ok(html.includes('一边画，一边想下一笔'));
 assert.ok(html.includes('新想法正在安排，继续说就好'));
 assert.ok(html.includes('voice-controls__thinking-orbit'));
 assert.ok(html.includes('aria-label="停止说话，画完已听到的内容"'));
 const stopped=voice('drawing','thinking-drawing');
 assert.ok(stopped.includes('小画家还在画，下一笔也在准备'));
 assert.ok(!stopped.includes('继续说就好'));
});
