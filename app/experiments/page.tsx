'use client';
import { studioPage } from '../../lib/studio-endpoint';
import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,Play,RotateCcw,Volume2,VolumeX} from 'lucide-react';
import SceneCanvas from '../../components/SceneCanvas';
import {useLanguage} from '../../components/LanguageProvider';
import {DemoTranscript} from '../../components/DemoTranscript';
import {useContinuousDemo} from '../../components/use-continuous-demo';
import {measureCanvasContext} from '../../components/canvas-context';
import {makeForegroundRoom} from '../../lib/scene-reframe';
import {experimentBlank,mountains,temple,dog,ufo} from '../../data/interaction-experiments';
import narration from '../../data/demo-narration.json';
import type {Scene} from '../../lib/scene';
import './studio.css';
export default function Experiments(){
 const {language}=useLanguage(),zh=language==='zh';
 const [scene,setScene]=useState<Scene>(experimentBlank),[reset,setReset]=useState(0),[step,setStep]=useState(-1),[sound,setSound]=useState(true),[drawing,setDrawing]=useState(false),[mode,setMode]=useState<'flow'|'space'>('flow');
 const root=useRef<HTMLDivElement>(null),sceneRef=useRef(scene);sceneRef.current=scene;
 const track=narration[mode==='space'?'reframe':'flow'][language];
 const demo=useContinuousDemo(track,index=>{
  const old=sceneRef.current;
  let next:Scene;
  if(index===0)next={...experimentBlank,objects:[mode==='flow'?{...mountains,x:192,y:3.6,scale:.61}:mountains]};
  else if(mode==='space'){
   const geometry=measureCanvasContext(root.current?.querySelector('svg')??null,old,'');
   const moved=geometry&&makeForegroundRoom(old,geometry);
   next={...(moved??old),objects:[...(moved??old).objects,temple]};
  }else next={...old,objects:[...old.objects,[temple,dog,ufo][index-1]]};
  sceneRef.current=next;setScene(next);
  setStep(index);
 },()=>{sceneRef.current=experimentBlank;setScene(experimentBlank);setReset(n=>n+1);setStep(-1);setDrawing(false);},sound);
 useEffect(()=>demo.reset(),[mode,language,demo.reset]);
 return <main className="experiment-page">
  <header><a href={studioPage("/")}><ArrowLeft size={18}/>{zh?'回到画室':'Back to the studio'}</a><span>Wonderline · {zh?'连续创作试验':'Stories in motion'}</span><button onClick={()=>setSound(v=>!v)} aria-label={zh?(sound?'关闭旁白声音':'开启旁白声音'):(sound?'Mute narration':'Unmute narration')} aria-pressed={sound}>{sound?<Volume2/>:<VolumeX/>}</button></header>
  <h1>{zh?'你接着说，画笔接着画。':'Keep talking. We’re already drawing.'}</h1><p className="experiment-intro">{zh?'不用等这一笔画完，下一个想象已经在路上。':'No need to wait for this stroke. The next idea is already on its way.'}</p>
  <div className="experiment-tabs"><button aria-pressed={mode==='flow'} onClick={()=>setMode('flow')}>{zh?'四个想法，接着来':'Keep the story flowing'}</button><button aria-pressed={mode==='space'} onClick={()=>setMode('space')}>{zh?'边讲边腾出空间':'Make room as we go'}</button></div>
  <div className="experiment-paper" ref={root} data-demo-step={step} data-demo-drawing={drawing} data-demo-pending={demo.pending}><SceneCanvas scene={scene} style="crayon" id="experiment-artwork" className="artwork" playbackResetKey={reset} playbackTurn={step+1} modelPending={demo.pending} onDrawingChange={setDrawing} motionMode="draw"/>{!demo.started&&<div className="experiment-start"><button className="primary" onClick={demo.start}><Play size={18}/>{zh?'看看边说边画':'Watch a continuous story'}</button></div>}</div>
  <section className="experiment-controls"><DemoTranscript {...demo}/>{demo.started&&<div><span className="experiment-status">{demo.speaking?(zh?'故事还在说，画笔还在画':'The story and the drawing keep going'):drawing?(zh?'画笔正在收尾':'The painters finish up'):(zh?'这一页画好了':'All done')}</span><button onClick={demo.start}><RotateCcw size={17}/>{zh?'重新看':'Replay'}</button></div>}</section>
  <p className="experiment-note">{zh?'录制旁白与固定笔迹的连续演示，不调用模型、不使用麦克风，也不会修改你的画；不代表真实模型延迟。':'Continuous replay of recorded narration and fixed artwork. No model calls or microphone; your drawings stay untouched. This is not a live model benchmark.'}</p>
 </main>;
}
