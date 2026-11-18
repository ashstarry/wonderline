import { z } from 'zod';
import {mercuryPositions,type MercuryBounds} from './geometry';
import {moveObject} from '../object-transform';
import type { DrawingMark, Scene } from '../scene';
import { drawingMarkSchema, efficientPatchJsonSchema, scenePatchSchema } from '../scene-validation';
const expandHex=(v:unknown)=>typeof v==='string'&&/^#[0-9a-f]{3}$/i.test(v)?'#'+[...v.slice(1)].map(c=>c+c).join(''):v;
const marksSchema=structuredClone(efficientPatchJsonSchema.properties.additions.items.properties.marks.anyOf[0]);
// Clone before specialization: no schema object is ever mutated on Luna's path.
const p=structuredClone(efficientPatchJsonSchema.properties);
const updatesProperties=Object.fromEntries(Object.entries(p.updates.items.properties).filter(([k])=>k!=='marks'));
const editProperties={id:{type:'string'},start:{type:'integer'},deleteCount:{type:'integer'},marks:marksSchema};
const properties={...p,additions:{...p.additions,items:{...p.additions.items,required:[...p.additions.items.required.filter(k=>k!=='marks'),'place_before','marks'],properties:{...Object.fromEntries(Object.entries(p.additions.items.properties).filter(([k])=>k!=='marks')),kind:{type:'string',enum:['drawing']},place_before:{type:['string','null']},marks:marksSchema}}},updates:{type:'array',items:{type:'object',additionalProperties:false,properties:updatesProperties,required:Object.keys(updatesProperties)}},object_order:{type:'null'},layer_moves:{type:'array',items:{type:'object',additionalProperties:false,properties:{id:{type:'string'},before:{type:['string','null']}},required:['id','before']}},mark_edits:{type:'array',items:{type:'object',additionalProperties:false,properties:editProperties,required:Object.keys(editProperties)}}};
export const mercuryPatchSchema={type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
export function decodeMark(value:unknown):DrawingMark {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid drawing mark');
 const normalized=Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,k==='fill'||k==='stroke'?expandHex(v):v]));
 return drawingMarkSchema.parse(normalized);
}
export function encodeMark(mark:DrawingMark,index?:number){
 return{...(index===undefined?{}:{index}),...mark,fill:mark.fill??null,stroke:mark.stroke??null,strokeWidth:mark.strokeWidth??null,opacity:mark.opacity??null};
}
export function encodeScene(scene:Scene){return{...scene,objects:scene.objects.map(o=>({...o,...(o.marks?{marks:o.marks.map((m,index)=>({index,...m}))}:{})}))};}
export function decodeAddition(value:Record<string,unknown>,marks:unknown[]):Record<string,unknown>&{marks:DrawingMark[]}{const{place_before:_,...object}=value;return{...object,color:expandHex(value.color),marks:marks.map(decodeMark)};}
export function decodeUpdate(value:unknown,scene?:Scene,positions?:Record<string,MercuryBounds>){
 if(!value||typeof value!=='object'||Array.isArray(value)||'marks' in value)throw Error('Mercury updates cannot rewrite marks');
 if('center_x' in value||'center_y' in value){
  const {center_x,center_y,...rest}=value as Record<string,unknown>;if('x' in rest||'y' in rest)throw Error('Ambiguous move coordinates');
  const object=scene?.objects.find(o=>o.id===rest.id),box=object&&(positions??mercuryPositions(scene!))[object.id];if(!object||!box)throw Error('Unknown move target');
  const cx=center_x===null?box.x+box.width/2:z.number().finite().parse(center_x),cy=center_y===null?box.y+box.height/2:z.number().finite().parse(center_y);
  const pose=moveObject(object,box,{x:cx-box.x-box.width/2,y:cy-box.y-box.height/2},scene!.paper??{x:0,y:0,width:1000,height:640});
  return{...rest,x:pose.x,y:pose.y,marks:null};
 }
 return {...value,...('color' in value?{color:expandHex((value as Record<string,unknown>).color)}:{}),marks:null};
}
const editSchema=z.object({id:z.string().min(1).max(64),start:z.number().int().min(0).max(99),deleteCount:z.number().int().min(1).max(100),marks:z.array(z.unknown()).max(100)}).strict();
/** Apply indexed replacement to original marks. Never splice a partially modified array. */
export function decodePatch(raw:unknown,scene:Scene,fallbackMessage='Your picture has been updated.',positions?:Record<string,MercuryBounds>){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid Mercury patch');
 const value=raw as Record<string,unknown>;
 if(Object.keys(value).some(k=>!Object.keys(properties).includes(k))||Object.keys(properties).some(k=>!(k in value)))throw Error('Unexpected Mercury fields');
 if(value.action==='update'&&['additions','updates','mark_edits','layer_moves','removals'].every(k=>Array.isArray(value[k])&&(value[k] as unknown[]).length===0)&&['sky','weather','ground'].every(k=>value[k]===null))throw Error('No drawing operation returned');
 const edits=z.array(editSchema).max(100).parse(value.mark_edits);
 const additions=z.array(z.record(z.unknown())).max(40).parse(value.additions).map(o=>decodeAddition(o,z.array(z.unknown()).max(100).parse(o.marks)));
 const updates=z.array(z.unknown()).max(40).parse(value.updates).map(v=>decodeUpdate(v,scene,positions)) as Record<string,unknown>[];
 if(new Set(updates.map(o=>o.id)).size!==updates.length)throw Error('Duplicate updates');
 const grouped=new Map<string,typeof edits>();for(const edit of edits)grouped.set(edit.id,[...(grouped.get(edit.id)||[]),edit]);
 for(const [id,operations] of grouped){
  const object=scene.objects.find(o=>o.id===id);
  if(!object?.marks||additions.some(o=>o.id===id)||(Array.isArray(value.removals)&&value.removals.includes(id)))throw Error('Invalid edit target');
  operations.sort((a,b)=>a.start-b.start);let cursor=0;const marks:DrawingMark[]=[];
  for(const op of operations){if(op.start<cursor||op.start+op.deleteCount>object.marks.length)throw Error('Overlapping or out-of-range edits');marks.push(...object.marks.slice(cursor,op.start),...op.marks.map(decodeMark));cursor=op.start+op.deleteCount;}
  marks.push(...object.marks.slice(cursor));
  const update=updates.find(u=>u.id===id);if(update)update.marks=marks;else updates.push({id,x:null,y:null,scale:null,color:null,label:null,kind:null,marks});
 }
 const {mark_edits:_,layer_moves:layerMoves,...rest}=value;
 if(value.object_order!==null)throw Error('Mercury uses relative layer placements');
 const object_order=mercuryOrder(scene,z.array(z.record(z.unknown())).parse(value.additions),z.array(z.string()).parse(value.removals),layerMoves);
 const patch={...rest,object_order,...(value.action==='update'&&typeof value.message==='string'&&!value.message.trim()?{message:fallbackMessage}:{}),layout:value.action==='update'?[]:value.layout,additions,updates};
 // Keep wire nulls: applyScenePatch performs the one canonical normalization.
 scenePatchSchema.parse(patch);
 return patch;
}

