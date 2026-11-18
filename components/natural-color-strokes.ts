/** Pen-down paths only. Repositioning between these paths never reveals paint. */
export type PaintPoint = { x: number; y: number };
export type PaintBox = { x: number; y: number; width: number; height: number };
export type PaintMedium = 'pencil' | 'crayon' | 'watercolor';
export type ColorStroke = { d: string; width: number; points: PaintPoint[] };
export type NaturalColorPlan = { strokes: ColorStroke[]; broad: boolean; bounds: PaintBox };
type Options = {
  scale?: number;
  medium?: PaintMedium;
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
  contains?: (point: PaintPoint) => boolean;
  boundary?: PaintPoint[];
};
export const MAX_COLOR_BRUSH_PX = 64;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const distance = (a: PaintPoint, b: PaintPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const number = (n: number) => Number(n.toFixed(3));

function curve(a: PaintPoint, b: PaintPoint, width: number, bend = .12): ColorStroke {
  const length = distance(a, b), normal = length ? { x: -(b.y - a.y) / length, y: (b.x - a.x) / length } : { x: 0, y: 1 };
  const control = { x: (a.x + b.x) / 2 + normal.x * width * bend, y: (a.y + b.y) / 2 + normal.y * width * bend };
  const points = Array.from({ length: 13 }, (_, index) => {
    const t = index / 12, u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
  });
  return { d: `M ${number(a.x)} ${number(a.y)} Q ${number(control.x)} ${number(control.y)} ${number(b.x)} ${number(b.y)}`, width, points };
}

export function distanceToPaintStroke(point: PaintPoint, stroke: ColorStroke) {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < stroke.points.length; index++) {
    const a = stroke.points[index - 1], b = stroke.points[index];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(.0001, dx * dx + dy * dy), 0, 1);
    nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return nearest;
}

const strokeBounds = new WeakMap<ColorStroke, { left: number; top: number; right: number; bottom: number }>();
/** Same polyline coverage test, with a broad-phase box and squared distance.
 * A local brush patch need not measure every distant sample against every
 * segment. Keep the planned gestures and the coverage margin unchanged. */
export function paintStrokeReaches(point: PaintPoint, stroke: ColorStroke, radius: number): boolean {
  if (!(radius >= 0) || stroke.points.length < 2) return false;
  let box = strokeBounds.get(stroke);
  if (!box) {
    box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const sample of stroke.points) {
      box.left = Math.min(box.left, sample.x); box.top = Math.min(box.top, sample.y);
      box.right = Math.max(box.right, sample.x); box.bottom = Math.max(box.bottom, sample.y);
    }
    strokeBounds.set(stroke, box);
  }
  if (point.x < box.left - radius || point.x > box.right + radius || point.y < box.top - radius || point.y > box.bottom + radius) return false;
  const squaredRadius = radius * radius;
  for (let index = 1; index < stroke.points.length; index++) {
    const a = stroke.points[index - 1], b = stroke.points[index];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(.0001, dx * dx + dy * dy), 0, 1);
    const x = point.x - a.x - t * dx, y = point.y - a.y - t * dy;
    if (x * x + y * y <= squaredRadius) return true;
  }
  return false;
}

/** Geometry length, not an animation ceiling, determines the speed of the hand. */
export function naturalColorStrokeDuration(screenLength: number, medium: PaintMedium, broad = false) {
  const speed = (medium === 'watercolor' ? (broad ? 980 : 650) : medium === 'pencil' ? (broad ? 880 : 620) : (broad ? 960 : 690)) * .85;
  // A dot or petal needs only a brief touch. Long gestures retain their actual
  // travel speed; we save time by doing less work, not by rushing a large wash.
  return Math.max(clamp(45 + screenLength * .6, 45, 150), Math.max(0, screenLength) / speed * 1000);
}

export function penLiftDuration(screenDistance: number) {
  return clamp(16 + Math.sqrt(Math.max(0, screenDistance)) * 3, 16, 105);
}

/** A mild pressure rhythm; never a zero-to-full reveal or an abrupt reversal. */
export function handProgress(t: number) {
  const progress = clamp(t, 0, 1);
  return progress - Math.sin(progress * Math.PI * 2) * .055;
}

