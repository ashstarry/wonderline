import { localToPaper } from './object-pose';
import type { DrawingMark, Scene, SceneObject } from './scene';
import { sceneSchema } from './scene-validation';
import { DEFAULT_PAPER, isPaperViewport, type PaperViewport } from './paper-viewport';

export type HandPoint = { x: number; y: number };
export type HandSymmetry = 'none' | 'mirror';
export type HandStrokeTarget = { objectId: string; markIndex: number };
const PATH_LIMIT = 2500;
const MARK_LIMIT = 100;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const coordinate = (value: number) => Math.round(value * 10) / 10;
export const isHandObject = (object: SceneObject) => object.kind === 'drawing' && /^hand-/.test(object.id);

export function pointSegmentDistance(point: HandPoint, start: HandPoint, end: HandPoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}

/** Retain corners and endpoints; bounded chunks avoid recursion and quadratic work on long scribbles. */
export function simplifyHandPoints(points: readonly HandPoint[], tolerance = .6, paper: PaperViewport = DEFAULT_PAPER): HandPoint[] {
  return simplifyPointChunks(points, tolerance, paper, 512);
}

function simplifyPointChunks(points: readonly HandPoint[], tolerance: number, paper: PaperViewport, chunkSize: number): HandPoint[] {
  const viewport = isPaperViewport(paper) ? paper : DEFAULT_PAPER;
  const clean = points.map(point => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('这笔没有画好，请再试一次。');
    return { x: clamp(coordinate(point.x), viewport.x, viewport.x + viewport.width), y: clamp(coordinate(point.y), viewport.y, viewport.y + viewport.height) };
  }).filter((point, index, all) => !index || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  if (clean.length < 3) return clean;
  const result: HandPoint[] = [];
  for (let offset = 0; offset < clean.length - 1; offset += chunkSize - 1) {
    const chunk = clean.slice(offset, offset + chunkSize);
    const keep = new Set([0, chunk.length - 1]);
    const pending = [[0, chunk.length - 1]];
    while (pending.length) {
      const [start, end] = pending.pop()!;
      let furthest = -1, distance = tolerance;
      for (let index = start + 1; index < end; index++) {
        const next = pointSegmentDistance(chunk[index], chunk[start], chunk[end]);
        if (next > distance) { distance = next; furthest = index; }
      }
      if (furthest !== -1) { keep.add(furthest); pending.push([start, furthest], [furthest, end]); }
    }
    const simplified = [...keep].sort((a, b) => a - b).map(index => chunk[index]);
    result.push(...(offset ? simplified.slice(1) : simplified));
  }
  return result;
}

/** A long gesture is split into connected marks, never truncated to fit a path limit. */
export function handStrokePaths(points: readonly HandPoint[], paper: PaperViewport = DEFAULT_PAPER): string[] {
  const viewport = isPaperViewport(paper) ? paper : DEFAULT_PAPER;
  const simplified = simplifyHandPoints(points, .6, viewport);
  if (!simplified.length) throw new Error('先在纸上画一笔吧。');
  if (simplified.length === 1) {
    const { x, y } = simplified[0];
    const step = Math.min(.1, viewport.width / 2);
    const end = x + step <= viewport.x + viewport.width ? x + step : x - step;
    const endX = clamp(coordinate(end), viewport.x, viewport.x + viewport.width);
    return [`M${x} ${y}L${endX === x ? end : endX} ${y}`];
  }
  const paths: string[] = [];
  let path = `M${simplified[0].x} ${simplified[0].y}`;
  for (let index = 1; index < simplified.length; index++) {
    const point = simplified[index];
    const line = `L${point.x} ${point.y}`;
    if (path.length + line.length > PATH_LIMIT) {
      paths.push(path);
      const previous = simplified[index - 1];
      path = `M${previous.x} ${previous.y}`;
    }
    path += line;
  }
  paths.push(path);
  return paths;
}

export function appendHandStroke(scene: Scene, points: readonly HandPoint[], color: string, width: number): Scene {
  validateHandStyle(color, width);
  return appendHandPaths(scene, handStrokePaths(points, scene.paper ?? DEFAULT_PAPER), color, width);
}

/** A paired path is painted once, so touching/crossing the axis never darkens a seam. */
export function mirrorHandStrokePaths(points: readonly HandPoint[], paper: PaperViewport = DEFAULT_PAPER): string[] {
  const viewport = isPaperViewport(paper) ? paper : DEFAULT_PAPER;
  const axisTwice = viewport.x * 2 + viewport.width;
  // Preview runs while the pointer moves. Smaller bounded chunks keep an
  // intentionally jagged, long scribble from monopolizing an animation frame.
  const clean = simplifyPointChunks(points, .6, viewport, 64);
  if (!clean.length) throw new Error('先在纸上画一笔吧。');
  if (clean.length === 1) {
    const start = clean[0];
    const step = Math.min(.1, viewport.width / 2);
    const end = start.x + step <= viewport.x + viewport.width ? start.x + step : start.x - step;
    const rounded = clamp(coordinate(end), viewport.x, viewport.x + viewport.width);
    clean.push({ x: rounded === start.x ? end : rounded, y: start.y });
  }
  const reflected = clean.map(point => ({ x: clamp(Number((axisTwice - point.x).toFixed(6)), viewport.x, viewport.x + viewport.width), y: point.y }));
  const token = (point: HandPoint, command: 'M' | 'L') => `${command}${point.x} ${point.y}`;
  const sameAxis = clean.every((point, index) => point.x === reflected[index].x);
  const paths: string[] = [];
  let original = token(clean[0], 'M'), mirror = token(reflected[0], 'M');
  for (let index = 1; index < clean.length; index++) {
    const line = token(clean[index], 'L'), reflection = token(reflected[index], 'L');
    if (original.length + line.length + (sameAxis ? 0 : mirror.length + reflection.length) > PATH_LIMIT) {
      paths.push(original + (sameAxis ? '' : mirror));
      original = token(clean[index - 1], 'M'); mirror = token(reflected[index - 1], 'M');
    }
    original += line; mirror += reflection;
  }
  paths.push(original + (sameAxis ? '' : mirror));
  return paths;
}

