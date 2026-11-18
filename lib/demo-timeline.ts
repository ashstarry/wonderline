export type DemoSegment = {text:string;start:number;end:number;cue:number;apply:number};
export type DemoTrack = {src:string;duration:number;segments:DemoSegment[]};

/** Speech owns the clock. Painting completion is deliberately not an input. */
export function demoAt(track:DemoTrack,time:number){
 const heard=track.segments.findLastIndex(segment=>time>=segment.start);
 const ready=track.segments.findLastIndex(segment=>time>=segment.apply);
 const pending=track.segments.some(segment=>time>=segment.cue&&time<segment.apply);
 const lines=track.segments.flatMap((segment,index)=>{
  if(time<segment.start)return [];
  const tokens=/\p{Script=Han}/u.test(segment.text)?Array.from(segment.text):segment.text.match(/\S+\s*/g)??[];
  const progress=Math.min(1,Math.max(0,(time-segment.start)/Math.max(.1,segment.end-segment.start)));
  return [{index,text:tokens.slice(0,Math.ceil(progress*tokens.length)).join(''),active:time<segment.end}];
 });
 return {heard,ready,pending,lines,speaking:time<track.duration};
}
