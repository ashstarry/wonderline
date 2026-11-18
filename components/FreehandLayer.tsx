'use client';
import { useLanguage } from './LanguageProvider';

import { useEffect, useImperativeHandle, useRef, useState, type Ref, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_PAPER, type PaperViewport } from '../lib/paper-viewport';
import type { Scene } from '../lib/scene';
import { appendHandStroke, appendMirrorHandStroke, mirrorHandStrokePaths, simplifyHandPoints, type HandPoint, type HandSymmetry } from '../lib/freehand';
import { appendErasure } from '../lib/eraser';
import { drawingCursor, ERASER_DIAMETER_PX } from './svg-stroke-playback';
import { LiveErasurePreview } from './live-erasure-preview';
import type { EraserShape } from '../lib/eraser-shape';
import { manualEraserWidth } from '../lib/manual-tools';

export type FreehandTool = 'pen' | 'eraser' | 'none';
export type FreehandControls = { cancelGesture: () => boolean };
type Props = {
  scene: Scene;
  viewport?: PaperViewport;
  tool: FreehandTool;
  color: string;
  width: number;
  /** Opt-in manual pen decoration; does not affect the eraser or AI drawing. */
  symmetry?: HandSymmetry;
  eraserShape?: EraserShape;
  disabled?: boolean;
  /** Effective motion preference from the page; true skips cancellation motion. */
  reducedMotion?: boolean;
  controlsRef?: Ref<FreehandControls>;
  onCommit: (scene: Scene, phrase: string) => void;
  onError: (message: string) => void;
  onPreview?: (scene: Scene | null) => void;
};
type Gesture = { source: Scene; id: string; pointerId: number; base: Scene; points: HandPoint[]; tool: 'pen' | 'eraser'; color: string; width: number; shape: EraserShape; symmetry: HandSymmetry; erasure?: LiveErasurePreview };
type EraserCursor = HandPoint & { radius: number; scale: number };
type CancelledDraft = {
  id: string; d: string; color: string; width: number; eraserWidth: number; scale: number;
  points: Array<HandPoint & { distance: number }>; length: number;
  bounds: { x: number; y: number; width: number; height: number };
  duration: number; elapsed: number; previous: number | null; progress: number;
  erasePath?: string; mirrorAxisTwice?: number;
};

function draftPath(points: readonly HandPoint[], viewport: PaperViewport) {
  const rendered = points.map(point => ({ x: Number(point.x.toFixed(1)), y: Number(point.y.toFixed(1)) }));
  if (rendered.length === 1) {
    const end = rendered[0];
    rendered.push({ x: Number((end.x >= viewport.x + viewport.width - .1 ? end.x - .1 : end.x + .1).toFixed(1)), y: end.y });
  }
  return { d: rendered.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(''), points: rendered };
}