function ellipseStrokes(ellipse: NonNullable<Options['ellipse']>, width: number, maxLength: number) {
  const { cx, cy, rx, ry } = ellipse;
  const strokes: ColorStroke[] = [curve({ x: cx - width * .14, y: cy }, { x: cx + width * .14, y: cy }, width, .05)];
  // The tip already reaches the rim. Orbit inside it instead of tracing an
  // extra outer ring whose pigment is mostly clipped away.
  const inset = Math.min(width * .42, Math.min(rx, ry) * .65);
  const outerX = rx - inset, outerY = ry - inset;
  const rings = Math.max(1, Math.ceil(Math.max(outerX, outerY) / (width * .85)));
  for (let ring = 1; ring <= rings; ring++) {
    const r = ring / rings;
    const circumference = Math.PI * (3 * (outerX + outerY) - Math.sqrt((3 * outerX + outerY) * (outerX + 3 * outerY))) * r;
    const sections = Math.max(2, Math.ceil(circumference / maxLength));
    const offset = -.6 + (ring % 3) * .32;
    for (let part = 0; part < sections; part++) {
      // Slightly overlapping arcs cover the join without a final fill flash.
      const start = offset + part * Math.PI * 2 / sections - .035;
      const end = offset + (part + 1) * Math.PI * 2 / sections + .035;
      const points = Array.from({ length: Math.max(9, Math.ceil((end - start) * Math.max(rx, ry) * r / (width * .18))) }, () => ({ x: 0, y: 0 }));
      for (let i = 0; i < points.length; i++) {
        const angle = start + (end - start) * i / (points.length - 1);
        points[i] = { x: cx + Math.cos(angle) * outerX * r, y: cy + Math.sin(angle) * outerY * r };
      }
      const a = points[0], b = points[points.length - 1];
      strokes.push({ d: `M ${number(a.x)} ${number(a.y)} A ${number(outerX * r)} ${number(outerY * r)} 0 ${end - start > Math.PI ? 1 : 0} 1 ${number(b.x)} ${number(b.y)}`, width, points });
    }
  }
  return strokes;
}

/** A single inset orbit covers a small disk, including its center and rim.
 * The brush is clipped to the real shape, so this is still painted progressively. */
function compactEllipseStroke(ellipse: NonNullable<Options['ellipse']>): ColorStroke {
  const { cx, cy, rx, ry } = ellipse;
  const width = Math.min(rx, ry) * 1.25;
  const xRadius = rx - width * .48, yRadius = ry - width * .48;
  const points = Array.from({ length: 65 }, (_, index) => {
    const angle = index * Math.PI * 2 / 64;
    return { x: cx + Math.cos(angle) * xRadius, y: cy + Math.sin(angle) * yRadius };
  });
  return { d: `M ${number(cx+xRadius)} ${number(cy)} A ${number(xRadius)} ${number(yRadius)} 0 0 1 ${number(cx-xRadius)} ${number(cy)} A ${number(xRadius)} ${number(yRadius)} 0 0 1 ${number(cx+xRadius)} ${number(cy)}`, width, points };
}

/** A few neighboring strokes suffice for a small patch, regardless of whether
 * the model encoded it as a path, rectangle or polygon. Each gently curved
 * stroke covers its band completely; the actual art clips corners and holes.
 * These are short pen-down gestures, never a connected back-and-forth sweep. */
function compactPatchStrokes(box: PaintBox, count: number): ColorStroke[] {
  const horizontal = box.width >= box.height;
  const length = horizontal ? box.width : box.height;
  const across = horizontal ? box.height : box.width;
  const band = across / count, brush = band * 1.2;
  return Array.from({ length: count }, (_, index) => {
    const offset = (index + .5) * band;
    const a = { x: box.x + (horizontal ? 0 : offset), y: box.y + (horizontal ? offset : 0) };
    const b = { x: box.x + (horizontal ? length : offset), y: box.y + (horizontal ? offset : length) };
    return curve(a, b, brush, index % 2 ? -.08 : .08);
  });
}

/**
 * Color in nearby patches, following a circle's form when one exists. For an
 * arbitrary SVG fill, the caller samples its real geometry once. A coverage
 * lattice (with a safety overlap) prevents the canonical art filling holes at
 * the end. No hit-testing or planning happens in animation frames.
 */
