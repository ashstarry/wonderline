import type{Scene,SceneObject}from'../scene';
import{localToPaper}from'../object-pose';
import{modelCanvasContext}from'../canvas-context-validation';
export type MercuryBounds={x:number;y:number;width:number;height:number};
export function mercuryBounds(object: SceneObject): MercuryBounds {
  const points: {x:number;y:number}[] = [];
  const add = (x: number, y: number) => points.push(localToPaper({ x, y }, object));
  const addBox = (left:number,top:number,right:number,bottom:number) => { add(left,top);add(left,bottom);add(right,top);add(right,bottom); };
  for (const mark of object.marks ?? []) {
    if (mark.type === 'path') {
      const tokens = mark.d!.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
      const counts: Record<string, number> = { M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0 };
      let i=0, command='M', x=0, y=0, startX=0, startY=0;
      while (i<tokens.length) {
        if (/^[A-Za-z]$/.test(tokens[i])) command=tokens[i++];
        const upper=command.toUpperCase(), relative=command!==upper, count=counts[upper];
        if (!count) { if (upper==='Z') {x=startX;y=startY;add(x,y);} if(i<tokens.length&&!/^[A-Za-z]$/.test(tokens[i]))break; continue; }
        const nums=tokens.slice(i,i+count).map(Number); i+=count;
        if (nums.length!==count || nums.some(n=>!Number.isFinite(n))) break;
        const ox=relative?x:0,oy=relative?y:0;
        if (upper==='H') { x=nums[0]+ox; add(x,y); }
        else if (upper==='V') { y=nums[0]+oy; add(x,y); }
        else if (upper==='A') { const endX=nums[5]+ox,endY=nums[6]+oy,radius=Math.max(nums[0],nums[1]); addBox(Math.min(x,endX)-radius,Math.min(y,endY)-radius,Math.max(x,endX)+radius,Math.max(y,endY)+radius); x=endX;y=endY; }
        else { for(let n=0;n<count;n+=2)add(nums[n]+ox,nums[n+1]+oy); x=nums[count-2]+ox;y=nums[count-1]+oy; }
        if(upper==='M'){startX=x;startY=y;command=relative?'l':'L';}
      }
    } else if (mark.type==='line') { add(mark.x!,mark.y!);add(mark.x2!,mark.y2!); }
    else if (mark.type==='ellipse') addBox(mark.x!-mark.w!/2,mark.y!-mark.h!/2,mark.x!+mark.w!/2,mark.y!+mark.h!/2);
    else addBox(mark.x!,mark.y!,mark.x!+(mark.w??40),mark.y!+(mark.h??20));
  }
  if(object.kind!=='drawing'||!points.length)addBox(-85,-130,85,20);
  const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
  return {x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y};
}
export function mercuryPositions(scene:Scene,raw?:unknown){const measured=modelCanvasContext(scene,raw,'move');return Object.fromEntries(scene.objects.map(o=>{const b=measured?.objects.find(x=>x.id===o.id)?.geometry_bounds;return[o.id,b?{x:b[0],y:b[1],width:b[2],height:b[3]}:mercuryBounds(o)];}));}
