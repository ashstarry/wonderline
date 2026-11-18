import { inversePoseTransform, paperToLocal, type ObjectPose } from '../lib/object-pose';
import { squareEraserPath } from '../lib/eraser-shape';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { Scene } from '../lib/scene';

type PaperBounds = { x: number; y: number; width: number; height: number };
const ORIGINAL_PAPER: PaperBounds = { x: 0, y: 0, width: 1000, height: 640 };
type Props = { erasures: Scene['erasures']; targetKey: string; frame?: ObjectPose; viewport?: PaperBounds; children: ReactNode };

/** Permanent holes in existing pigment. New marks are separate targets and can
 * paint over a hole; the paper itself never becomes an opaque white overlay. */
export function ErasureMask({ erasures, targetKey, frame = { x: 0, y: 0, scale: 1 }, viewport = ORIGINAL_PAPER, children }: Props) {
  const id = `erasure-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const group = useRef<SVGGElement>(null);
  const mask = useRef<SVGMaskElement>(null);
  const strokes = (erasures ?? []).flatMap(stroke => {
    const target = stroke.targets.find(candidate => candidate.key === targetKey);
    return target ? [{ stroke, target }] : [];
  });
  // Rasterize only the visible page (plus edge padding) in the object's CURRENT
  // local frame. Bounds follow moved/scaled objects without allocating enormous
  // textures for tiny brushes; holes below still use the ORIGINAL erase frame.
  // userSpaceOnUse also gives perfectly straight strokes a nonzero mask region.
  const corners = [[viewport.x-128,viewport.y-128],[viewport.x+viewport.width+128,viewport.y-128],
    [viewport.x-128,viewport.y+viewport.height+128],[viewport.x+viewport.width+128,viewport.y+viewport.height+128]]
    .map(([x,y])=>paperToLocal({x,y},frame));
  const left=Math.min(...corners.map(p=>p.x)), top=Math.min(...corners.map(p=>p.y));
  const width=Math.max(...corners.map(p=>p.x))-left, height=Math.max(...corners.map(p=>p.y))-top;
  useLayoutEffect(() => {
    if (!mask.current || !group.current) return;
    try {
      const box = group.current.getBBox(), padding = 32 / frame.scale;
      const x = Math.max(left,box.x-padding), y = Math.max(top,box.y-padding);
      const w = Math.max(1,Math.min(left+width,box.x+box.width+padding)-x);
      const h = Math.max(1,Math.min(top+height,box.y+box.height+padding)-y);
      for (const [key,value] of Object.entries({x,y,width:w,height:h})) mask.current.setAttribute(key,String(value));
    } catch { /* Viewport-sized bounds remain a safe fallback. */ }
  },[erasures,targetKey,frame.x,frame.y,frame.scale,frame.rotation,left,top,width,height]);
  return <g ref={group} data-erasure-target={targetKey} data-erasure-mask={strokes.length ? id : undefined} mask={strokes.length ? `url(#${id})` : undefined}>
    {strokes.length > 0 && <defs>
      <mask ref={mask} id={id} data-permanent-erasure-mask="true" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x={left} y={top} width={width} height={height} style={{ maskType: 'luminance' }}>
        <rect x={left} y={top} width={width} height={height} fill="white" />
        {strokes.map(({ stroke, target }) => <g key={stroke.id} transform={inversePoseTransform(target)}>
          {stroke.paths.map((path, index) => stroke.shape === 'square' ? <path key={index} d={squareEraserPath(path,stroke.width)} fill="black" /> : <path key={index} d={path} fill="none" stroke="black" strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />)}
        </g>)}
      </mask>
    </defs>}
    {children}
  </g>;
}
