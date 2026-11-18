'use client';
import {Mic} from 'lucide-react';
import {useEffect,useRef} from 'react';
import {useLanguage} from './LanguageProvider';
import type {demoAt} from '../lib/demo-timeline';
import './demo-transcript.css';
export function DemoTranscript({started,speaking,lines,silentFallback}:{started:boolean;silentFallback:boolean}&Pick<ReturnType<typeof demoAt>,'speaking'|'lines'>){
 const {language}=useLanguage(),zh=language==='zh',scroller=useRef<HTMLDivElement>(null);
 const content=lines.map(line=>line.text).join(' ');
 useEffect(()=>{if(scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;},[content]);
 return <div className="demo-transcript" data-demo-speaking={started&&speaking}>
  <div className="demo-voice"><Mic size={18}/><span>{zh?'连续旁白示范':'Continuous voice demo'}</span><i aria-hidden="true"><b/><b/><b/><b/></i></div>
  <div className="demo-words" ref={scroller} role="log" aria-label={zh?'连续出现的旁白':'Growing narration'} aria-live="off">{!started?<span className="demo-invite">{zh?'听一句新想法，画笔不用停。':'The story keeps going. So do the painters.'}</span>:lines.map(line=><span key={line.index} data-speaking={line.active}>{line.text}{' '}</span>)}</div>
  {silentFallback&&<small>{zh?'旁白暂不可用，文字演示会继续。':'Narration is unavailable. The text demo continues.'}</small>}
 </div>;
}
