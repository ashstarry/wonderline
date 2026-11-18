import { DrawingPace } from './drawing-pace';
import { PAINTER_COUNT, StrokePlaybackQueue, type StrokeEntry, type StrokePhase, type StrokeTask } from './stroke-playback-queue';
import { handProgress, naturalColorStrokeDuration, penLiftDuration, planNaturalColor, contactColorStrokes, type PaintMedium, type PaintPoint } from './natural-color-strokes';
import { independentThirdSubject, type SubjectRegion } from './painter-regions';
import { DrawingSounds } from './drawing-sounds';

const SVG = 'http://www.w3.org/2000/svg';
export const ERASER_DIAMETER_PX = 38;
const SHAPES = 'path,ellipse,rect,circle,line,text';
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
let sequence = 0;

type StrokeSnapshot = {
  content: SVGElement;
  plane: SVGElement;
  planeChildren: Element[];
  planeIndex: number;
  order: number;
  parentToLayer: DOMMatrix;
  inheritedOpacity: number;
  permanentMaskIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};
type StrokeTarget = { container: SVGElement; geometry: SVGElement; snapshot: StrokeSnapshot; layoutSlot: string; viewportDependent: boolean; visualKey: string };
type OutlinePart = { element: SVGGeometryElement; length: number; start: number; duration: number; lift: number; from: PaintPoint | null; to: PaintPoint };
type ColorPart = OutlinePart & { screenWidth: number };

/** Advance only through visible frames; a blocked tab never catches up in one jump. */
export class DrawingFrameClock {
  elapsed = 0;
  private previous: number | null = null;
  reset(now: number) { this.elapsed = 0; this.previous = now; }
  resume(now: number) { this.previous = now; }
  advance(now: number, rate = 1) {
    if (this.previous !== null) this.elapsed += clamp(now - this.previous, 0, 40) * clamp(rate, .7, 1);
    this.previous = now;
    return this.elapsed;
  }
}

export function outlinePlaybackDuration(screenLength: number, closed = false) {
  // A little circle is still traced around its contour, but does not inherit
  // the pause of a large shape. Preserve the hand speed of longer contours.
  // A slightly gentler hand; tiny eyes/dots keep their brief minimum gesture.
  // Duration never gates model work or another independent artist's first stroke.
  const speed = (500 + 300 * (1 - clamp(screenLength / 240, 0, 1))) * .85;
  return Math.max(closed ? 90 : 55, Math.max(0, screenLength) / speed * 1000);
}

export function colorPlaybackDuration(screenLength: number, broad = false) {
  return naturalColorStrokeDuration(screenLength, 'crayon', broad);
}

export function isBroadColorArea(box: Pick<DOMRect, 'width' | 'height'>, screenScale = 1) {
  const scale = Math.max(.01, screenScale);
  const width = Math.max(0, box.width) * scale, height = Math.max(0, box.height) * scale;
  return Math.min(width, height) >= 80 && width * height >= 24000;
}

export function erasurePlaybackDuration(screenLength: number) {
  // A single shared pass replaces many per-mark passes. Allow a large page a
  // little more travel time without speeding the tool into a blur.
  return clamp(Math.max(0, screenLength) / 3500 * 1000, 180, 1400);
}

export function virtualToolScale(matrix: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd'>) {
  const scale = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
  return Number.isFinite(scale) && scale > 0 ? 1 / scale : 1;
}

/** Sample the transformed trajectory, including nonuniform scaling, in CSS pixels. */
export function projectedPathLength(length: number, pointAt: (distance: number) => { x: number; y: number }, matrix: Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd'>) {
  if (!(length > 0) || !Number.isFinite(length)) return 0;
  // Our paper and object transforms are normally uniform (possibly rotated or
  // reflected). Their arc length is exact without hundreds of native SVG reads.
  // Keep sampling for skew/nonuniform transforms, where a scalar is incorrect.
  const xScale = Math.hypot(matrix.a, matrix.b), yScale = Math.hypot(matrix.c, matrix.d);
  const tolerance = Math.max(xScale, yScale, 1) * 1e-8;
  if (Number.isFinite(xScale + yScale) && Math.abs(xScale - yScale) <= tolerance &&
      Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) <= tolerance * Math.max(xScale, yScale, 1)) return length * xScale;
  const steps = Math.round(clamp(length / 6, 16, 240));
  let previous = pointAt(0), projected = 0;
  for (let index = 1; index <= steps; index++) {
    const point = pointAt(length * index / steps);
    const dx = point.x - previous.x, dy = point.y - previous.y;
    projected += Math.hypot(matrix.a * dx + matrix.c * dy, matrix.b * dx + matrix.d * dy);
    previous = point;
  }
  return projected;
}

function visiblePathLength(geometry: SVGGeometryElement, length: number, coordinateSource: SVGElement = geometry) {
  try {
    const matrix = (coordinateSource as SVGGraphicsElement).getScreenCTM();
    return matrix ? projectedPathLength(length, distance => geometry.getPointAtLength(distance), matrix) : length;
  } catch { return length; }
}

function visibleScale(element: SVGElement) {
  const matrix = (element as SVGGraphicsElement).getScreenCTM();
  return matrix ? Math.max(.01, Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)) : 1;
}

