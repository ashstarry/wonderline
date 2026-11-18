'use client';
import { studioAsset } from '../lib/studio-endpoint';
import {useCallback,useEffect,useRef,useState} from 'react';
import {demoAt,type DemoTrack} from '../lib/demo-timeline';

/** Recorded narration demonstrates overlapping input and painting. No ASR or
 * model calls, and no dependence on the canvas's drawing/idle callback. */
export function useContinuousDemo(track:DemoTrack,onApply:(index:number)=>void,onReset:()=>void,sound:boolean){
 const [started,setStarted]=useState(false),[elapsed,setElapsed]=useState(0),[silentFallback,setSilentFallback]=useState(false);
 const audio=useRef<HTMLAudioElement|null>(null),frame=useRef(0),fallbackTimer=useRef<ReturnType<typeof setTimeout>|null>(null),run=useRef(0);
 const callbacks=useRef({onApply,onReset});callbacks.current={onApply,onReset};
 const dispose=useCallback(()=>{run.current++;cancelAnimationFrame(frame.current);if(fallbackTimer.current)clearTimeout(fallbackTimer.current);fallbackTimer.current=null;if(audio.current){audio.current.pause();audio.current.removeAttribute('src');audio.current.load();audio.current=null;}},[]);
 useEffect(()=>dispose,[dispose]);
 useEffect(()=>{if(audio.current)audio.current.muted=!sound;},[sound]);
 const reset=useCallback(()=>{dispose();setStarted(false);setElapsed(0);setSilentFallback(false);callbacks.current.onReset();},[dispose]);
 const start=useCallback(()=>{
  reset();setStarted(true);
  const token=run.current,player=new Audio(studioAsset(track.src));player.preload='auto';player.muted=!sound;audio.current=player;
  let applied=-1,clockOrigin=performance.now(),fallback=false;
  const useSilent=()=>{if(run.current!==token||fallback)return;fallback=true;clockOrigin=performance.now()-player.currentTime*1000;player.pause();setSilentFallback(true);};
  // If a browser cannot play narration, the same continuous timeline still runs.
  fallbackTimer.current=setTimeout(()=>{if(player.currentTime===0)useSilent();},3000);
  void player.play().then(()=>{if(run.current!==token||fallback)player.pause();}).catch(useSilent);
  player.onerror=useSilent;
  const tick=()=>{
   if(run.current!==token)return;
   const time=Math.min(track.duration,fallback?(performance.now()-clockOrigin)/1000:player.ended?track.duration:player.currentTime);
   const state=demoAt(track,time);setElapsed(time);
   while(applied<state.ready){applied++;callbacks.current.onApply(applied);}
   if(time<track.duration)frame.current=requestAnimationFrame(tick);
   else if(fallbackTimer.current){clearTimeout(fallbackTimer.current);fallbackTimer.current=null;}
  };
  frame.current=requestAnimationFrame(tick);
 },[reset,track,sound]);
 return {start,reset,started,elapsed,silentFallback,...demoAt(track,elapsed)};
}
