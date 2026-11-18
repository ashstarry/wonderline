import type { ChineseVoiceStats } from './chinese-voice-activity';
const RATE=16000,FRAME=512,ENERGY_FRAME=320,MIN_ACTIVE=960,PAUSE=8000;
export interface VoiceProbabilityEngine { process(samples:Float32Array):number; release():void; }
export interface ChineseAcousticActivity {
 readonly preRollSamples:number;
 readonly runtimeInfo?:{moduleCold:boolean;modelReused:boolean};
 feed(pcm:Int16Array):void;
 finish():void;
 stats(start:number,end:number):ChineseVoiceStats;
 close():void;
 summary():{engine:string;frames:number;speechFrames:number;maxProbability:number;receivedMs:number};
}
type Frame={start:number;end:number;positive:boolean};
/** Neural speech admission plus the release's 20ms energy/silence timing.
 * Original PCM and transcript content are never rewritten. */
export class ChineseNeuralActivity implements ChineseAcousticActivity {
 readonly preRollSamples=6400;
 private pending=new Float32Array(FRAME);
 private used=0;private received=0;private processed=0;private closed=false;private finished=false;
 private energySum=0;private energySquares=0;private energyUsed=0;private energyEnd=0;
 private history:Frame[]=[];private energy:Frame[]=[];private frames=0;private speechFrames=0;private maxProbability=0;
 constructor(private engine:VoiceProbabilityEngine,private threshold=.5){}
 feed(pcm:Int16Array){
  if(this.closed||this.finished)return;
  for(let offset=0;offset<pcm.length;){const count=Math.min(FRAME-this.used,pcm.length-offset);for(let i=0;i<count;i++){const value=pcm[offset+i];this.pending[this.used+i]=value/32768;this.energySum+=value;this.energySquares+=value*value;this.energyUsed++;if(this.energyUsed===ENERGY_FRAME)this.recordEnergy();}this.used+=count;this.received+=count;offset+=count;if(this.used===FRAME)this.process(FRAME);}
  const cutoff=this.received-32*RATE;
  for(const list of [this.history,this.energy]){let n=0;while(n<list.length&&list[n].end<cutoff)n++;if(n)list.splice(0,n);}
 }
 private recordEnergy(){
  const count=this.energyUsed,mean=this.energySum/count;
  const rms=Math.sqrt(Math.max(0,this.energySquares/count-mean*mean))/32768;
  this.energy.push({start:this.energyEnd,end:this.energyEnd+count,positive:rms>.0035});this.energyEnd+=count;
  this.energyUsed=0;this.energySum=0;this.energySquares=0;
 }
 private process(count:number){
  const probability=this.engine.process(this.pending);
  if(!Number.isFinite(probability)||probability<0||probability>1)throw Error('Invalid voice probability');
  const positive=probability>=this.threshold;
  this.history.push({start:this.processed,end:this.processed+count,positive});this.processed+=count;
  this.frames++;if(positive)this.speechFrames++;this.maxProbability=Math.max(this.maxProbability,probability);
  this.pending.fill(0);this.used=0;
 }
 finish(){if(this.closed||this.finished)return;this.finished=true;if(this.used)this.process(this.used);if(this.energyUsed)this.recordEnergy();}
 stats(start:number,end:number):ChineseVoiceStats{
  if(end<=start)return{voiced:false,silence:0};
  let voiced=false,active=0,quiet=0,lastActive=-1,firstPauseEnd:number|undefined,evaluatedEnd=start,ni=0;
  for(const f of this.energy){if(f.end<=start)continue;if(f.start>=end)break;const left=Math.max(f.start,start),right=Math.min(f.end,end),count=right-left;if(count<=0)continue;
   let positive=false;
   if(f.positive){
    while(ni<this.history.length&&this.history[ni].end<=left)ni++;
    for(let j=ni;j<this.history.length&&this.history[j].start<right;j++)if(this.history[j].positive){positive=true;break;}
    // Never decide an audible, not-yet-classified tail is silence. Real quiet
    // can be recognized immediately, without neural hangover delaying a pause.
    if(!positive&&right>this.processed)break;
   }
   evaluatedEnd=right;
   if(positive){active+=count;quiet=0;lastActive=right;if(active>=MIN_ACTIVE)voiced=true;}
   else{active=0;quiet+=count;if(voiced&&quiet>=PAUSE&&firstPauseEnd===undefined)firstPauseEnd=right-(quiet-PAUSE)-start;}
  }
  return{voiced,silence:!voiced||lastActive<0?(end-start)/RATE:Math.max(0,evaluatedEnd-lastActive)/RATE,...(firstPauseEnd===undefined?{}:{firstPauseEnd})};
 }
 summary(){return{engine:'silero-v6',frames:this.frames,speechFrames:this.speechFrames,maxProbability:Math.round(this.maxProbability*1000)/1000,receivedMs:Math.round(this.received/RATE*1000)};}
 close(){if(this.closed)return;this.closed=true;try{this.engine.release();}finally{this.pending.fill(0);this.history=[];this.energy=[];}}
}
