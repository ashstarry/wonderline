import type { Scene } from '../scene';
import {mercuryPatchSchema} from './codec';
export type MercuryIntent='normal'|'move'|'pose'|'ahead';
/** Narrow language cues only constrain edit mechanics; the model resolves target/position. */
export function mercuryIntent(text:string,ahead=false):MercuryIntent{
 if(ahead)return'ahead';
 if(/\b(draw|add|create|resize|scale|larger|smaller)\b|画(?!面|布|纸|笔|风|作)|添加|增加|再来|放大|缩小|变大|变小/i.test(text))return'normal';
 if(/\b(move|shift|relocate|drag)\b|移到|移去|移动|挪到|挪动|搬到|拖到|拉到/i.test(text))return'move';
 if(/\b(wave|waves|waving)\b|\b(raise|raises|lower|lowers|bend|bends)\b.{0,45}\b(hand|arm|leg|knee)s?\b|挥手|举起.{0,8}手|抬起.{0,8}[手脚腿]|放下.{0,8}手|弯曲.{0,8}[手脚腿]/i.test(text))return'pose';
 return'normal';
}
export function mercurySchemaFor(scene:Scene,intent:MercuryIntent){
 const schema=structuredClone(mercuryPatchSchema) as any,p=schema.properties,ids=scene.objects.map(o=>o.id),drawingIds=scene.objects.filter(o=>o.marks?.length).map(o=>o.id);
 p.message={type:'string',minLength:1,maxLength:160};
 if(ids.length){p.updates.items.properties.id={type:'string',enum:ids};p.removals.items={type:'string',enum:ids};p.additions.items.properties.place_before={anyOf:[{type:'string',enum:ids},{type:'null'}]};p.layer_moves.items.properties.id={type:'string',enum:ids};p.layer_moves.items.properties.before={anyOf:[{type:'string',enum:ids},{type:'null'}]};}else{p.updates.maxItems=0;p.removals.maxItems=0;p.layer_moves.maxItems=0;p.additions.items.properties.place_before={type:'null'};}
 if(drawingIds.length)p.mark_edits.items.properties.id={type:'string',enum:drawingIds};else p.mark_edits.maxItems=0;
 p.additions.items.properties.id={type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'};
 p.mark_edits.items.properties.start.minimum=0;p.mark_edits.items.properties.deleteCount.minimum=1;
 if(intent==='move'||intent==='pose'){
  for(const field of ['additions','removals','layer_moves'])p[field].maxItems=0;
  for(const field of ['sky','weather','ground','object_order'])p[field]={type:'null'};
  if(intent==='move'){p.mark_edits.maxItems=0;const u=p.updates.items;delete u.properties.x;delete u.properties.y;u.properties.center_x={type:['number','null']};u.properties.center_y={type:['number','null']};u.required=u.required.filter((k:string)=>k!=='x'&&k!=='y').concat(['center_x','center_y']);for(const k of ['scale','color','label','kind'])p.updates.items.properties[k]={type:'null'};}
  else p.updates.maxItems=0;
 }
 if(intent==='ahead'){
  p.additions.items.properties.place_before={type:'null'};
  for(const field of ['updates','mark_edits','removals','layer_moves'])p[field].maxItems=0;
  for(const field of ['sky','weather','ground','object_order'])p[field]={type:'null'};
 }
 return schema;
}
export function enforceMercuryContract(value:Record<string,unknown>,intent:MercuryIntent){
 const nonempty=(k:string)=>Array.isArray(value[k])&&(value[k] as unknown[]).length>0;
 if(intent==='normal')return;
 if(intent==='ahead'&&Array.isArray(value.additions)&&value.additions.some(o=>o&&typeof o==='object'&&(o as Record<string,unknown>).place_before!=null))throw Error('Ahead additions must append');
 const forbidden=intent==='ahead'?['updates','mark_edits','removals','layer_moves']:intent==='move'?['additions','mark_edits','removals','layer_moves']:['additions','updates','removals','layer_moves'];
 if(forbidden.some(nonempty)||['sky','weather','ground','object_order'].some(k=>value[k]!==null))throw Error('Mercury edit contract mismatch');
 if(intent==='move'&&Array.isArray(value.updates)&&value.updates.some(u=>u&&typeof u==='object'&&['scale','color','label','kind'].some(k=>(u as Record<string,unknown>)[k]!=null)))throw Error('A move must keep original geometry');
 if(intent==='move'&&Array.isArray(value.updates)&&value.updates.some(u=>!u||typeof u!=='object'||!('center_x' in u)||!('center_y' in u)||'x' in u||'y' in u))throw Error('A move requires a global target center');
}
export function mercuryIntentNote(intent:MercuryIntent){return intent==='move'?'This is MOVE ONLY. Resolve the existing object ID and desired global position, then set center_x/center_y to the desired GLOBAL visible center. The program calculates the translation; never output the current transform origin as the desired center. No new objects, replacement marks or removals.':intent==='pose'?'This is a POSE EDIT ONLY. Replace the affected original indexed marks with mark_edits. No new object IDs. Remove the old gesture in the same replacement, connect the new shoulder/elbow/hand and preserve all unrelated strokes.':intent==='ahead'?'This is APPEND ONLY. Existing objects and pending reservations are locked. No edits, removals or changes to scene/layer order.':'';}
