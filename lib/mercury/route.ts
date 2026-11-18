import type { DrawingTrace } from '../diagnostics';
import type { z } from 'zod';
import { imagineInputSchema } from '../scene-validation';
import { DEFAULT_PAPER } from '../paper-viewport';
import { requestsLettering } from '../drawing-text';
import { modelCanvasContext } from '../canvas-context-validation';
import { ApiError, jsonResponse, openRouterCompletion, openRouterStreamingCompletion } from '../openrouter';
import { drawingFailureKind, drawingFailureDiagnostic } from '../drawing-failure';
import { MERCURY_PROMPT, MERCURY_AHEAD, MERCURY_RECOVERY } from './prompt';
import { encodeScene } from './codec';
import { MercuryPreviewBuilder } from './preview';
import {mercuryIntent,mercuryIntentNote,mercurySchemaFor} from './contract';
import{mercuryPositions}from './geometry';
import { mercuryStreamResponse } from './response';
type Input=z.infer<typeof imagineInputSchema>;
export function mercuryRequest(input:Input){
 const paper=input.scene.paper??DEFAULT_PAPER,intent=mercuryIntent(input.text,!!input.lookahead);
 const context=modelCanvasContext(input.scene,input.canvasContext,input.clarification?`${input.clarification.instruction} ${input.text}`:input.text);
 return {temperature:.2,reasoning:{enabled:false},provider:{require_parameters:true},max_tokens:input.mode==='live'?9000:12000,
  messages:[{role:'system',content:MERCURY_PROMPT+(input.lookahead?'\n\n'+MERCURY_AHEAD:'')+(input.unfinished?.length?'\n\n'+MERCURY_RECOVERY:'')+'\n'+mercuryIntentNote(intent)},
   {role:'user',content:JSON.stringify({reply_language:input.language==='en'?'English':'简体中文',mode:input.mode,canvas_viewport:paper,coordinate_guide:{left:paper.x,right:paper.x+paper.width,top:paper.y,bottom:paper.y+paper.height,center_x:paper.x+paper.width/2,center_y:paper.y+paper.height/2},current_scene:encodeScene(input.scene),position_guide:Object.entries(mercuryPositions(input.scene,input.canvasContext)).map(([id,b])=>({id,left:b.x,top:b.y,width:b.width,height:b.height,center_x:b.x+b.width/2,center_y:b.y+b.height/2})),...(context?{canvas_context:context}:{}),...(input.lookahead?{parallel_reservations:input.lookahead}:{}),recent_instructions:input.recent??[],...(input.unfinished?.length?{unfinished_instructions:input.unfinished}:{}),clarification:input.clarification??null,instruction:input.text})}],
  response_format:{type:'json_schema',json_schema:{name:'mercury_patch',strict:true,schema:mercurySchemaFor(input.scene,intent)}},
 };
}
/** Called only after the ordinary route's authorization/input/content checks. */
export async function mercuryResponse(request:Request,input:Input,trace?:DrawingTrace){
 const positions=mercuryPositions(input.scene,input.canvasContext),intent=mercuryIntent(input.text,!!input.lookahead),body=mercuryRequest(input),allowText=requestsLettering(`${input.clarification?.instruction??''} ${input.text}`),model='inception/mercury-3';
 if(request.headers.get('accept')?.toLowerCase().split(',').some(value=>value.trim().split(';')[0]==='application/x-ndjson')){
  return mercuryStreamResponse(input.scene,signal=>openRouterStreamingCompletion(body,signal,model,trace),{allowText,intent,language:input.language,positions,trace,signal:request.signal,errorMessage:error=>error instanceof ApiError?error.message:'这一笔没接上，已有画面保留了，可以接着说。',errorKind:drawingFailureKind,onFailure:diagnostic=>console.warn('mercury_generation_failed',diagnostic)});
 }
 const content=await openRouterCompletion(body,request.signal,model,trace);trace?.firstContent();
 try{const parsed=new MercuryPreviewBuilder(input.scene,{allowText,intent,language:input.language,positions});parsed.push(content);const result=parsed.finish();trace?.complete(result);return jsonResponse(result);}
 catch(cause){trace?.failure(cause,'final_validation');console.warn('mercury_generation_failed',{stage:'final_validation',previews:0,...drawingFailureDiagnostic(cause)});throw new ApiError(502,'这一笔没接上，已有画面保留了，可以接着说。','turn');}
}
