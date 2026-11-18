'use client';
import { studioPage } from '../../lib/studio-endpoint';
import {useEffect,useState} from 'react';
import {ArrowLeft,RotateCcw,Play,Volume2,VolumeX} from 'lucide-react';
import {useLanguage} from '../../components/LanguageProvider';
import SceneCanvas from '../../components/SceneCanvas';
import {DemoTranscript} from '../../components/DemoTranscript';
import {useContinuousDemo} from '../../components/use-continuous-demo';
import narration from '../../data/demo-narration.json';
import examples from '../../data/drawing-examples.json';
import {STYLE_LABELS,type Scene,type ArtStyle} from '../../lib/scene';
import type {DemoTrack} from '../../lib/demo-timeline';
import './examples.css';
const blank:Scene={title:'想象从这里开始',sky:'paper',ground:'none',weather:'clear',objects:[],paper:{x:0,y:0,width:1000,height:640}};
export default function Examples(){
 const {t,language}=useLanguage(),zh=language==='zh';
 const [selected,setSelected]=useState(0),[step,setStep]=useState(-1),[scene,setScene]=useState(blank),[style,setStyle]=useState<ArtStyle>('crayon'),[paper,setPaper]=useState(0),[drawing,setDrawing]=useState(false),[sound,setSound]=useState(true);
 const current=examples[selected],speech=current.steps[step];
 const track=(narration as Record<string,Record<string,DemoTrack>>)[current.id][language];
 const demo=useContinuousDemo(track,index=>{setStep(index);setScene(current.steps[index].scene as Scene);},()=>{setStep(-1);setScene(blank);setPaper(v=>v+1);setDrawing(false);},sound);
 useEffect(()=>demo.reset(),[selected,style,language,demo.reset]);
 return <main className="examples-page">
  <header className="examples-header"><a href={studioPage("/")}><ArrowLeft size={18}/>{t('回到画室')}</a><div><span>Wonderline · {zh?'边说边画':'A story in motion'}</span><h1>{zh?'你接着说，画笔接着画。':'Keep talking. We’re already drawing.'}</h1><p>{zh?'上一件还在画，下一个想法就可以来了。':'Add your next idea while the picture is still growing.'}</p></div><button className="examples-sound" aria-label={zh?(sound?'关闭旁白声音':'开启旁白声音'):(sound?'Mute narration':'Unmute narration')} aria-pressed={sound} onClick={()=>setSound(v=>!v)}>{sound?<Volume2 size={19}/>:<VolumeX size={19}/>}</button></header>
  <div className="example-picker" role="group" aria-label={t('选择试画故事')}>{examples.map((item,index)=><button key={item.id} onClick={()=>setSelected(index)} aria-pressed={selected===index}>{t(item.title)}</button>)}</div>
  <section className="example-stage"><div className="example-stage-bar"><h2>{t(current.title)}</h2><div className="example-styles" role="group" aria-label={t('示例画风')}>{(['crayon','pencil','watercolor'] as const).map(m=><button key={m} aria-pressed={style===m} onClick={()=>setStyle(m)}>{t(STYLE_LABELS[m])}</button>)}</div></div>
   <div className="example-paper" data-demo-pending={demo.pending} data-demo-step={step} data-demo-drawing={drawing}><SceneCanvas scene={scene} style={style} id="example-artwork" className="artwork" playbackResetKey={paper} playbackTurn={step+1} modelPending={demo.pending} motionMode="draw" onDrawingChange={setDrawing}/>{!demo.started&&<div className="example-empty"><button onClick={demo.start}><Play size={18}/>{zh?'看看边说边画':'Watch a continuous story'}</button></div>}</div>
  </section>
  <div className="example-controls"><DemoTranscript {...demo}/><div className="example-buttons">{demo.started&&<><span className="demo-progress">{demo.speaking?(zh?'故事还在说，画笔还在画':'The story and the drawing keep going'):drawing?(zh?'故事说完了，画笔收个尾':'The story is told. The painters finish up.'):(zh?'再讲一个故事吧':'Ready for another story')}</span><button onClick={demo.start}><RotateCcw size={17}/>{t('重新看')}</button></>}</div></div>
  {speech?.action==='clarify'&&<p className="example-clarification" role="status">{t(speech.message)}</p>}
  <div className="example-notes"><p>{zh?'录制旁白与示例笔迹的连续回放，无需打开麦克风，不会改动你的画；不代表实时模型测速。':'Continuous replay of recorded narration and sample artwork. No microphone or changes to your drawing; this is not a live model benchmark.'}</p><a href={studioPage("/experiments")}>{zh?'试试：边讲边调整构图':'Try a story that makes room as it grows'}</a><details><summary>{t('看看这幅的观察结果')}</summary><p>{t(current.observation)}</p></details></div>
 </main>;
}
