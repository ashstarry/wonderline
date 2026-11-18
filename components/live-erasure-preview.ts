import { squareEraserSegment, type EraserShape } from '../lib/eraser-shape';
import { collectErasureTargets } from '../lib/eraser';
import type { ErasureTarget, Scene } from '../lib/scene';
import type { HandPoint } from '../lib/freehand';
import type { PaperViewport } from '../lib/paper-viewport';

const SVG = 'http://www.w3.org/2000/svg';
type Bounds = { left: number; top: number; right: number; bottom: number };
function element<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** One temporary mask for ALL pigment. Pointer frames touch only its trailing
 * path chunk; React and the scene validator run once, when the child lets go. */
export class LiveErasurePreview {
  private mask: SVGMaskElement;
  private definitions: SVGDefsElement;
  private previousMask: string | null;
  private processed = 0;
  private previous: HandPoint | null = null;
  private path: SVGPathElement | null = null;
  private pathData = '';
  private chunkPoints = 0;
  private candidates: Array<{ target: ErasureTarget; bounds: Bounds | null }>;
  private hits = new Map<string, ErasureTarget>();

  constructor(private pigment: SVGGElement, scene: Scene, viewport: PaperViewport, private width: number, id: string, private shape: EraserShape = 'round') {
    const canvas = pigment.ownerSVGElement!;
    const inverse = canvas.getScreenCTM()?.inverse();
    const boxes = new Map<string, Bounds | null>();
    // Read geometry once before writing the mask. Duplicate keys (e.g. lake and
    // reeds) share a union; unknown bounds remain conservatively erasable.
    for (const node of Array.from(pigment.querySelectorAll<SVGGraphicsElement>('[data-erasure-target]'))) {
      const key = node.getAttribute('data-erasure-target')!;
      let bounds: Bounds | null = null;
      try {
        const screen = node.getScreenCTM();
        if (inverse && screen) {
          const matrix = inverse.multiply(screen), b = node.getBBox();
          const corners = [[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(matrix));
          // Include strokes, grain and wet edges, not only mathematical fills.
          const padding = 32 * Math.max(1, Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
          bounds = { left: Math.min(...corners.map(p=>p.x))-padding, top: Math.min(...corners.map(p=>p.y))-padding, right: Math.max(...corners.map(p=>p.x))+padding, bottom: Math.max(...corners.map(p=>p.y))+padding };
        }
      } catch { /* Missing bounds must never silently disable an eraser. */ }
      const previous = boxes.get(key);
      if (boxes.has(key)) bounds = previous && bounds ? { left:Math.min(previous.left,bounds.left),top:Math.min(previous.top,bounds.top),right:Math.max(previous.right,bounds.right),bottom:Math.max(previous.bottom,bounds.bottom) } : null;
      boxes.set(key,bounds);
    }
    this.candidates = collectErasureTargets(scene).map(target => ({ target, bounds: boxes.get(target.key) ?? null }));
    this.definitions = element('defs', { 'data-playback-artifact': 'live-erasure' });
    this.mask = element('mask', { id: `live-erase-${id}`, maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse', x:viewport.x-128,y:viewport.y-128,width:viewport.width+256,height:viewport.height+256 });
    this.mask.style.maskType = 'luminance';
    this.mask.appendChild(element('rect',{x:viewport.x-128,y:viewport.y-128,width:viewport.width+256,height:viewport.height+256,fill:'white'}));
    this.definitions.appendChild(this.mask); canvas.appendChild(this.definitions);
    this.previousMask = pigment.getAttribute('mask');
    pigment.setAttribute('mask', `url(#live-erase-${id})`);
  }

  update(points: readonly HandPoint[]) {
    while (this.processed < points.length) {
      const point = points[this.processed++], previous = this.previous ?? point, radius = this.width / 2;
      const area = { left:Math.min(previous.x,point.x)-radius,top:Math.min(previous.y,point.y)-radius,right:Math.max(previous.x,point.x)+radius,bottom:Math.max(previous.y,point.y)+radius };
      this.candidates = this.candidates.filter(candidate => {
        const b = candidate.bounds;
        if (!b || (area.left <= b.right && area.right >= b.left && area.top <= b.bottom && area.bottom >= b.top)) { this.hits.set(candidate.target.key,candidate.target); return false; }
        return true;
      });
      if (!this.path || this.chunkPoints >= 128) {
        if (this.path) this.path.setAttribute('d',this.pathData);
        this.path = element('path',this.shape === 'square' ? {fill:'black'} : {fill:'none',stroke:'black','stroke-width':this.width,'stroke-linecap':'round','stroke-linejoin':'round'});
        this.mask.appendChild(this.path); this.pathData = this.shape === 'square' ? '' : `M${previous.x.toFixed(1)} ${previous.y.toFixed(1)}`; this.chunkPoints = 0;
      }
      this.pathData += this.shape === 'square' ? squareEraserSegment(previous,point,this.width) : `L${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      // A zero-length round-capped segment leaves a proper dab on pointer-down.
      this.chunkPoints++; this.previous = point;
    }
    this.path?.setAttribute('d',this.pathData);
  }

  targets() { return [...this.hits.values()]; }
  dispose() {
    if (this.previousMask === null) this.pigment.removeAttribute('mask'); else this.pigment.setAttribute('mask',this.previousMask);
    this.definitions.remove();
  }
}
