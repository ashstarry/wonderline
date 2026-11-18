'use client';
import {useEffect,useRef,useState} from 'react';
import {Wind} from 'lucide-react';
import {useLanguage} from './LanguageProvider';
import './drawing-speed-choice.css';

export default function DrawingSpeedChoice({quick,disabled,onChange}:{quick:boolean;disabled:boolean;onChange:(quick:boolean)=>void}) {
 const {language}=useLanguage(),zh=language==='zh';
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(e.target instanceof Node&&!root.current?.contains(e.target))setOpen(false)};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);trigger.current?.focus()}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape)}},[open]);
 return <div ref={root} className="drawing-speed-choice">
  <button ref={trigger} className={`drawing-speed-trigger${quick?' is-quick':''}`} type="button" aria-expanded={open} aria-controls="drawing-speed-options" onClick={()=>setOpen(v=>!v)}><Wind size={14} strokeWidth={1.6} aria-hidden="true"/><span>{quick?(zh?'快速模式':'Fast mode'):(zh?'更快开始画':'Draw sooner')}</span></button>
  {open&&<div className="drawing-speed-panel" id="drawing-speed-options" role="region" aria-label={zh?'生成速度':'Drawing response speed'}>
   <p className="drawing-speed-title">{zh?'更快开始画':'Start drawing sooner'}</p>
   <p>{zh?'更少等待，早点落笔；细节和位置可能不如默认模式准确。': 'Less waiting for the first stroke. Details and placement may be less accurate.'}</p>
   <button type="button" className="drawing-speed-switch" role="switch" aria-checked={quick} aria-label={zh?'快速模式':'Fast mode'} aria-describedby="drawing-speed-note" disabled={disabled} onClick={()=>{onChange(!quick);setOpen(false)}}><span>{zh?'快速模式':'Fast mode'}</span><span className={`drawing-speed-track${quick?' is-on':''}`} aria-hidden="true"><i/></span></button>
   <small id="drawing-speed-note">{disabled?(zh?'等说完、画完这一笔，就能切换。':'Switch once speaking and drawing have finished.'):(quick?(zh?'关掉即可回到默认模式。':'Turn off to return to the default mode.'):(zh?'默认模式更注重细节。':'The default mode favors detail.'))}</small>
  </div>}
 </div>;
}