export function planNaturalColor(box: PaintBox, options: Options = {}): NaturalColorPlan {
  const scale = Math.max(.01, options.scale ?? 1), medium = options.medium ?? 'crayon';
  const width = Math.max(.1, box.width), height = Math.max(.1, box.height);
  const shortest = Math.min(width, height) * scale, longest = Math.max(width, height) * scale, area = width * height * scale * scale;
  const broad = shortest >= 80 && area >= 24000;
  const broadWidth = medium === 'watercolor' ? clamp(Math.sqrt(area) / 3.7, 34, shortest * .5) : medium === 'pencil' ? clamp(Math.sqrt(area) / 4.5, 28, shortest * .42) : clamp(Math.sqrt(area) / 4, 32, shortest * .48);
  // Material texture is already in the static pigment. A colored pencil must
  // not require dozens of extra reveal strokes for the same small shape.
  // Taper the tip continuously instead of the former 64px width cliff.
  const detailWidth = Math.max(3.5, shortest * clamp(.95 - longest / 340, .3, .75));
  const brush = Math.min(MAX_COLOR_BRUSH_PX, Math.max(broad ? broadWidth : 0, detailWidth)) / scale;
  const bounds = { x: box.x - brush, y: box.y - brush, width: width + brush * 2, height: height + brush * 2 };
  const maxLength = Math.max(brush * 1.4, Math.min(brush * (broad ? 5.2 : 3.4), (broad ? 330 : 145) / scale));
  // A tiny detail takes one short touch, not a miniature full-size paint job.
  // Cover the short axis; the canonical shape clips the wider brush precisely.
  if (longest <= 32) {
    const horizontal = width >= height, strokeWidth = Math.min(width, height) * 1.12;
    const a = { x: box.x + (horizontal ? 0 : width / 2), y: box.y + (horizontal ? height / 2 : 0) };
    const b = { x: box.x + (horizontal ? width : width / 2), y: box.y + (horizontal ? height / 2 : height) };
    return { strokes: [curve(a, b, strokeWidth, .02)], broad, bounds };
  }
  // Stems, thin beams and long ears are single-direction gestures along their
  // length. Tiny tiles/rings would turn a 2-pixel strip into hundreds of dabs.
  if (Math.max(width, height) / Math.min(width, height) > 5 && shortest * 1.14 <= MAX_COLOR_BRUSH_PX) {
    const horizontal = width >= height, length = horizontal ? width : height;
    const count = Math.max(1, Math.ceil(length * scale / 200));
    const strokeWidth = Math.min(width, height) * 1.14;
    const strokes = Array.from({ length: count }, (_, index) => {
      const a = length * index / count, b = length * (index + 1) / count;
      return curve(
        { x: box.x + (horizontal ? a : width / 2), y: box.y + (horizontal ? height / 2 : a) },
        { x: box.x + (horizontal ? b : width / 2), y: box.y + (horizontal ? height / 2 : b) },
        strokeWidth, .025 * Math.sin(index * 1.7),
      );
    });
    return { strokes, broad, bounds };
  }
  const ellipse = options.ellipse;
  const compact = longest <= 144 || (longest <= 240 && shortest <= 96);
  if (compact && ellipse && Math.min(ellipse.rx, ellipse.ry) * 1.25 * scale <= MAX_COLOR_BRUSH_PX && ellipse.rx > 0 && ellipse.ry > 0 && Math.max(ellipse.rx, ellipse.ry) / Math.min(ellipse.rx, ellipse.ry) <= 2.5) {
    return { strokes: [compactEllipseStroke(ellipse)], broad, bounds };
  }
  if (compact && !ellipse) {
    return { strokes: compactPatchStrokes(box, Math.max(1, Math.ceil(shortest * 1.2 / MAX_COLOR_BRUSH_PX))), broad, bounds };
  }
  if (ellipse && ellipse.rx > 0 && ellipse.ry > 0 && Math.max(ellipse.rx, ellipse.ry) / Math.min(ellipse.rx, ellipse.ry) <= 2.5) return { strokes: ellipseStrokes(ellipse, brush, maxLength), broad, bounds };
  const contains = options.contains ?? (ellipse ? (point: PaintPoint) => ((point.x - ellipse.cx) / ellipse.rx) ** 2 + ((point.y - ellipse.cy) / ellipse.ry) ** 2 <= 1 : undefined);

  // Every interior pixel is within step / sqrt(2) of a sample. Mark a sample
  // done only inside the remaining brush radius, not merely inside its fringe.
  const step = brush * .25;
  const radius = brush * .5 - step / Math.SQRT2 - .015 * brush;
  const columns = Math.max(1, Math.ceil(width / step)), rows = Math.max(1, Math.ceil(height / step));
  const samples: PaintPoint[] = [];
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const point = { x: box.x + width * column / columns, y: box.y + height * row / rows };
    if (!contains || contains(point)) samples.push(point);
  }
  // Contour samples preserve tiny appendages and boundaries between lattice
  // points. The original geometry remains the clip, including transparent holes.
  samples.push(...(options.boundary ?? []));
  if (!samples.length) samples.push({ x: box.x + width / 2, y: box.y + height / 2 });
  const strokes: ColorStroke[] = [];
  const covered = new Set<number>();
  const tileSize = Math.max(brush * 1.5, maxLength / 1.35);
  const tileColumns = Math.max(1, Math.ceil(width / tileSize)), tileRows = Math.max(1, Math.ceil(height / tileSize));
  const tileWidth = width / tileColumns, tileHeight = height / tileRows;
  for (let tileRow = 0; tileRow < tileRows; tileRow++) for (let visit = 0; visit < tileColumns; visit++) {
    const tileColumn = tileRow % 2 ? tileColumns - 1 - visit : visit;
    const cx = box.x + (tileColumn + .5) * tileWidth, cy = box.y + (tileRow + .5) * tileHeight;
    const seed = tileColumn * 1.79 + tileRow * 2.43;
    const angle = medium === 'pencil' ? -.65 + Math.sin(seed) * .26 : -.5 + Math.sin(seed) * .9;
    const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
    const corners = [[-tileWidth / 2, -tileHeight / 2], [tileWidth / 2, -tileHeight / 2], [-tileWidth / 2, tileHeight / 2], [tileWidth / 2, tileHeight / 2]];
    const extent = Math.max(...corners.map(([x, y]) => Math.abs(x * nx + y * ny)));
    const passes = Math.max(1, Math.ceil(extent * 2 / (brush * .68)));
    for (let pass = 0; pass < passes; pass++) {
      const across = -extent + (pass + .5) * extent * 2 / passes;
      const center = { x: cx + nx * across, y: cy + ny * across };
      let lo = -Number.POSITIVE_INFINITY, hi = Number.POSITIVE_INFINITY;
      for (const [position, direction, half] of [[center.x - cx, dx, tileWidth / 2], [center.y - cy, dy, tileHeight / 2]]) {
        if (Math.abs(direction) < .00001) continue;
        const a = (-half - position) / direction, b = (half - position) / direction;
        lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
      }
      if (hi < lo || !Number.isFinite(lo + hi)) continue;
      // The round tip reaches the patch corners; overlap hides the joins between
      // neighboring patches. These extensions are clipped by the original art.
      lo -= brush * .22; hi += brush * .22;
      const reverse = (pass + tileColumn) % 3 === 1;
      const a = { x: center.x + dx * (reverse ? hi : lo), y: center.y + dy * (reverse ? hi : lo) };
      const b = { x: center.x + dx * (reverse ? lo : hi), y: center.y + dy * (reverse ? lo : hi) };
      const stroke = curve(a, b, brush, .12 * Math.sin(seed + pass * .7) + .06);
      const reached: number[] = [];
      for (let index = 0; index < samples.length; index++) {
        if (covered.has(index)) continue;
        if (paintStrokeReaches(samples[index], stroke, radius)) reached.push(index);
      }
      if (!contains || reached.length) {
        strokes.push(stroke);
        reached.forEach(index => covered.add(index));
      }
    }
  }
  // Boundary/concavity finishing touches are local dabs, not a global reveal.
  // Check the actual union at a generous fringe before adding them: the lattice
  // overlap is already conservative and most points are covered by a neighbor.
  for (let index = 0; index < samples.length; index++) {
    if (covered.has(index)) continue;
    const point = samples[index];
    if (strokes.some(stroke => paintStrokeReaches(point, stroke, brush * .45))) continue;
    const stroke = curve({ x: point.x - brush * .08, y: point.y }, { x: point.x + brush * .08, y: point.y }, brush, .08);
    strokes.push(stroke);
    for (let next = index + 1; next < samples.length; next++) if (paintStrokeReaches(samples[next], stroke, radius)) covered.add(next);
  }
  return { strokes, broad, bounds };
}