/** Both halves are committed atomically as one undoable gesture. */
export function appendMirrorHandStroke(scene: Scene, points: readonly HandPoint[], color: string, width: number): Scene {
  validateHandStyle(color, width);
  if (points.length > 20_000) throw new Error('这一笔画得太长了，还没有保存。请分成几笔来画吧。');
  return appendHandPaths(scene, mirrorHandStrokePaths(points, scene.paper ?? DEFAULT_PAPER), color, width);
}

function validateHandStyle(color: string, width: number) {
  if (!/^#[\da-f]{6}$/i.test(color) || !Number.isFinite(width) || width < 1 || width > 24) {
    throw new Error('请重新选一下画笔的颜色和粗细。');
  }
}

function appendHandPaths(scene: Scene, paths: readonly string[], color: string, width: number): Scene {
  const marks: DrawingMark[] = paths.map(d => ({ type: 'path', d, fill: 'none', stroke: color, strokeWidth: width }));
  const objects = [...scene.objects];
  let nextId = objects.reduce((last, object) => Math.max(last, /^hand-\d+$/.test(object.id) ? Number(object.id.slice(5)) : 0), 0) + 1;
  // Only append to the topmost, untransformed hand layer, preserving its visual stacking.
  let destination = objects.at(-1);
  if (!destination || !isHandObject(destination) || destination.x !== 0 || destination.y !== 0 || destination.scale !== 1 || Boolean(destination.rotation) || (destination.marks?.length ?? 0) >= MARK_LIMIT) destination = undefined;
  else {
    destination = { ...destination, marks: [...(destination.marks ?? [])] };
    objects[objects.length - 1] = destination;
  }
  for (const mark of marks) {
    if (!destination || destination.marks!.length >= MARK_LIMIT) {
      while (objects.some(object => object.id === `hand-${nextId}`)) nextId++;
      destination = { id: `hand-${nextId++}`, kind: 'drawing', x: 0, y: 0, scale: 1, color, label: '小朋友自己画的笔触', marks: [] };
      objects.push(destination);
    }
    destination.marks!.push(mark);
  }
  const next = { ...scene, objects };
  if (!sceneSchema.safeParse(next).success) throw new Error('这张画已经很丰富啦。这一笔没有保存，可以先撤销或擦掉几笔，再继续画。');
  return next;
}

function handPolylines(mark: DrawingMark): HandPoint[][] | null {
  if (mark.type === 'line') return [[{ x: mark.x!, y: mark.y! }, { x: mark.x2!, y: mark.y2! }]];
  // Hand-drawn marks use absolute M/L only. Curves subsequently made by AI are deliberately not treated as original hand strokes.
  if (mark.type !== 'path' || !mark.d || /[^ML\d.+\-\s]/.test(mark.d)) return null;
  return mark.d.split(/(?=M)/).filter(Boolean).map(path => [...path.matchAll(/[ML]([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)/g)].map(pair => ({ x: Number(pair[1]), y: Number(pair[2]) })));
}

export function findHandStroke(scene: Scene, point: HandPoint, radius = 14): HandStrokeTarget | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(radius) || radius < 0) return null;
  let closest = Infinity;
  let target: HandStrokeTarget | null = null;
  for (let objectIndex = scene.objects.length - 1; objectIndex >= 0; objectIndex--) {
    const object = scene.objects[objectIndex];
    if (!isHandObject(object)) continue;
    for (let markIndex = (object.marks?.length ?? 0) - 1; markIndex >= 0; markIndex--) {
      const mark = object.marks![markIndex];
      const lines = handPolylines(mark);
      if (!lines?.length) continue;
      let distance = Infinity;
      for (const line of lines) {
        const points = line.map(local => localToPaper(local, object));
        for (let index = 1; index < points.length; index++) distance = Math.min(distance, pointSegmentDistance(point, points[index - 1], points[index]));
      }
      if (distance <= radius + (mark.strokeWidth ?? 1) * object.scale / 2 && distance < closest) {
        closest = distance; target = { objectId: object.id, markIndex };
      }
    }
  }
  return target;
}

export function eraseHandStroke(scene: Scene, hit: HandPoint | readonly HandStrokeTarget[], radius = 14): Scene {
  const targets: readonly HandStrokeTarget[] = 'x' in hit ? (() => { const nearest = findHandStroke(scene, hit, radius); return nearest ? [nearest] : []; })() : hit;
  if (!targets.length) return scene;
  let changed = false;
  const objects = scene.objects.flatMap(object => {
    if (!isHandObject(object)) return [object];
    const indices = new Set(targets.filter(target => target.objectId === object.id).map(target => target.markIndex));
    const marks = object.marks?.filter((_, index) => !indices.has(index));
    if (marks?.length === object.marks?.length) return [object];
    changed = true;
    return marks?.length ? [{ ...object, marks }] : [];
  });
  return changed ? { ...scene, objects } : scene;
}