/** Existing layers retain their order; the compiler fills IDs, never the model. */
export function mercuryOrder(scene:Scene,additions:Record<string,unknown>[],removals:string[]=[],moves:unknown=[]):string[]|null{
 const operations=z.array(z.object({id:z.string(),before:z.string().nullable()}).strict()).max(40).parse(moves);
 const old=new Set(scene.objects.map(o=>o.id));
 if(!operations.length&&additions.every(o=>o.place_before==null))return null;
 const order=scene.objects.map(o=>o.id).filter(id=>!removals.includes(id));
 for(const object of additions){const id=z.string().parse(object.id),before=object.place_before;if(before!==null&&before!==undefined&&(!old.has(String(before))||!order.includes(String(before))))throw Error('Unknown background anchor');if(order.includes(id))throw Error('Duplicate layer ID');order.splice(before==null?order.length:order.indexOf(String(before)),0,id);}
 const moved=new Set<string>();for(const op of operations){if(moved.has(op.id)||!old.has(op.id)||!order.includes(op.id)||op.id===op.before||(op.before!==null&&(!old.has(op.before)||!order.includes(op.before))))throw Error('Invalid layer move');moved.add(op.id);order.splice(order.indexOf(op.id),1);order.splice(op.before===null?order.length:order.indexOf(op.before),0,op.id);}
 return order;
}
