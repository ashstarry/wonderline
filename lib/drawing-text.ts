import type { Scene } from './scene';
/** Lettering is opt-in for the current instruction, not inherited from a title
 * or the model's wish to label a subject. Existing intentional lettering stays. */
export function requestsLettering(instruction:string){
 if(/(?:不要|不用|别|不加|去掉|删除|去除).{0,8}(?:文字|字母|数字|写字|标注|标题)|no\s+(?:text|words|labels)|without\s+(?:text|words|labels)/i.test(instruction))return false;
 return /写(?!实|生|意|真)|文字|字母|数字|标上|标注|题字|题词|write|lettering|caption|label\s+(?:it|the)|text\s+(?:saying|reading)/i.test(instruction);
}
export function omitUnrequestedText(original:Scene,next:Scene):Scene{
 const old=new Map(original.objects.map(object=>[object.id,object]));
 return {...next,objects:next.objects.flatMap(object=>{
  if(!object.marks?.some(mark=>mark.type==='text'))return[object];
  const previous=old.get(object.id),retained=new Set(previous?.marks?.filter(mark=>mark.type==='text').map(mark=>JSON.stringify(mark)));
  const marks=object.marks.filter(mark=>mark.type!=='text'||retained.has(JSON.stringify(mark)));
  if(object.kind==='drawing'&&!marks.length)return previous?[previous]:[];
  return[{...object,marks}];
 })};
}