function cancellationPosition(draft: CancelledDraft): HandPoint {
  const distance = draft.length * draft.progress;
  const endIndex = draft.points.findIndex(point => point.distance >= distance);
  if (endIndex <= 0) return draft.points[endIndex === 0 ? 0 : draft.points.length - 1];
  const a = draft.points[endIndex - 1], b = draft.points[endIndex];
  const progress = (distance - a.distance) / Math.max(.001, b.distance - a.distance);
  return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
}
const MAX_GESTURE_POINTS = 20_000;
/** Only the active pointer draft lives here. Committed marks stay in the shared editable Scene. */
export default function FreehandLayer({ scene, viewport = scene.paper ?? DEFAULT_PAPER, tool, color, width, symmetry = 'none', eraserShape = 'round', disabled = false, reducedMotion = false, controlsRef, onCommit, onError, onPreview }: Props) {
 const {t}=useLanguage();
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const previewFrame = useRef<number | null>(null);
  const cursorFrame = useRef<number | null>(null);
  const cursorPoint = useRef<HandPoint | null>(null);
  const cancellationFrame = useRef<number | null>(null);
  const cancellations = useRef<CancelledDraft[]>([]);
  const motion = useRef(reducedMotion);
  motion.current = reducedMotion;
  const size = useRef(width);
  size.current = width;
  const callbacks = useRef({ onCommit, onError, onPreview });
  callbacks.current = { onCommit, onError, onPreview };
  const [draft, setDraft] = useState('');
  const [eraser, setEraser] = useState<EraserCursor | null>(null);
  const [cancelledDrafts, setCancelledDrafts] = useState<CancelledDraft[]>([]);

  const boundPoint = (point: HandPoint) => ({ x: Math.max(viewport.x, Math.min(viewport.x + viewport.width, point.x)), y: Math.max(viewport.y, Math.min(viewport.y + viewport.height, point.y)) });
  const onPaper = (point: HandPoint) => point.x >= viewport.x && point.x <= viewport.x + viewport.width && point.y >= viewport.y && point.y <= viewport.y + viewport.height;
  function paperExit(start: HandPoint, end: HandPoint): HandPoint {
    const dx=end.x-start.x,dy=end.y-start.y;let fraction=1;
    if(end.x<viewport.x)fraction=Math.min(fraction,(viewport.x-start.x)/dx);
    else if(end.x>viewport.x+viewport.width)fraction=Math.min(fraction,(viewport.x+viewport.width-start.x)/dx);
    if(end.y<viewport.y)fraction=Math.min(fraction,(viewport.y-start.y)/dy);
    else if(end.y>viewport.y+viewport.height)fraction=Math.min(fraction,(viewport.y+viewport.height-start.y)/dy);
    return boundPoint({x:start.x+dx*fraction,y:start.y+dy*fraction});
  }
  function animateCancellation(now: number) {
    cancellationFrame.current = null;
    const active = cancellations.current[0];
    if (!active) return;
    // A hidden tab should resume the short gesture, not finish it in one jump.
    if (active.previous !== null) active.elapsed += Math.max(0, Math.min(40, now - active.previous));
    active.previous = now;
    const t = Math.min(1, active.elapsed / active.duration);
    active.progress = t * t * (3 - 2 * t);
    if (t >= 1) cancellations.current.shift();
    setCancelledDrafts([...cancellations.current]);
    if (cancellations.current.length) cancellationFrame.current = requestAnimationFrame(animateCancellation);
  }
  function eraseCancelledDraft(active: Gesture) {
    if (active.tool !== 'pen' || !active.points.length || motion.current) return;
    const paper = active.base.paper ?? DEFAULT_PAPER;
    const mirrored = active.symmetry === 'mirror';
    const path = draftPath(mirrored ? simplifyHandPoints(active.points, .6, paper) : active.points, paper);
    const mirrorAxisTwice = mirrored ? paper.x * 2 + paper.width : undefined;
    let length = 0;
    const points = path.points.map((point, index) => {
      if (index) length += Math.hypot(point.x - path.points[index - 1].x, point.y - path.points[index - 1].y);
      return { ...point, distance: length };
    });
    const scale = screenScale();
    const eraserWidth = Math.max(active.width + 6, ERASER_DIAMETER_PX / scale);
    const xs = points.map(point => point.x);
    if (mirrorAxisTwice !== undefined) xs.push(...points.map(point => mirrorAxisTwice - point.x));
    const left = Math.min(...xs) - eraserWidth;
    const top = Math.min(...points.map(point => point.y)) - eraserWidth;
    const right = Math.max(...xs) + eraserWidth;
    const bottom = Math.max(...points.map(point => point.y)) + eraserWidth;
    cancellations.current.push({
      id: active.id, d: mirrored ? mirrorHandStrokePaths(active.points, paper).join('') : path.d, color: active.color, width: active.width, eraserWidth, scale,
      ...(mirrored ? { erasePath: path.d, mirrorAxisTwice } : {}),
      points, length: Math.max(.1, length), bounds: { x: left, y: top, width: right - left, height: bottom - top },
      duration: Math.max(250, Math.min(450, 240 + Math.sqrt(length * scale) * 5)), elapsed: 0, previous: null, progress: 0,
    });
    setCancelledDrafts([...cancellations.current]);
    if (cancellationFrame.current === null) cancellationFrame.current = requestAnimationFrame(animateCancellation);
  }
  function clear(keepCursor = false, cancelled = true) {
    const previous = gesture.current;
    // Only a cancelled, already-visible draft becomes a temporary local ghost.
    // Successful pointer-up commits stay immediate and never enter this queue.
    if (previous && cancelled) eraseCancelledDraft(previous);
    previous?.erasure?.dispose();
    gesture.current = null;
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    previewFrame.current = null;
    if (previous && svg.current?.hasPointerCapture(previous.pointerId)) svg.current.releasePointerCapture(previous.pointerId);
    setDraft('');
    if (!keepCursor) showEraser(null);
    callbacks.current.onPreview?.(null);
  }
  useImperativeHandle(controlsRef, () => ({
    cancelGesture() {
      if (!gesture.current) return false;
      clear();
      return true;
    },
  }), []);
  useEffect(() => {
    if (gesture.current && (disabled || tool !== gesture.current.tool || scene !== gesture.current.source || eraserShape !== gesture.current.shape || (gesture.current.tool === 'pen' && symmetry !== gesture.current.symmetry))) clear();
    if (disabled || tool !== 'eraser') showEraser(null);
  }, [disabled, tool, scene, eraserShape, symmetry]);
  useEffect(() => {
    const active = gesture.current;
    const paper = active?.base.paper;
    if (active?.symmetry === 'mirror' && paper && (paper.x !== viewport.x || paper.y !== viewport.y || paper.width !== viewport.width || paper.height !== viewport.height)) clear();
  }, [viewport]);
  useEffect(() => {
    if (!gesture.current && cursorPoint.current) showEraser(cursorPoint.current);
  }, [width, viewport]);
  useEffect(() => {
    if (!reducedMotion) return;
    if (cancellationFrame.current !== null) cancelAnimationFrame(cancellationFrame.current);
    cancellationFrame.current = null; cancellations.current = []; setCancelledDrafts([]);
  }, [reducedMotion]);
  useEffect(() => () => {
    if (cancellationFrame.current !== null) cancelAnimationFrame(cancellationFrame.current);
    cancellations.current = [];
    if (previewFrame.current !== null) cancelAnimationFrame(previewFrame.current);
    if (cursorFrame.current !== null) cancelAnimationFrame(cursorFrame.current);
    gesture.current?.erasure?.dispose();
    if (gesture.current) callbacks.current.onPreview?.(null);
    gesture.current = null;
  }, []);

  function position(clientX: number, clientY: number): HandPoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    try {
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
      return Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
    } catch { return null; }
  }
  function screenScale() {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? Math.max(.001, Math.hypot(matrix.a, matrix.b)) : 1;
  }
  function eraserWidth(scale: number) {
    return manualEraserWidth(size.current, scale);
  }
  function showEraser(point: HandPoint | null) {
    cursorPoint.current = !disabled && tool === 'eraser' && point && onPaper(point) ? point : null;
    if (cursorFrame.current !== null) return;
    cursorFrame.current = requestAnimationFrame(() => {
      cursorFrame.current = null;
      const next = cursorPoint.current;
      if (!next) { setEraser(null); return; }
      const scale = screenScale();
      setEraser({ ...next, radius: (gesture.current?.width ?? eraserWidth(scale)) / 2, scale });
    });
  }
  function previewErasure() {
    if (previewFrame.current !== null) return;
    previewFrame.current = requestAnimationFrame(() => {
      previewFrame.current = null;
      const active = gesture.current;
      if (!active || active.tool !== 'eraser') return;
      try {
        active.erasure?.update(active.points);
      } catch (error) {
        clear(); callbacks.current.onError(error instanceof Error ? error.message : '这次没有擦好，请再试一次。');
      }
    });
  }
  function update(point: HandPoint) {
    const active = gesture.current;
    if (!active) return;
    if (active.tool === 'eraser' && !onPaper(point)) {
      const previous = active.points.at(-1);
      if (previous) update(paperExit(previous, point));
      finish(null);
      return;
    }
    const bounded = boundPoint(point);
    const previous = active.points.at(-1);
    if (!previous || Math.hypot(bounded.x - previous.x, bounded.y - previous.y) >= .5) active.points.push(bounded);
    if (active.points.length > MAX_GESTURE_POINTS) {
      clear(); callbacks.current.onError('这一笔画得太长了，还没有保存。请分成几笔来画吧。'); return;
    }
    if (active.tool === 'eraser') {
      showEraser(bounded);
      previewErasure();
      return;
    }
    if (active.symmetry === 'mirror') {
      // Coalesced pointer samples share one preview calculation per frame.
      if (previewFrame.current === null) previewFrame.current = requestAnimationFrame(() => {
        previewFrame.current = null;
        const current = gesture.current;
        if (current?.tool === 'pen' && current.symmetry === 'mirror') {
          try { setDraft(mirrorHandStrokePaths(current.points, current.base.paper ?? DEFAULT_PAPER).join('')); }
          catch (error) { clear(); callbacks.current.onError(error instanceof Error ? error.message : '这笔没有保存，请再试一次。'); }
        }
      });
    } else setDraft(draftPath(active.points, active.base.paper ?? DEFAULT_PAPER).d);
  }
  function down(event: ReactPointerEvent<SVGSVGElement>) {
    if (disabled || tool === 'none' || gesture.current || !event.isPrimary || event.button !== 0) return;
    const point = position(event.clientX, event.clientY);
    // Every point inside the shared adaptive viewBox is drawing paper.
    if (!point || !onPaper(point)) return;
    event.preventDefault();
    gesture.current = { id: crypto.randomUUID(), pointerId: event.pointerId, source: scene, base: {...scene,paper:viewport}, points: [], tool, color, shape: eraserShape, symmetry: tool === 'pen' ? symmetry : 'none', width: tool === 'eraser' ? eraserWidth(screenScale()) : width };
    if (tool === 'eraser') {
      const pigment = svg.current?.parentElement?.querySelector<SVGGElement>('[data-pigment-layer]');
      if (!pigment) { gesture.current = null; callbacks.current.onError('画纸还在准备，稍后再擦一下。'); return; }
      try { gesture.current.erasure = new LiveErasurePreview(pigment, gesture.current.base, viewport, gesture.current.width, gesture.current.id, gesture.current.shape); }
      catch { gesture.current = null; callbacks.current.onError('橡皮还没准备好，请再试一次。'); return; }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    update(point);
  }
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    if (!gesture.current) {
      showEraser(position(event.clientX, event.clientY));
      return;
    }
    if (event.pointerId !== gesture.current.pointerId) return;
    event.preventDefault();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const matrix = svg.current?.getScreenCTM()?.inverse();
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      const point = matrix ? new DOMPoint(sample.clientX,sample.clientY).matrixTransform(matrix) : null;
      if (point) update(point);
    }
  }
  function up(event: ReactPointerEvent<SVGSVGElement>) {
    if (!gesture.current || event.pointerId !== gesture.current.pointerId) return;
    const point = position(event.clientX, event.clientY);
    if (point) update(point);
    finish(point);
  }
  function finish(cursor: HandPoint | null) {
    const active = gesture.current;
    if (!active) return;
    try {
      // Include the release point synchronously even when its animation frame has not run.
      active.erasure?.update(active.points);
      const next = active.tool === 'pen' ? (active.symmetry === 'mirror' ? appendMirrorHandStroke : appendHandStroke)(active.base, active.points, active.color, active.width) : appendErasure(active.base, active.points, active.width, active.id, active.erasure?.targets(), active.shape);
      clear(active.tool === 'eraser', false);
      if (active.tool === 'eraser') showEraser(cursor);
      if (next !== active.base) callbacks.current.onCommit(next, active.tool === 'pen' ? '我自己用画笔添了一笔' : '我用橡皮擦掉了一小块画面');
    } catch (error) {
      clear(); callbacks.current.onError(error instanceof Error ? error.message : '这笔没有保存，请再试一次。');
    }
  }
  const enabled = !disabled && tool !== 'none';
  return <svg ref={svg} className="freehand-layer" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} preserveAspectRatio="xMidYMid meet"
    data-freehand-tool={tool} data-freehand-enabled={enabled} role="img" aria-label={t(tool === 'eraser' ? '按住拖动，擦掉经过的画面' : '用鼠标或手指在画纸上画画')}
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: enabled ? 'auto' : 'none', touchAction: enabled ? 'none' : 'auto', cursor: tool === 'pen' ? drawingCursor : eraser ? 'none' : 'crosshair' }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up}
    onPointerEnter={event => showEraser(position(event.clientX, event.clientY))}
    onPointerLeave={() => { if (!gesture.current) showEraser(null); }}
    onPointerCancel={event => { if (gesture.current?.pointerId === event.pointerId) clear(); }}
    onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) clear(); }}>
    {enabled && tool === 'pen' && symmetry === 'mirror' && <line data-freehand-mirror-guide="true" data-playback-decoration="true" x1={viewport.x + viewport.width / 2} x2={viewport.x + viewport.width / 2} y1={viewport.y} y2={viewport.y + viewport.height} stroke="#9fae88" strokeOpacity=".55" strokeWidth="1" strokeDasharray="5 8" vectorEffect="non-scaling-stroke" pointerEvents="none" aria-hidden="true" />}
    {cancelledDrafts.map((cancelled, index) => {
      const maskId = `cancel-draft-${cancelled.id}`;
      const cursor = cancellationPosition(cancelled);
      return <g key={cancelled.id} data-freehand-cancelled-draft="true" data-cancel-progress={cancelled.progress} pointerEvents="none" aria-hidden="true">
        <defs><mask id={maskId} {...cancelled.bounds} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style={{ maskType: 'luminance' }}>
          <rect {...cancelled.bounds} fill="white" />
          <path d={cancelled.erasePath ?? cancelled.d} fill="none" stroke="black" strokeWidth={cancelled.eraserWidth} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={`${cancelled.length} ${cancelled.length}`} strokeDashoffset={cancelled.length * (1 - cancelled.progress)} visibility={cancelled.progress > 0 ? 'visible' : 'hidden'} />
          {cancelled.mirrorAxisTwice !== undefined && <path d={cancelled.erasePath} transform={`translate(${cancelled.mirrorAxisTwice} 0) scale(-1 1)`} fill="none" stroke="black" strokeWidth={cancelled.eraserWidth} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={`${cancelled.length} ${cancelled.length}`} strokeDashoffset={cancelled.length * (1 - cancelled.progress)} visibility={cancelled.progress > 0 ? 'visible' : 'hidden'} />}
        </mask></defs>
        <path d={cancelled.d} fill="none" stroke={cancelled.color} strokeWidth={cancelled.width} strokeLinecap="round" strokeLinejoin="round" mask={`url(#${maskId})`} />
        {index === 0 && <circle data-cancel-eraser="true" cx={cursor.x} cy={cursor.y} r={cancelled.eraserWidth / 2} fill="#fffdf7" fillOpacity=".3" stroke="#746b5d" strokeWidth={1.25 / cancelled.scale} />}
        {index === 0 && cancelled.mirrorAxisTwice !== undefined && <circle data-cancel-eraser-mirror="true" cx={cancelled.mirrorAxisTwice - cursor.x} cy={cursor.y} r={cancelled.eraserWidth / 2} fill="#fffdf7" fillOpacity=".3" stroke="#746b5d" strokeWidth={1.25 / cancelled.scale} />}
      </g>;
    })}
    {draft && <path data-freehand-draft="true" d={draft} fill="none" stroke={gesture.current?.color ?? color} strokeWidth={gesture.current?.width ?? width} strokeLinecap="round" strokeLinejoin="round" />}
    {eraser && eraserShape === 'square' && <rect data-freehand-eraser="true" x={eraser.x-eraser.radius} y={eraser.y-eraser.radius} width={eraser.radius*2} height={eraser.radius*2} fill="#fffdf7" fillOpacity=".3" stroke="#746b5d" strokeWidth={1.25 / eraser.scale} pointerEvents="none" />}
    {eraser && eraserShape === 'round' && <circle data-freehand-eraser="true" cx={eraser.x} cy={eraser.y} r={eraser.radius} fill="#fffdf7" fillOpacity=".3" stroke="#746b5d" strokeWidth={1.25 / eraser.scale} pointerEvents="none" />}
  </svg>;
}
