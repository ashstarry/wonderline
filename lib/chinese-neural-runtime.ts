import wasmModule from './vendor/fluidvad/fluidvad_bg.wasm?module';
import { initSync, FluidVad, VadOptions } from './vendor/fluidvad/fluidvad.js';
import { ChineseNeuralActivity } from './chinese-neural-activity';
let initialized=false;
const idle:FluidVad[]=[];
/** Lazy, server-only; no model download or extra API call during recording. */
export function createChineseNoiseGate(){
 const moduleCold=!initialized;
 if(!initialized){initSync({module:wasmModule});initialized=true;}
 let detector=idle.pop();
 const modelReused=!!detector;
 if(!detector){const options=new VadOptions();options.threshold=.5;options.minSpeechDuration=.064;options.minSilenceDuration=.5;options.speechPadding=.1;detector=new FluidVad(options);}
 detector.reset();const owned=detector;let released=false;
 return Object.assign(new ChineseNeuralActivity({
  process(frame){for(const event of owned.push(frame))event.free();return owned.lastProbability;},
  release(){if(released)return;released=true;try{owned.reset();}catch(error){try{owned.free();}catch{}throw error;}if(idle.length<2)idle.push(owned);else owned.free();},
 }),{runtimeInfo:{moduleCold,modelReused}});
}
