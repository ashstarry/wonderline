type Point = { x: number; y: number };
export type EraserShape = 'round' | 'square';
const cross = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
/** The sweep of an axis-aligned square, including diagonal motion. SVG square
 * line caps would rotate with the stroke and disagree with the child's cursor. */
export function squareEraserSegment(a: Point, b: Point, width: number): string {
  const r=width/2;
  const points=[a,b].flatMap(p=>[[-r,-r],[-r,r],[r,-r],[r,r]].map(([x,y])=>({x:p.x+x,y:p.y+y})))
    .sort((p,q)=>p.x-q.x||p.y-q.y);
  const half=(list:Point[])=>{
    const hull:Point[]=[];
    for(const p of list){while(hull.length>=2&&cross(hull[hull.length-2],hull[hull.length-1],p)<=0)hull.pop();hull.push(p);}
    return hull.slice(0,-1);
  };
  return [...half(points),...half([...points].reverse())].map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('')+'Z';
}
export function squareEraserPath(path: string, width: number): string {
  const points=[...path.matchAll(/[ML]([-+\d.]+) ([-+\d.]+)/g)].map(p=>({x:Number(p[1]),y:Number(p[2])}));
  return points.slice(1).map((p,i)=>squareEraserSegment(points[i],p,width)).join('');
}