function create<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function stripMetadata(node: SVGElement) {
  node.removeAttribute('id');
  for (const element of [node, ...Array.from(node.querySelectorAll<SVGElement>('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.startsWith('data-')) element.removeAttribute(attribute.name);
    }
  }
  node.setAttribute('data-playback-artifact', 'stroke');
  node.setAttribute('pointer-events', 'none');
  node.setAttribute('aria-hidden', 'true');
}

function measuredLength(node: SVGElement) {
  if (!('getTotalLength' in node)) return 0;
  try { return Math.max(0, (node as SVGGeometryElement).getTotalLength()); } catch { return 0; }
}

const VISUAL_ATTRIBUTES = new Set(['transform', 'opacity', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'filter', 'clip-path', 'mask', 'visibility', 'display', 'style', 'class', 'color']);
const INHERITED_PAINT = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'color'];
const URL_REFERENCE = /url\(\s*["']?(?:[^#)]*#)([^)'"\s]+)["']?\s*\)/g;

function referencedIds(value: string, attribute = '') {
  const ids = Array.from(value.matchAll(URL_REFERENCE), match => match[1]);
  if ((attribute === 'href' || attribute === 'xlink:href') && value.startsWith('#')) ids.push(value.slice(1));
  return ids;
}

/** Erasures are stored against all paint that existed at gesture time. An
 * off-subject mask must not turn undo into a redraw of the whole picture. */
export function eraserMayTouch(path: SVGGraphicsElement, container: SVGGraphicsElement): boolean {
  const projectedBox = (element: SVGGraphicsElement, padding: number) => {
    const box = element.getBBox(), matrix = element.getScreenCTM();
    if (!matrix) throw new Error('unmeasurable paint');
    const corners = [[box.x-padding,box.y-padding],[box.x+box.width+padding,box.y-padding],[box.x-padding,box.y+box.height+padding],[box.x+box.width+padding,box.y+box.height+padding]]
      .map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
    const values = corners.flatMap(point=>[point.x,point.y]);
    if (!values.every(Number.isFinite)) throw new Error('unmeasurable paint');
    return {left:Math.min(...corners.map(point=>point.x)),right:Math.max(...corners.map(point=>point.x)),top:Math.min(...corners.map(point=>point.y)),bottom:Math.max(...corners.map(point=>point.y))};
  };
  try {
    const erase = projectedBox(path, Number(path.getAttribute('stroke-width') ?? 0)/2);
    // Include outline thickness and the small pigment bleed outside geometry.
    const width = Math.max(0, ...[container,...Array.from(container.querySelectorAll(SHAPES))].map(node=>Number(node.getAttribute('stroke-width')??0)||0));
    const paint = projectedBox(container, width/2+8);
    return erase.left<=paint.right&&erase.right>=paint.left&&erase.top<=paint.bottom&&erase.bottom>=paint.top;
  } catch { return true; } // Unknown geometry is conservatively animated.
}

/** Compare the rendered pigment, not generated IDs or screen-space geometry.
 * Reference expansion also notices edits to a shared gradient without redrawing
 * marks which use a different gradient. The cache lives for one scene read. */
export function strokeVisualIdentity(container: SVGElement, canvas: SVGSVGElement, references = new Map<string, string>()) {
  const resolving = new Set<string>();
  const resolve = (id: string): string => {
    const node = canvas.getElementById(id);
    const permanent = node?.hasAttribute('data-permanent-erasure-mask');
    const cached = permanent ? undefined : references.get(id);
    if (cached !== undefined) return cached;
    if (resolving.has(id)) return 'cyclic-reference';
    resolving.add(id);
    const serialized = node ? serialize(node, true) : null;
    const value = node ? serialized ? JSON.stringify(serialized) : '' : `missing:${id}`;
    resolving.delete(id); if(!permanent)references.set(id, value); return value;
  };
  const paint = (value: string, name: string) => {
    const result = value.replace(URL_REFERENCE, (_match, id: string) => `url(${resolve(id)})`);
    return (name === 'href' || name === 'xlink:href') && value.startsWith('#') ? resolve(value.slice(1)) : result;
  };
  const attributes = (node: Element, ancestor = false, permanent = false) => Array.from(node.attributes)
    .filter(({ name }) => name !== 'id' && !name.startsWith('data-') && !name.startsWith('aria-') && name !== 'pointer-events' && (!ancestor || VISUAL_ATTRIBUTES.has(name)) && (!permanent || !['x', 'y', 'width', 'height'].includes(name)))
    .sort((a, b) => a.name.localeCompare(b.name)).map(({ name, value }) => [name, paint(value, name)])
    .filter(([name,value])=>name!=='mask'||value!=='url()');
  function serialize(node: Element, reference = false, insidePermanent = false): unknown[] | null {
    if (node.hasAttribute('data-playback-artifact') || node.tagName.toLowerCase() === 'title' || (!reference && node.tagName.toLowerCase() === 'defs')) return null;
    const permanent = node.hasAttribute('data-permanent-erasure-mask');
    const permanentChild = reference && insidePermanent;
    if (permanentChild && node.tagName.toLowerCase()==='path' && !eraserMayTouch(node as SVGGraphicsElement,container as SVGGraphicsElement)) return null;
    const children = Array.from(node.children).filter((child, index) => !(permanent && index === 0 && child.tagName.toLowerCase() === 'rect' && child.getAttribute('fill') === 'white'));
    const content = children.map(child => serialize(child, reference, insidePermanent||permanent)).filter(Boolean);
    if ((permanent || (permanentChild&&node.tagName.toLowerCase()==='g'))&&!content.length) return null;
    return [node.tagName.toLowerCase(), attributes(node, false, permanent), node.tagName.toLowerCase() === 'text' ? node.textContent : '', content];
  }
  const ancestry = [];
  for (let node: Element | null = container.parentElement; node && node !== canvas && !node.hasAttribute('data-scene-layer'); node = node.parentElement) {
    const values = attributes(node, true); if (values.length) ancestry.push(values);
  }
  return JSON.stringify([serialize(container), ancestry]);
}

/** A snapshot owns every referenced pigment/clip/mask, including dependencies
 * of those definitions. Live React updates must never recolor yesterday's ink. */
export function freezePaintDependencies(content: SVGElement, canvas: SVGSVGElement) {
  const elements = (root: SVGElement) => [root, ...Array.from(root.querySelectorAll<SVGElement>('*'))];
  const present = new Set(elements(content).map(element => element.getAttribute('id')).filter((id): id is string => Boolean(id)));
  const pending = elements(content);
  const definitions = create('defs');
  for (let index = 0; index < pending.length; index++) {
    for (const { name, value } of Array.from(pending[index].attributes)) for (const id of referencedIds(value, name)) {
      if (present.has(id)) continue;
      present.add(id);
      const source = canvas.getElementById(id);
      if (!source) continue;
      const clone = source.cloneNode(true) as SVGElement;
      const descendants = elements(clone);
      for (const element of descendants) { const childId = element.getAttribute('id'); if (childId) present.add(childId); }
      definitions.appendChild(clone); pending.push(...descendants);
    }
  }
  if (definitions.children.length) content.insertBefore(definitions, content.firstChild);
  return content;
}

function relativeMatrix(element: SVGElement, layer: SVGElement) {
  const a = (element as SVGGraphicsElement).getScreenCTM();
  const b = (layer as SVGGraphicsElement).getScreenCTM();
  return a && b ? b.inverse().multiply(a) : new DOMMatrix();
}

/** A layered wash may extend past its first shape (for example a sunset glow). */
export function playbackBounds(container: SVGElement, geometry: SVGElement) {
  const source = container.getAttribute('data-playback-area') === 'true' ? container : geometry;
  try {
    const box = (source as SVGGraphicsElement).getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch {
    // Detached/unsupported geometry must not interrupt the rest of the drawing.
    return { x: 0, y: 0, width: 1, height: 1 };
  }
}

function captureSnapshot(container: SVGElement, geometry: SVGElement, canvas: SVGSVGElement, order: number): StrokeSnapshot {
  const layer = container.closest<SVGElement>('[data-scene-layer]') ?? canvas;
  const parent = container.parentElement instanceof SVGElement ? container.parentElement : null;
  // Objects share a neutral painting plane. Leave that plane's old stacking
  // order intact while avoiding a reused object's new mask/opacity/transform.
  let plane = layer;
  const ancestors: SVGElement[] = [];
  for (let node = parent; node && node !== layer; node = node.parentElement instanceof SVGElement ? node.parentElement : null) ancestors.unshift(node);
  for (const node of ancestors) {
    if (node.tagName.toLowerCase() !== 'g' || node.hasAttribute('data-object-id') || node.hasAttribute('data-marks-for') || node.hasAttribute('data-erasure-target') || Array.from(node.attributes).some(attribute => VISUAL_ATTRIBUTES.has(attribute.name))) break;
    plane = node; break;
  }
  let top: Node = container;
  while (top.parentNode && top.parentNode !== plane) top = top.parentNode;
  let inheritedOpacity = 1;
  const permanentMasks: SVGMaskElement[] = [];
  for (let ancestor = parent; ancestor && ancestor !== layer; ancestor = ancestor.parentElement instanceof SVGElement ? ancestor.parentElement : null) {
    const opacity = Number(getComputedStyle(ancestor).opacity);
    if (Number.isFinite(opacity)) inheritedOpacity *= opacity;
    // A later AI edit may detach this ancestor. Capture the user's existing
    // rubbed-out areas so the animation cannot bring those pixels back.
    if (ancestor.hasAttribute('data-erasure-target') && parent) {
      const maskId = /^url\(#([^)]*)\)$/.exec(ancestor.getAttribute('mask') ?? '')?.[1];
      const source = maskId ? canvas.getElementById(maskId) : null;
      if (source?.tagName.toLowerCase() === 'mask') {
        const mask = source.cloneNode(false) as SVGMaskElement;
        mask.id = `saved-rub-${++sequence}`;
        const matrix = relativeMatrix(ancestor, parent);
        const x=Number(source.getAttribute('x')), y=Number(source.getAttribute('y'));
        const width=Number(source.getAttribute('width')), height=Number(source.getAttribute('height'));
        const corners=[[x,y],[x+width,y],[x,y+height],[x+width,y+height]].map(([px,py])=>({x:matrix.a*px+matrix.c*py+matrix.e,y:matrix.b*px+matrix.d*py+matrix.f}));
        const left=Math.min(...corners.map(point=>point.x)), top=Math.min(...corners.map(point=>point.y));
        const right=Math.max(...corners.map(point=>point.x)), bottom=Math.max(...corners.map(point=>point.y));
        // Keep the saved mask as small as the visible page, even when the mark
        // is moved into a playback overlay in a different coordinate frame.
        for (const [key, value] of Object.entries({ x: left, y: top, width: Math.max(1,right-left), height: Math.max(1,bottom-top), maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse' })) mask.setAttribute(key, String(value));
        const transformed = create('g', { transform: `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})` });
        for (const child of Array.from(source.childNodes)) transformed.appendChild(child.cloneNode(true));
        mask.appendChild(transformed);permanentMasks.push(mask);
      }
    }
  }
  const bounds = playbackBounds(container, geometry);
  const permanentMaskIds = permanentMasks.map(mask => mask.id);
  const content = wrapPermanentMasks(container.cloneNode(true) as SVGElement, permanentMaskIds);
  // A snapshot no longer inherits from the live object. Copy inherited paint
  // onto its root, while preserving each child's own explicit paint and the
  // container's own opacity (the live opacity hold is a Web Animation).
  if (parent) {
    const inherited = getComputedStyle(parent);
    for (const property of INHERITED_PAINT) if (!content.hasAttribute(property)) content.setAttribute(property, inherited.getPropertyValue(property));
  }
  if (permanentMasks.length) { const definitions=create('defs');for (const mask of permanentMasks) definitions.appendChild(mask);content.insertBefore(definitions,content.firstChild); }
  freezePaintDependencies(content, canvas);
  const planeChildren = Array.from(plane.children).filter(child => !child.hasAttribute('data-playback-artifact'));
  return { content, plane, planeChildren, planeIndex: planeChildren.indexOf(top as Element), order, parentToLayer: parent ? relativeMatrix(parent, layer) : new DOMMatrix(), inheritedOpacity, permanentMaskIds, bounds };
}

function wrapPermanentMasks(content: SVGElement, ids: string[]) {
  if (!ids.length) return content;
  const root = create('g');let destination = root;
  for (const id of ids) { const group=create('g',{ mask:`url(#${id})` });destination.appendChild(group);destination=group; }
  destination.appendChild(content);return root;
}

function isolatedSnapshotContent(source: SVGElement) {
  const content = source.cloneNode(true) as SVGElement;
  const prefix = `erased-mark-${++sequence}-`;
  const ids = new Map<string, string>();
  for (const element of [content, ...Array.from(content.querySelectorAll<SVGElement>('[id]'))]) {
    const id = element.getAttribute('id');
    if (id) { ids.set(id, `${prefix}${ids.size}`); element.setAttribute('id', ids.get(id)!); }
  }
  for (const element of [content, ...Array.from(content.querySelectorAll<SVGElement>('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      let value = attribute.value;
      value = value.replace(URL_REFERENCE, (match, id: string) => ids.has(id) ? `url(#${ids.get(id)})` : match);
      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && value.startsWith('#') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
  }
  stripMetadata(content);
  return content;
}

// SVG resets dash patterns at each moveto. Split pen-down subpaths so separate
// facial features or hatch strokes do not all begin drawing at the same instant.
export function splitStrokeSubpaths(source: SVGElement): SVGElement[] {
  if (source.tagName.toLowerCase() !== 'path') return [source.cloneNode(true) as SVGElement];
  const sections = source.getAttribute('d')?.match(/[Mm][^Mm]*/g) ?? [];
  if (sections.length < 2) return [source.cloneNode(true) as SVGElement];
  let end = { x: 0, y: 0 };
  const numeric = String.raw`[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?`;
  const relativeMove = new RegExp(String.raw`^m\s*(${numeric})[\s,]*(${numeric})`);
  return sections.map(section => {
    let d = section;
    const match = relativeMove.exec(d);
    if (match) {
      const tail = d.slice(match[0].length).trim();
      d = `M ${end.x + Number(match[1])} ${end.y + Number(match[2])} ${tail && /^[-+.\d]/.test(tail) ? 'l ' : ''}${tail}`;
    }
    const part = source.cloneNode(true) as SVGPathElement;
    part.setAttribute('d', d);
    try { const point = part.getPointAtLength(part.getTotalLength()); end = { x: point.x, y: point.y }; } catch { /* Browser will skip an unsupported outline. */ }
    return part;
  });
}

export function createBrushSweep(box: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>, brushWidth?: number) {
  const pad = 4;
  const x = box.x - pad;
  const y = box.y - pad;
  const width = Math.max(box.width + pad * 2, 10);
  const height = Math.max(box.height + pad * 2, 10);
  const rows = brushWidth === undefined ? Math.round(clamp(height / 22, 3, 8)) : Math.ceil(clamp(height / Math.max(brushWidth / 1.55, .5), 1, 256));
  const step = height / rows;
  const strokeWidth = Math.max(brushWidth ?? 0, step * 1.55);
  let d = '';
  for (let row = 0; row < rows; row++) {
    const rowY = y + step * (row + .5);
    const left = x - step;
    const right = x + width + step;
    const start = row % 2 ? right : left;
    const end = row % 2 ? left : right;
    d += row === 0 ? `M ${start} ${rowY}` : ` Q ${start} ${rowY - step / 2} ${start} ${rowY}`;
    d += ` L ${end} ${rowY}`;
  }
  const margin = Math.max(step * 2, strokeWidth);
  return { d, strokeWidth, x: x - margin, y: y - margin, width: width + margin * 2, height: height + margin * 2 };
}

export class VirtualPen {
  readonly element: SVGGElement;
  private pencil: SVGGElement;
  private eraser: SVGGElement;
  private washBrush: SVGGElement;
  private washHead: SVGGElement;
  private washHandle: SVGPathElement;
  private washFerrule: SVGPathElement;
  private washBristles: SVGPathElement;
  private washTexture: SVGPathElement;
  private washWidth = 0;
  private lastPosition: PaintPoint | null = null;
  constructor(private canvas: SVGSVGElement, private role = 'outline', private sounds?: DrawingSounds, private painterId = 0) {
    this.element = create('g', { 'data-playback-artifact': 'pen', 'data-painter-role': role, 'data-painter-id': painterId, 'aria-hidden': 'true', 'pointer-events': 'none', visibility: 'hidden', display: 'none' });
    this.pencil = create('g');
    this.eraser = create('g', { visibility: 'hidden' });
    this.washBrush = create('g', { visibility: 'hidden' });
    this.washHead = create('g');
    [
      create('path', { d: 'M0 0L2-10L19-31Q21-33 24-31L27-28Q29-26 27-23L10-3Z', fill: ['#dbb783', '#8cbbb2', '#b6a1cb'][painterId % 3], stroke: '#71664e', 'stroke-width': 1 }),
      create('path', { d: 'M0 0L2-10L10-3Z', fill: '#f2dfb6' }),
      create('path', { d: 'M0 0L1-4L4-1Z', fill: '#4c5145' }),
      create('path', { d: 'M6-10L22-29', fill: 'none', stroke: '#fff4d8', 'stroke-width': 2, opacity: .8 }),
    ].forEach(node => this.pencil.appendChild(node));
    this.eraser.appendChild(create('rect', { x: -19, y: -12, width: 38, height: 24, rx: 6, transform: 'rotate(-18)', fill: '#e8b6ac', stroke: '#8f7770', 'stroke-width': 1 }));
    this.eraser.appendChild(create('path', { d: 'M-14-4L10-11', stroke: '#fff2df', 'stroke-width': 2, opacity: .8 }));
    this.washHandle = create('path', { fill: ['#c88f61', '#7ea99e', '#ad91bf'][painterId % 3], stroke: '#7b624a', 'stroke-width': 1 });
    this.washFerrule = create('path', { fill: '#a4b9b7', stroke: '#6c8b88', 'stroke-width': .8 });
    this.washBristles = create('path', { fill: '#74a999', stroke: '#487e73', 'stroke-width': .8 });
    this.washTexture = create('path', { fill: 'none', stroke: '#b8d5b4', 'stroke-width': 1, opacity: .8 });
    this.washBrush.appendChild(this.washHandle);
    this.washHead.appendChild(this.washFerrule);
    this.washHead.appendChild(this.washBristles);
    this.washHead.appendChild(this.washTexture);
    this.washBrush.appendChild(this.washHead);
    this.sizeWashBrush(24);
    this.element.appendChild(this.pencil); this.element.appendChild(this.eraser); this.element.appendChild(this.washBrush);
    canvas.appendChild(this.element);
  }
  move(geometry: SVGGeometryElement, length: number, coordinateSource: SVGElement = geometry, tool: 'pen' | 'eraser' | 'wash' = 'pen', screenBrushWidth = 0) {
    try {
      const point = geometry.getPointAtLength(length);
      this.movePoint(point, coordinateSource, tool, false, screenBrushWidth);
    } catch { this.hide(); }
  }
  movePoint(point: PaintPoint, coordinateSource: SVGElement, tool: 'pen' | 'eraser' | 'wash' = 'pen', lifted = false, screenBrushWidth = 0) {
    try {
      const source = (coordinateSource as SVGGraphicsElement).getScreenCTM();
      const root = this.canvas.getScreenCTM();
      if (!source || !root) return this.hide();
      const local = new DOMPoint(point.x, point.y).matrixTransform(source).matrixTransform(root.inverse());
      if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return this.hide();
      // Keep the tip on the exact drawing coordinate while preserving a legible
      // ~32 CSS-pixel tool on narrow mobile and side-panel canvases.
      this.element.setAttribute('transform', `translate(${local.x} ${local.y}) scale(${virtualToolScale(root)})`);
      this.lastPosition = { x: local.x, y: local.y };
      this.pencil.setAttribute('visibility', tool === 'pen' ? 'visible' : 'hidden');
      this.eraser.setAttribute('visibility', tool === 'eraser' ? 'visible' : 'hidden');
      if (tool === 'eraser') this.eraser.setAttribute('transform', `scale(${(screenBrushWidth || ERASER_DIAMETER_PX) / ERASER_DIAMETER_PX})`);
      this.washBrush.setAttribute('visibility', tool === 'wash' ? 'visible' : 'hidden');
      if (tool === 'wash') this.sizeWashBrush(screenBrushWidth || 24);
      this.element.setAttribute('visibility', 'visible');
      this.element.removeAttribute('display');
      this.element.setAttribute('opacity', lifted ? '.7' : '1');
      if (!lifted && this.element.getAttribute('data-pen-contact') !== 'down') this.sounds?.touch(tool, this.painterId);
      this.element.setAttribute('data-pen-contact', lifted ? 'up' : 'down');
    } catch { this.hide(); }
  }
  private sizeWashBrush(screenWidth: number) {
    // The bristle footprint is the very same diameter as the reveal mask.
    // Never silently cap just the cursor: that paints beyond the visible tool.
    const width = Math.max(1, screenWidth);
    if (Math.abs(this.washWidth-width)<.05) return;
    this.washWidth = width;
    const half=width/2, neck=Math.max(2,Math.min(6,width*.2));
    const top=-half-9;
    this.washHandle.setAttribute('d', `M -3 ${top+2} L 5 ${top-24} Q 7 ${top-28} 10 ${top-25} L 12 ${top-23} L 4 ${top+2} Z`);
    this.washFerrule.setAttribute('d', `M ${-neck} ${top} L ${neck} ${top} L ${half*.65} ${-half*.5} L ${-half*.65} ${-half*.5} Z`);
    // A compact round-tipped paintbrush. Its center at (0,0) is the contact
    // center, matching the round cap of the progressively revealed stroke.
    this.washBristles.setAttribute('d', `M 0 ${-half} A ${half} ${half} 0 1 1 0 ${half} A ${half} ${half} 0 1 1 0 ${-half} Z`);
    this.washTexture.setAttribute('d', [-.45,0,.45].map(f=>`M ${half*f} ${-half*.6} Q ${half*f*.8} 0 ${half*f} ${half*.65}`).join(' '));
  }

  positionIn(coordinateSource: SVGElement): PaintPoint | null {
    if (!this.lastPosition) return null;
    try {
      const root = this.canvas.getScreenCTM(), target = (coordinateSource as SVGGraphicsElement).getScreenCTM();
      if (!root || !target) return null;
      const point = new DOMPoint(this.lastPosition.x, this.lastPosition.y).matrixTransform(root).matrixTransform(target.inverse());
      return { x: point.x, y: point.y };
    } catch { return null; }
  }
  resetPosition() { this.lastPosition = null; this.hide(); }
  begin(subject: string, role = this.role) {
    this.role = role;
    this.element.setAttribute('data-painter-role', role);
    this.element.setAttribute('data-painter-subject', subject);
    this.sounds?.begin(role, subject, String(this.painterId));
  }
  hide() {
    // SVG children may explicitly override inherited visibility. Display removes
    // the whole tool subtree, including the last active eraser, between strokes.
    this.element.setAttribute('display', 'none');
    this.element.setAttribute('visibility', 'hidden');
    this.element.removeAttribute('data-pen-contact');
    this.pencil.setAttribute('visibility', 'hidden');
    this.eraser.setAttribute('visibility', 'hidden');
    this.washBrush.setAttribute('visibility', 'hidden');
  }
  dispose() { this.element.remove(); }
}

class SvgStrokeTask implements StrokeTask<StrokeTarget> {
  readonly hasColor: boolean;
  readonly fillOnly: boolean;
  private broadColor = false;
  private colorTool: 'pen' | 'wash' = 'pen';
  private outlineEntry: { from: PaintPoint | null; lift: number } | null = null;
  private colorEntry: { from: PaintPoint | null; lift: number } | null = null;
  private hidden: Animation | null = null;
  private outlineGroup: SVGGElement | null = null;
  private outlineClip: SVGClipPathElement | null = null;
  private outlineParts: OutlinePart[] = [];
  private outlineDuration = 0;
  private colorGroup: SVGElement | null = null;
  private mask: SVGMaskElement | null = null;
  private colorParts: ColorPart[] = [];
  private colorCursor = 0;
  private colorDuration = 0;
  private phase: StrokePhase | null = null;
  private clock = new DrawingFrameClock();
  private complete: (() => void) | null = null;
  private frame: number | null = null;
  private disposed = false;
  private hasRun = false;
  private yielded: (() => void) | null = null;
  private yieldRequested = false;
  private painterIndex = 0;
  private get pen() { return this.pens[this.painterIndex]; }
  assignPainter(index: number) { this.painterIndex = index; }

  constructor(private target: StrokeTarget, private definitions: SVGDefsElement, private pens: VirtualPen[], private pace: (now: number, small: boolean) => number = () => 1) {
    if (typeof target.container.animate !== 'function') throw new Error('SVG animation unavailable');
    const computed = getComputedStyle(target.geometry);
    const hasFill = target.geometry.tagName.toLowerCase() !== 'line' && computed.fill !== 'none' && Number(computed.fillOpacity) > 0;
    // Final styling is not a drawing instruction. A borderless subject still
    // needs its contour traced before it is colored. Only explicit background
    // washes (and text, which has no SVG geometry trajectory) bypass the pen.
    this.fillOnly = hasFill && (Boolean(target.container.closest('[data-playback-fill-only="true"]')) || target.geometry.tagName.toLowerCase() === 'text');
    this.hasColor = hasFill && !this.fillOnly;
    this.hideOriginal();
  }

  private hideOriginal() {
    // Web Animations effects are deliberately absent from serialized SVG; the
    // real scene always stores the final art, separately from playback overlays.
    this.hidden = this.target.container.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'both' });
  }

  retarget(target: StrokeTarget) {
    if (this.disposed) return;
    const resizedCoverage = target.visualKey !== this.target.visualKey;
    if (target.container === this.target.container && target.geometry === this.target.geometry && !resizedCoverage) {
      this.target = target;
      return;
    }
    const previousDuration = this.phase === 'color' ? this.colorDuration : this.outlineDuration;
    const fraction = previousDuration > 0 ? clamp(this.clock.elapsed / previousDuration, 0, 1) : 0;
    this.stopFrame();
    this.removeArtifacts();
    this.hidden?.cancel();
    this.target = target;
    this.hideOriginal();
    if (this.hasRun) this.prepareOutline();
    if (this.phase === 'color') this.prepareColor();
    if (this.phase && this.complete) {
      // Only a viewport alias can retain a key with different pigment bounds.
      // Rebuild its reveal over the new coverage, retaining progress instead of
      // showing the expanded background all at once when the old task ends.
      if (resizedCoverage) this.clock.elapsed = fraction * (this.phase === 'color' ? this.colorDuration : this.outlineDuration);
      const now = performance.now();
      this.clock.resume(now);
      this.tick(now);
    } else if (this.hasRun) {
      this.renderOutline(Number.POSITIVE_INFINITY, false);
      if (this.phase === 'color') this.renderColor(this.clock.elapsed, false);
    }
  }

  private prepareOutline() {
    if (this.outlineGroup || this.fillOnly) return;
    const { geometry, container } = this.target;
    const computed = getComputedStyle(geometry);
    const outlined = computed.stroke !== 'none' && Number.parseFloat(computed.strokeWidth) > 0 && Number(computed.strokeOpacity) > 0;
    const stroke = outlined ? computed.stroke : computed.fill;
    if (stroke === 'none' || geometry.tagName.toLowerCase() === 'text') return;
    const group = create('g', { 'data-playback-artifact': 'outline', 'pointer-events': 'none', 'aria-hidden': 'true' });
    if (container !== geometry) {
      for (const attribute of ['transform', 'opacity']) {
        const value = container.getAttribute(attribute);
        if (value !== null) group.setAttribute(attribute, value);
      }
    }
    container.parentNode?.insertBefore(group, container.nextSibling);
    this.outlineGroup = group;
    if (!outlined) {
      // Trace with the actual pigment just INSIDE the shape. The later fill
      // absorbs this edge, so finishing does not delete an invented dark border
      // or change the canonical artwork. Preserve transforms on the clip too.
      this.outlineClip = create('clipPath', { id: `live-contour-${++sequence}`, clipPathUnits: 'userSpaceOnUse', 'data-playback-artifact': 'contour-clip' });
      const clipShape = geometry.cloneNode(true) as SVGElement;
      stripMetadata(clipShape); clipShape.removeAttribute('filter');
      this.outlineClip.appendChild(clipShape); this.definitions.appendChild(this.outlineClip);
      group.setAttribute('clip-path', `url(#${this.outlineClip.id})`);
    }
    for (const part of splitStrokeSubpaths(geometry)) {
      stripMetadata(part);
      // Pigment/bleed filters belong to the static fill. Re-running them on
      // every dash frame of a fine contour makes concurrent watercolor stutter.
      part.removeAttribute('filter'); part.style.filter = 'none';
      part.setAttribute('fill', 'none');
      part.style.fill = 'none';
      part.setAttribute('stroke', stroke);
      part.style.stroke = stroke;
      if (!outlined) {
        part.style.strokeWidth = String(3 / visibleScale(geometry));
        part.style.strokeOpacity = computed.fillOpacity;
      }
      part.setAttribute('stroke-linecap', 'round');
      part.setAttribute('stroke-linejoin', 'round');
      group.appendChild(part);
      const length = measuredLength(part);
      if (!length) { part.remove(); continue; }
      const closed = ['ellipse', 'circle', 'rect'].includes(part.tagName.toLowerCase()) || /[zZ]\s*$/.test(part.getAttribute('d') ?? '');
      const duration = outlinePlaybackDuration(visiblePathLength(part as SVGGeometryElement, length), closed);
      const prior = this.outlineParts[this.outlineParts.length - 1];
      const from = prior ? prior.element.getPointAtLength(prior.length) : this.outlineEntry ? this.outlineEntry.from : this.pen.positionIn(part);
      const to = (part as SVGGeometryElement).getPointAtLength(0);
      const lift = !prior && this.outlineEntry ? this.outlineEntry.lift : from ? penLiftDuration(Math.hypot(to.x - from.x, to.y - from.y) * visibleScale(part)) : 0;
      if (!prior && !this.outlineEntry) this.outlineEntry = { from, lift };
      const start = this.outlineDuration + lift;
      this.outlineDuration = start + duration;
      part.style.strokeDasharray = `${length} ${length}`;
      part.style.strokeDashoffset = String(length);
      part.style.visibility = 'hidden';
      this.outlineParts.push({ element: part as SVGGeometryElement, length, start, duration, lift, from, to });
    }
  }

  private prepareColor() {
    if (this.colorGroup) return;
    const { container, geometry } = this.target;
    const box = playbackBounds(container, geometry), scale = visibleScale(geometry);
    const medium = (container.getAttribute('data-brush-medium') ?? 'crayon') as PaintMedium;
    const shape = geometry.tagName.toLowerCase();
    const layered = container.getAttribute('data-playback-area') === 'true';
    const ellipse = !layered && (shape === 'circle' || shape === 'ellipse') ? {
      cx: Number(geometry.getAttribute('cx') ?? 0), cy: Number(geometry.getAttribute('cy') ?? 0),
      rx: Number(geometry.getAttribute(shape === 'circle' ? 'r' : 'rx') ?? 0), ry: Number(geometry.getAttribute(shape === 'circle' ? 'r' : 'ry') ?? 0),
    } : undefined;
    const outlineLength = measuredLength(geometry);
    const boundary: PaintPoint[] = [];
    if (!layered && !ellipse && outlineLength > 0) {
      const count = Math.round(clamp(outlineLength * scale / 4, 8, 1600));
      for (let index = 0; index <= count; index++) {
        const point = (geometry as SVGGeometryElement).getPointAtLength(outlineLength * index / count);
        boundary.push({ x: point.x, y: point.y });
      }
    }
    const contains = !layered && !ellipse && 'isPointInFill' in geometry ? (point: PaintPoint) => {
      try { return (geometry as SVGGeometryElement).isPointInFill(new DOMPoint(point.x, point.y)); } catch { return true; }
    } : undefined;
    const paint = planNaturalColor(box, { scale, medium, ellipse, contains, boundary });
    this.broadColor = paint.broad;
    this.colorTool = 'wash';
    const maskId = `live-brush-${++sequence}`;
    this.mask = create('mask', { id: maskId, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', ...paint.bounds, 'mask-type': 'luminance', 'data-playback-artifact': 'mask' });
    this.definitions.appendChild(this.mask);
    let previous: PaintPoint | null = this.colorEntry ? this.colorEntry.from : this.pen.positionIn(geometry);
    for (const gesture of contactColorStrokes(paint.strokes, contains, boundary)) {
      const element = create('path', { d: gesture.d, fill: 'none', stroke: 'white', 'stroke-width': gesture.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      this.mask.appendChild(element);
      const length = measuredLength(element);
      if (!length) { element.remove(); continue; }
      const to = gesture.points[0];
      const first = this.colorParts.length === 0;
      const lift = first && this.colorEntry ? this.colorEntry.lift : previous ? penLiftDuration(Math.hypot(to.x - previous.x, to.y - previous.y) * scale) : 0;
      if (first && !this.colorEntry) this.colorEntry = { from: previous, lift };
      const duration = naturalColorStrokeDuration(visiblePathLength(element, length, geometry), medium, paint.broad);
      const start = this.colorDuration + lift;
      this.colorParts.push({ element, length, start, duration, lift, from: previous, to, screenWidth: gesture.width * scale });
      this.colorDuration = start + duration;
      element.style.strokeDasharray = `${length} ${length}`;
      element.style.strokeDashoffset = String(length);
      element.style.visibility = 'hidden';
      previous = gesture.points[gesture.points.length - 1];
    }
    const clone = container.cloneNode(true) as SVGElement;
    // The contour already has its own precise pen-down playback. Do not paint
    // that translucent stroke a second time while revealing the fill.
    if (this.outlineParts.length) {
      const fillShape = container === geometry ? clone : clone.querySelector<SVGElement>('[data-playback-shape]');
      if (fillShape) { fillShape.setAttribute('stroke', 'none'); fillShape.style.stroke = 'none'; }
    }
    stripMetadata(clone);
    // Existing definitions remain available on the hidden original. Duplicating
    // their IDs in temporary artwork would make clip/filter resolution ambiguous.
    clone.querySelectorAll('defs').forEach(defs => defs.remove());
    clone.querySelectorAll('[data-playback-artifact]').forEach(node => node.remove());
    // The material is static; only its reveal mask moves. Large filtered washes
    // otherwise rerun paper/noise/blur filters on every animation frame.
    // Cache that unchanged SVG pigment as an isolated SVG image, retaining the
    // original editable vectors underneath and in every export. Keep the live
    // vector overlay until decoding succeeds, so a slow/failed cache never
    // leaves a blank region or delays the first real brush stroke.
    // Keep intentional lettering live so the page's licensed webfont also
    // applies during playback; an isolated SVG image cannot inherit that font.
    if (clone.tagName.toLowerCase() !== 'text' && !clone.querySelector('text') && (paint.broad || this.colorDuration >= 250) && (clone.hasAttribute('filter') || clone.querySelector('[filter]'))) this.cachePigment(clone, box, scale, maskId);
    clone.setAttribute('mask', `url(#${maskId})`);
    container.parentNode?.insertBefore(clone, this.outlineGroup ?? container.nextSibling);
    this.colorGroup = clone;
  }

  private cachePigment(clone: SVGElement, box: {x:number;y:number;width:number;height:number}, scale: number, maskId: string) {
    const canvas = this.target.geometry.ownerSVGElement;
    if (!canvas || typeof Image === 'undefined') return;
    try {
      const content = clone.cloneNode(true) as SVGElement;
      const transform = content.getAttribute('transform'); content.removeAttribute('transform');
      const inherited = getComputedStyle(this.target.container);
      for (const property of INHERITED_PAINT) if (!content.hasAttribute(property)) content.setAttribute(property, inherited.getPropertyValue(property));
      freezePaintDependencies(content, canvas);
      const pad = Math.max(8, 8 / scale);
      const bounds = {x:box.x-pad,y:box.y-pad,width:box.width+2*pad,height:box.height+2*pad};
      const document = create('svg', {xmlns:SVG,viewBox:`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,width:bounds.width,height:bounds.height});
      document.appendChild(content);
      const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(document))}`;
      const decoded = new Image(); decoded.src = href;
      void decoded.decode().then(async () => {
        if (this.disposed || this.colorGroup !== clone || !clone.isConnected) return;
        // Freeze filters into pixels once; an SVG image can still rerun its
        // filters when the surrounding reveal mask changes on every frame.
        const surface = window.document.createElement('canvas');
        const ratio=Math.min(1.5,Math.max(.5,scale*(window.devicePixelRatio||1)),2048/Math.max(bounds.width,bounds.height));
        surface.width=Math.max(1,Math.ceil(bounds.width*ratio));surface.height=Math.max(1,Math.ceil(bounds.height*ratio));
        const context=surface.getContext('2d');if(!context)return;
        context.drawImage(decoded,0,0,surface.width,surface.height);
        const blob=await new Promise<Blob|null>(resolve=>surface.toBlob(resolve,'image/png'));if(!blob)return;
        const frozen=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
        if(this.disposed||this.colorGroup!==clone||!clone.isConnected)return;
        const cached = create('g', {'data-playback-artifact':'pigment-cache','aria-hidden':'true','pointer-events':'none',mask:`url(#${maskId})`});
        if (transform) cached.setAttribute('transform',transform);
        cached.appendChild(create('image', {...bounds,href:frozen,preserveAspectRatio:'none'}));
        clone.replaceWith(cached); this.colorGroup = cached;
      }).catch(() => { /* Keep the identical live vector material on cache failure. */ });
    } catch { /* Caching is optional; the brush remains fully functional. */ }
  }

  requestYield() { this.yieldRequested = true; }

  play(phase: StrokePhase, complete: () => void, yielded?: () => void) {
    if (this.disposed) return;
    this.stopFrame();
    this.hasRun = true;
    this.prepareOutline();
    const resuming = this.phase === 'color' && phase === 'color' && this.colorParts.length > 0;
    this.phase = this.fillOnly && phase === 'outline' ? 'color' : phase;
    const owner = this.target.container.closest('[data-object-id],[data-marks-for]');
    this.pen.begin(owner?.getAttribute('data-object-id')??owner?.getAttribute('data-marks-for')??'drawing', this.phase);
    this.complete = complete;
    this.yielded = yielded ?? null;
    this.yieldRequested = false;
    const now = performance.now();
    if (resuming) this.clock.resume(now); else this.clock.reset(now);
    if (this.phase === 'color') {
      this.renderOutline(Number.POSITIVE_INFINITY, false);
      this.prepareColor();
      // Lift back to the unfinished patch without revealing any new pigment.
      const next = this.colorParts[this.colorCursor];
      if (resuming && next) {
        const from = this.pen.positionIn(this.target.geometry);
        const lift = from ? penLiftDuration(Math.hypot(next.to.x-from.x, next.to.y-from.y)*visibleScale(this.target.geometry)) : 0;
        const shift = this.clock.elapsed + lift - next.start;
        next.from = from; next.lift = lift;
        for (let index=this.colorCursor; index<this.colorParts.length; index++) this.colorParts[index].start += shift;
        this.colorDuration += shift;
      }
    }
    this.tick(now);
  }

  private renderOutline(elapsed: number, trackPen = true) {
    let penVisible = false;
    for (const part of this.outlineParts) {
      const progress = handProgress((elapsed - part.start) / part.duration);
      part.element.style.visibility = elapsed >= part.start ? 'visible' : 'hidden';
      part.element.style.strokeDashoffset = String(part.length * (1 - progress));
      if (trackPen && elapsed >= part.start && elapsed < part.start + part.duration) {
        this.pen.move(part.element, part.length * progress);
        penVisible = true;
      } else if (trackPen && part.from && elapsed >= part.start - part.lift && elapsed < part.start) {
        const t = handProgress((elapsed - part.start + part.lift) / part.lift);
        this.pen.movePoint({ x: part.from.x + (part.to.x - part.from.x) * t, y: part.from.y + (part.to.y - part.from.y) * t - Math.sin(t * Math.PI) * 6 / visibleScale(part.element) }, part.element, 'pen', true);
        penVisible = true;
      }
    }
    if (trackPen && !penVisible) this.pen.hide();
  }

  private renderColor(elapsed: number, trackPen = true): boolean {
    while (this.colorCursor < this.colorParts.length) {
      const part = this.colorParts[this.colorCursor];
      if (elapsed < part.start) {
        if (trackPen && part.from) {
          const t = handProgress((elapsed - part.start + part.lift) / part.lift);
          const scale = visibleScale(this.target.geometry);
          const point = { x: part.from.x + (part.to.x - part.from.x) * t, y: part.from.y + (part.to.y - part.from.y) * t - Math.sin(t * Math.PI) * 6 / scale };
          this.pen.movePoint(point, this.target.geometry, this.colorTool, true, part.screenWidth);
        }
        return false;
      }
      const progress = handProgress((elapsed - part.start) / part.duration);
      part.element.style.visibility = progress > 0 ? 'visible' : 'hidden';
      part.element.style.strokeDashoffset = String(part.length * (1 - progress));
      if (progress < 1) {
        if (trackPen) this.pen.move(part.element, part.length * progress, this.target.geometry, this.colorTool, part.screenWidth);
        return false;
      }
      this.colorCursor++;
      if (trackPen && this.yielded && this.colorCursor < this.colorParts.length && this.yieldRequested) {
        this.clock.elapsed = part.start + part.duration;
        return true;
      }
    }
    if (trackPen) this.pen.hide();
    return false;
  }

  private tick = (now: number) => {
    if (this.disposed || !this.phase || !this.complete) return;
    const parts = this.phase === 'outline' ? this.outlineParts : this.colorParts;
    const part = this.phase === 'color' ? this.colorParts[this.colorCursor] : parts.find(item => this.clock.elapsed < item.start + item.duration);
    const elapsed = this.clock.advance(now, this.pace(now, !part || part.duration < 180));
    const duration = this.phase === 'outline' ? this.outlineDuration : this.colorDuration;
    if (this.phase === 'outline') this.renderOutline(elapsed);
    else if (this.renderColor(elapsed)) {
      const yielded = this.yielded!;
      this.pen.hide();
      this.complete = null; this.yielded = null; this.frame = null;
      yielded();
      return;
    }
    if (elapsed >= duration) {
      this.pen.hide();
      const complete = this.complete;
      this.complete = null;
      this.phase = null;
      this.frame = null;
      complete();
    } else {
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private stopFrame() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private removeArtifacts() {
    this.outlineGroup?.remove(); this.outlineGroup = null;
    this.outlineClip?.remove(); this.outlineClip = null;
    this.outlineParts = []; this.outlineDuration = 0;
    this.colorGroup?.remove(); this.colorGroup = null;
    this.mask?.remove(); this.mask = null;
    this.colorDuration = 0; this.colorParts = []; this.colorCursor = 0;
  }

  captureVisible(): StrokeSnapshot | null {
    if (!this.hasRun || (!this.colorGroup && !this.outlineParts.some(part => part.element.style.visibility !== 'hidden' && Number(part.element.style.strokeDashoffset) < part.length - .1))) return null;
    const content = create('g');
    for (const property of INHERITED_PAINT) {
      const value = this.target.snapshot.content.getAttribute(property);
      if (value !== null) content.setAttribute(property, value);
    }
    for (const definitions of Array.from(this.target.snapshot.content.querySelectorAll('defs'))) content.appendChild(definitions.cloneNode(true));
    if (this.outlineClip) { const definitions = create('defs'); definitions.appendChild(this.outlineClip.cloneNode(true)); content.appendChild(definitions); }
    if (this.mask) {
      const definitions = create('defs');
      definitions.appendChild(this.mask.cloneNode(true));
      content.appendChild(definitions);
    }
    if (this.colorGroup) content.appendChild(this.colorGroup.cloneNode(true));
    if (this.outlineGroup) content.appendChild(this.outlineGroup.cloneNode(true));
    return { ...this.target.snapshot, content: wrapPermanentMasks(content, this.target.snapshot.permanentMaskIds) };
  }

  dispose() {
    if (this.disposed) return;
    const wasActive = Boolean(this.complete);
    this.disposed = true;
    this.stopFrame();
    this.complete = null;
    this.hidden?.cancel(); this.hidden = null;
    this.removeArtifacts();
    if (wasActive) this.pen.hide();
  }
}

/** All pigment being removed shares one paper-space mask. Ghosts retain their
 * original stacking positions, but a rubbed spot clears every ghost at once. */
class SvgErasureTask implements StrokeTask<StrokeTarget> {
  readonly hasColor = false;
  private ghosts: SVGGElement[] = [];
  private layer: SVGElement;
  private mask: SVGMaskElement;
  private brush: SVGPathElement;
  private length: number;
  private duration: number;
  private frame: number | null = null;
  private clock = new DrawingFrameClock();
  private complete: (() => void) | null = null;
  private disposed = false;

  constructor(snapshots: StrokeSnapshot[], definitions: SVGDefsElement, private pen: VirtualPen, canvas: SVGSVGElement) {
    const currentLayer = canvas.querySelector<SVGElement>('[data-scene-layer]') ?? canvas;
    this.layer = currentLayer;
    const maskId = `live-eraser-${++sequence}`;
    const matrixString = (matrix: DOMMatrix) => `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
    for (const snapshot of snapshots) {
      const parent = canvas.contains(snapshot.plane) ? snapshot.plane : currentLayer;
      // The outer wrapper uses paper coordinates in every painting plane.
      // Only its child uses the old object's coordinates. Thus every snapshot
      // references exactly the same mask, including moved/scaled subjects.
      const ghost = create('g', { 'data-playback-artifact': 'erasure', 'data-playback-order': snapshot.order, 'aria-hidden': 'true', 'pointer-events': 'none', transform: matrixString(relativeMatrix(parent, currentLayer).inverse()), opacity: snapshot.inheritedOpacity });
      const transformed = create('g', { transform: matrixString(snapshot.parentToLayer) });
      transformed.appendChild(isolatedSnapshotContent(snapshot.content));
      ghost.appendChild(transformed);
      const before = Array.from(parent.children).find(node => node.getAttribute('data-playback-artifact') === 'erasure'
        ? Number(node.getAttribute('data-playback-order')) > snapshot.order
        : snapshot.planeChildren.indexOf(node) > snapshot.planeIndex) ?? null;
      parent.insertBefore(ghost, before);
      this.ghosts.push(ghost);
    }
    const boxes = this.ghosts.map(ghost => ghost.getBBox());
    // Include pigment bleed and broad contour edges, not just fill geometry.
    const pad = 12 / visibleScale(currentLayer);
    const left = Math.min(...boxes.map(box => box.x)) - pad;
    const top = Math.min(...boxes.map(box => box.y)) - pad;
    const right = Math.max(...boxes.map(box => box.x + box.width)) + pad;
    const bottom = Math.max(...boxes.map(box => box.y + box.height)) + pad;
    const box = { x: left, y: top, width: right - left, height: bottom - top };
    const scale = visibleScale(currentLayer);
    const screenWidth = clamp(Math.min(box.width, box.height) * scale * .18, ERASER_DIAMETER_PX, 72);
    const sweep = createBrushSweep(box, screenWidth / scale);
    this.mask = create('mask', { id: maskId, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse', x: sweep.x, y: sweep.y, width: sweep.width, height: sweep.height, 'mask-type': 'luminance', 'data-playback-artifact': 'erase-mask' });
    this.mask.appendChild(create('rect', { x: sweep.x, y: sweep.y, width: sweep.width, height: sweep.height, fill: 'white' }));
    this.brush = create('path', { d: sweep.d, fill: 'none', stroke: 'black', 'stroke-width': sweep.strokeWidth, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    this.mask.appendChild(this.brush);
    definitions.appendChild(this.mask);
    this.ghosts.forEach(ghost => ghost.setAttribute('mask', `url(#${maskId})`));
    this.length = measuredLength(this.brush);
    this.duration = erasurePlaybackDuration(visiblePathLength(this.brush, this.length, this.layer));
    this.brush.style.strokeDasharray = `${this.length} ${this.length}`;
    this.brush.style.strokeDashoffset = String(this.length);
  }

  retarget() { /* A removed stroke stays in its previous coordinate frame. */ }

  play(_phase: StrokePhase, complete: () => void) {
    this.pen.begin('paper', 'erase');
    if (this.disposed) return;
    this.complete = complete;
    const now = performance.now();
    this.clock.reset(now);
    this.tick(now);
  }

  private tick = (now: number) => {
    if (this.disposed || !this.complete) return;
    const progress = clamp(this.clock.advance(now) / this.duration, 0, 1);
    this.brush.style.strokeDashoffset = String(this.length * (1 - progress));
    this.pen.move(this.brush, this.length * progress, this.layer, 'eraser', Number(this.brush.getAttribute('stroke-width')) * visibleScale(this.layer));
    if (progress >= 1) {
      this.pen.hide();
      const complete = this.complete;
      this.complete = null;
      this.frame = null;
      complete();
    } else this.frame = requestAnimationFrame(this.tick);
  };

  dispose() {
    if (this.disposed) return;
    const wasActive = Boolean(this.complete);
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.complete = null;
    this.ghosts.forEach(ghost => ghost.remove()); this.mask.remove();
    if (wasActive) this.pen.hide();
  }
}

function sceneStrokes(canvas: SVGSVGElement, previous: StrokeEntry<StrokeTarget>[] = []): StrokeEntry<StrokeTarget>[] {
  const entries: StrokeEntry<StrokeTarget>[] = [];
  const priorByVisual = new Map(previous.map(entry => [entry.target.visualKey, entry.target]));
  const occurrences = new Map<string, number>();
  const ownerIndices = new Map<string, number>();
  const references = new Map<string, string>();
  const containers = [
    ...Array.from(canvas.querySelectorAll<SVGElement>('[data-drawing-mark]')),
    ...Array.from(canvas.querySelectorAll<SVGElement>(SHAPES)).filter(shape => !shape.closest('[data-drawing-mark]')),
  ];
  // Document order is the model's intended drawing order. Querying wrappers and
  // legacy shapes separately above must not group them into different timelines.
  containers.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  for (const container of containers) {
    if (container.closest('defs,[data-playback-artifact],[data-playback-decoration]')) continue;
    // A layered wash (pigment, paper grain, grass) is one painting operation.
    // Its children must never become independent tasks which reveal at once.
    const area = container.closest('[data-playback-area="true"]');
    if (area && area !== container) continue;
    const owner = container.closest('[data-object-id],[data-marks-for]');
    if (!owner) continue;
    const geometry = container.hasAttribute('data-drawing-mark')
      ? container.querySelector<SVGElement>('[data-playback-shape]') ?? (area ? Array.from(container.querySelectorAll<SVGElement>(SHAPES)).find(shape => !shape.closest('defs')) : null)
      : container;
    if (!geometry) continue;
    const computed = getComputedStyle(geometry);
    if (Number(container.getAttribute('opacity') ?? 1) <= 0 || Number(geometry.getAttribute('opacity') ?? 1) <= 0 || (computed.fill === 'none' && (computed.stroke === 'none' || Number.parseFloat(computed.strokeWidth) <= 0))) continue;
    const ownerId = owner.getAttribute('data-object-id') || owner.getAttribute('data-marks-for') || '';
    const fingerprint = `${ownerId}|${strokeVisualIdentity(container, canvas, references)}`;
    const occurrence = occurrences.get(fingerprint) ?? 0;
    occurrences.set(fingerprint, occurrence + 1);
    const index = ownerIndices.get(ownerId) ?? 0;
    ownerIndices.set(ownerId, index + 1);
    const key = `${fingerprint}|${occurrence}`;
    const prior = priorByVisual.get(key);
    let snapshot: StrokeSnapshot;
    if (prior?.container === container && prior.geometry === geometry && prior.snapshot.plane.contains(container)) {
      // Streaming one new mark must not clone all earlier textures, filters and
      // eraser masks again. Identity already includes pigment dependencies and
      // ancestor transforms. Refresh stacking only, so later erasure stays exact
      // when a newly added background is inserted behind these same subjects.
      const saved = prior.snapshot, planeChildren = Array.from(saved.plane.children).filter(child => !child.hasAttribute('data-playback-artifact'));
      let top: Node = container;
      while (top.parentNode && top.parentNode !== saved.plane) top = top.parentNode;
      snapshot = {...saved, planeChildren, planeIndex: planeChildren.indexOf(top as Element), order: entries.length};
    } else snapshot = captureSnapshot(container, geometry, canvas, entries.length);
    entries.push({ key, owner: ownerId, target: { container, geometry, snapshot, layoutSlot: `${ownerId}:${index}`, viewportDependent: ownerId.startsWith('background:'), visualKey: key } });
  }
  return entries;
}

type ViewportIdentity = { visualKey: string; layoutSlot: string; viewportDependent: boolean };
/** A resize changes the background's coverage, not the child's drawing. Keep
 * its queued/active task and remember that alias on subsequent normal renders.
 * Changed non-background art invalidates the layout shortcut entirely. */
export function retainViewportStrokeKeys<T extends ViewportIdentity>(entries: StrokeEntry<T>[], previous: StrokeEntry<T>[], layoutOnly: boolean) {
  const sameSubjects = entries.filter(entry => !entry.target.viewportDependent).map(entry => entry.target.visualKey);
  const priorSubjects = previous.filter(entry => !entry.target.viewportDependent).map(entry => entry.target.visualKey);
  const resize = layoutOnly && JSON.stringify(sameSubjects) === JSON.stringify(priorSubjects)
    && JSON.stringify(entries.map(entry => entry.target.layoutSlot)) === JSON.stringify(previous.map(entry => entry.target.layoutSlot));
  const oldByVisual = new Map(previous.map(entry => [entry.target.visualKey, entry]));
  const oldBySlot = new Map(previous.map(entry => [entry.target.layoutSlot, entry]));
  return entries.map(entry => {
    const old = oldByVisual.get(entry.target.visualKey) ?? (resize && entry.target.viewportDependent ? oldBySlot.get(entry.target.layoutSlot) : undefined);
    return old ? { ...entry, key: old.key } : entry;
  });
}

/** Pose-only aliases are granted by a scene comparison, never inferred from
 * similar-looking strokes. New/edited marks still use the ordinary erase path. */
export function retainPoseStrokeKeys<T extends {layoutSlot:string}>(entries: StrokeEntry<T>[], previous: StrokeEntry<T>[], moved: ReadonlySet<string>) {
  const slots = new Map(previous.map(entry => [entry.target.layoutSlot, entry]));
  return entries.map(entry => {
    const old = entry.owner && moved.has(entry.owner) ? slots.get(entry.target.layoutSlot) : undefined;
    return old ? { ...entry, key: old.key } : entry;
  });
}

export class SvgStrokePlayback {
  private queue: StrokePlaybackQueue<StrokeTarget>;
  private pens: VirtualPen[];
  private sounds: DrawingSounds;
  private pace = new DrawingPace();
  private definitions: SVGDefsElement;
  private mode: string | null = null;
  private media: MediaQueryList;
  private motionMode: 'system' | 'draw' | 'still' = 'system';
  private previous: StrokeEntry<StrokeTarget>[] = [];
  private style: string | null = null;
  private regions = new Map<string,SubjectRegion>();
  private confirmedOwners: Set<string> | null = null;

  constructor(private canvas: SVGSVGElement, onDrawingChange: (drawing: boolean) => void) {
    this.definitions = create('defs', { 'data-playback-artifact': 'definitions' });
    canvas.appendChild(this.definitions);
    this.sounds = new DrawingSounds();
    this.pens = Array.from({ length: PAINTER_COUNT }, (_, index) => new VirtualPen(canvas, 'outline', this.sounds, index));
    this.queue = new StrokePlaybackQueue(entry => new SvgStrokeTask(entry.target, this.definitions, this.pens, (now, small) => this.pace.rate(now, this.queue.bufferedCount(), small)), onDrawingChange, 2048, entries => {
      const snapshots = entries.flatMap(({ target, task }) => {
        const snapshot = task instanceof SvgStrokeTask ? task.captureVisible() : target.snapshot;
        return snapshot ? [snapshot] : [];
      });
      return snapshots.length ? new SvgErasureTask(snapshots, this.definitions, this.pens[0], canvas) : null;
    }, owner => this.sounds.finish(owner), (owner,index,busy)=>index<2||independentThirdSubject(owner,busy,this.regions,this.confirmedOwners));
    this.media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.media.addEventListener('change', this.motionChanged);
  }

  reconcile(style: string, resetKey: string | number | undefined, motionMode: 'system' | 'draw' | 'still' = 'system', layoutOnly = false, turn = 0, confirmedOwners: Set<string> | null = null, movedOwners: ReadonlySet<string> = new Set()) {
    const mode = JSON.stringify([resetKey]);
    this.motionMode = motionMode;
    this.sounds.setStyle(style);
    const still = motionMode === 'still' || (motionMode === 'system' && this.media.matches);
    const reset = this.mode !== mode || still;
    if (reset) { this.pens.forEach(pen => pen.resetPosition()); this.sounds.reset(); this.pace.reset(); }
    const entries = retainPoseStrokeKeys(retainViewportStrokeKeys(sceneStrokes(this.canvas, this.previous), this.previous, layoutOnly && this.style === style), this.previous, movedOwners);
    this.confirmedOwners=confirmedOwners;
    this.regions=new Map();
    for(const entry of entries){
      if(!entry.owner)continue;
      try{
        const element=entry.target.geometry as SVGGraphicsElement,box=entry.target.snapshot.bounds,matrix=relativeMatrix(element,this.canvas);
        const points=[[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].map(([x,y])=>({x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f}));
        const next={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))},prior=this.regions.get(entry.owner);
        this.regions.set(entry.owner,prior?{left:Math.min(prior.left,next.left),right:Math.max(prior.right,next.right),top:Math.min(prior.top,next.top),bottom:Math.max(prior.bottom,next.bottom)}:next);
      }catch{this.regions.set(entry.owner,{left:-Infinity,right:Infinity,top:-Infinity,bottom:Infinity});}
    }
    const previousKeys = new Set(this.previous.map(entry => entry.target.visualKey));
    if (entries.some(entry => !previousKeys.has(entry.target.visualKey))) this.pace.supplied(performance.now());
    this.queue.reconcile(entries, reset, turn, movedOwners);
    this.previous = entries;
    this.style = style;
    this.mode = mode;
  }

  private motionChanged = () => {
    if (this.motionMode === 'system' && this.media.matches) {
      this.previous = sceneStrokes(this.canvas);
      this.queue.reconcile(this.previous, true); this.pens.forEach(pen => pen.hide());
    }
  };

  setModelWaiting(waiting: boolean, turn: number) { this.pace.setWaiting(waiting, turn, performance.now()); }

  setSoundEnabled(enabled: boolean) { this.sounds.setEnabled(enabled); }
  setSoundQuiet(quiet: boolean) { this.sounds.setQuiet(quiet); }
  previewSound() { this.sounds.preview(); }

  dispose() {
    this.media.removeEventListener('change', this.motionChanged);
    this.queue.dispose();
    this.pens.forEach(pen => pen.dispose());
    this.sounds.dispose();
    this.definitions.remove();
  }
}

/** Use on an export clone; the canonical SVG geometry is always already final. */
export function removePlaybackArtifacts(svg: SVGElement) {
  svg.querySelectorAll('[data-playback-artifact]').forEach(node => node.remove());
  return svg;
}

export const drawingCursor = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M3 29l2-10L22 2q2-2 4 0l4 4q2 2 0 4L13 27Z" fill="#d6b47e" stroke="#675e4c"/><path d="m3 29 2-10 8 8Z" fill="#efdebb"/><path d="m3 29 1-5 4 4Z" fill="#42483b"/></svg>')}") 3 29, auto`;