/** Keep brush contact on actual pigment, splitting around holes and empty gaps.
 * This runs once before playback; lift travel between pieces reveals nothing. */
export function contactColorStrokes(strokes: ColorStroke[], contains?: (point: PaintPoint) => boolean, boundary: PaintPoint[] = []): ColorStroke[] {
  if (!contains) return strokes;
  const result: ColorStroke[] = [];
  for (const stroke of strokes) {
    let run: PaintPoint[] = [];
    const flush = () => {
      if (run.length === 1) run.push({x:run[0].x+.001,y:run[0].y});
      if (run.length > 1) result.push({width:stroke.width,points:run,d:run.map((point,index)=>`${index?'L':'M'} ${number(point.x)} ${number(point.y)}`).join(' ')});
      run=[];
    };
    for (let index=1;index<stroke.points.length;index++) {
      const a=stroke.points[index-1],b=stroke.points[index];
      const count=Math.max(1,Math.ceil(distance(a,b)/Math.max(.3,stroke.width*.12)));
      for(let step=index===1?0:1;step<=count;step++){
        const t=step/count, point={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
        if(contains(point))run.push(point);else flush();
      }
    }
    flush();
  }
  // Very thin/disconnected islands can fall between contact centerlines. Add
  // local touches on their real boundary, never reveal missed pigment at finish.
  const brush=strokes[0]?.width;
  if(brush)for(const point of boundary){
    if(result.some(stroke=>paintStrokeReaches(point,stroke,stroke.width*.48)))continue;
    result.push(curve(point,{x:point.x+.001,y:point.y},brush,0));
  }
  return result;
}
