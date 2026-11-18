'use client';
import { poseOnlyChanges, depthOnlyChanges } from '../lib/scene-reframe';
import { ScenePoseMotion } from './scene-pose-motion';
import { poseTransform } from '../lib/object-pose';
import { useLanguage } from './LanguageProvider';

import { cloneElement, isValidElement, memo, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ArtStyle, Scene, SceneObject } from '../lib/scene';
import { backgroundErasureKey, legacyErasureKey, objectMarkKeys } from '../lib/eraser';
import { BrushDefinitions, BrushMark, brushLegacy } from './BrushMarks';
import { ErasureMask } from './ErasureMask';
import { SvgStrokePlayback, drawingCursor } from './svg-stroke-playback';
import { getScenePaintOrder, isBackdropObject } from '../lib/scene-paint-order';
import { canvasSceneKey } from '../lib/canvas-context';
import { DEFAULT_PAPER, type PaperViewport } from '../lib/paper-viewport';
import { materialSubject } from '../lib/companion-material';

type Props = { scene: Scene; confirmedScene?: Scene; viewport?: PaperViewport; style: ArtStyle; id?: string; className?: string; playbackResetKey?: string | number; onDrawingChange?: (drawing: boolean) => void; motionMode?: 'system' | 'draw' | 'still'; animatePose?: boolean; playbackTurn?: number; soundEnabled?: boolean; soundQuiet?: boolean; soundPreview?: number; modelPending?: boolean };

function random(seed: number) {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

function hash(text: string) {
  return Array.from(text).reduce((n, char) => ((n << 5) - n + char.charCodeAt(0)) | 0, 73);
}

/** The drawing is intentionally composed of editable objects, never a flattened generated image. */
function SceneCanvas({ scene, confirmedScene = scene, viewport = scene.paper ?? DEFAULT_PAPER, style, id, className, playbackResetKey, onDrawingChange, motionMode = 'system', animatePose = true, playbackTurn = 0, soundEnabled = false, soundQuiet = false, soundPreview = 0, modelPending = false }: Props) {
 const {t}=useLanguage();
  const canvasRef = useRef<SVGSVGElement>(null);
  const motion = useRef<ScenePoseMotion | null>(null);
  const priorScene = useRef<{scene:Scene;style:ArtStyle;reset:string|number|undefined} | null>(null);
  const playback = useRef<SvgStrokePlayback | null>(null);
  const drawingChanged = useRef(onDrawingChange);
  drawingChanged.current = onDrawingChange;
  useLayoutEffect(() => {
    if (!canvasRef.current) return;
    const engine = new SvgStrokePlayback(canvasRef.current, value => drawingChanged.current?.(value));
    playback.current = engine;
    motion.current = new ScenePoseMotion(canvasRef.current);
    return () => { motion.current?.clear(); engine.dispose(); playback.current = null; };
  }, []);
  useLayoutEffect(() => { playback.current?.setSoundEnabled(soundEnabled); }, [soundEnabled]);
  useLayoutEffect(() => { playback.current?.setSoundQuiet(soundQuiet); }, [soundQuiet]);
  useLayoutEffect(() => { if (soundPreview) playback.current?.previewSound(); }, [soundPreview]);
  const previousRender = useRef<{sceneKey:string; viewportKey:string} | null>(null);
  const viewportKey = `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`;
  useLayoutEffect(() => {
    const sceneKey=JSON.stringify([canvasSceneKey(scene),scene.erasures??[],style]), previous=previousRender.current;
    // Resizing changes the paper edges, never the child's drawing. Update those
    // background bounds without treating the resize as a new stroke request.
    const layoutOnly=!!previous&&previous.sceneKey===sceneKey&&previous.viewportKey!==viewportKey;
    const old = priorScene.current;
    const reset = !old || old.reset !== playbackResetKey || old.style !== style;
    const moves = !reset && old ? poseOnlyChanges(old.scene, scene) : new Map();
    const retainedOwners = new Set([...moves.keys(), ...(!reset && old ? depthOnlyChanges(old.scene, scene) : [])]);
    // Direct manipulation already moved the pigment under the pointer. Commit
    // its final pose without replaying that move; stroke playback still runs.
    const animate = motion.current?.prepare(moves, !animatePose || reset || motionMode === 'still' || (motionMode === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches));
    playback.current?.reconcile(style, playbackResetKey, motionMode, layoutOnly, playbackTurn,confirmedScene===scene?null:new Set(confirmedScene.objects.filter(object=>JSON.stringify(object)===JSON.stringify(scene.objects.find(item=>item.id===object.id))).map(object=>object.id)),retainedOwners);
    animate?.();
    priorScene.current={scene,style,reset:playbackResetKey};
    previousRender.current={sceneKey,viewportKey};
  }, [scene, confirmedScene, style, playbackResetKey, motionMode, animatePose, viewportKey, playbackTurn]);
  // Re-apply after reconciliation, which resets pacing when the sheet changes.
  useLayoutEffect(() => { playback.current?.setModelWaiting(modelPending, playbackTurn); }, [modelPending, playbackTurn, playbackResetKey, style, motionMode]);
  const generatedId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const uid = `drawing-${id || generatedId}`;
  const ref = (name: string) => `url(#${uid}-${name})`;
  const pencil = style === 'pencil';
  const watercolor = style === 'watercolor';
  const night = scene.sky === 'night';
  const sunset = scene.sky === 'sunset';
  const blankPaper = scene.sky === 'paper';
  const ink = pencil ? '#665143' : night ? '#c8c4b3' : '#746d54';
  const skyTop = watercolor ? night ? '#6888bd' : sunset ? '#ffcca4' : '#b6e0f0' : pencil ? night ? '#c9c4ed' : sunset ? '#f9d5bd' : '#e2f2fa' : night ? '#253f4b' : sunset ? '#f5dfbb' : '#dfe9e4';
  const skyBottom = watercolor ? night ? '#b4b7d9' : '#fff9e8' : pencil ? night ? '#ede5f7' : '#fff8e7' : night ? '#748786' : sunset ? '#f5e8ce' : '#f5efd9';
  const water = watercolor ? night ? '#689fba' : '#75c7df' : pencil ? '#b5dfee' : night ? '#647e7b' : '#a8bdb0';
  const land = watercolor ? night ? '#709d80' : '#b7d97b' : pencil ? '#dfedbc' : night ? '#71836e' : '#c1c3a0';
  const grass = watercolor ? night ? '#628d76' : '#7fbb68' : pencil ? '#a4cb7d' : night ? '#697961' : '#a6ae85';
  const paper = watercolor ? '#fffdf5' : pencil ? '#fffaf0' : '#fbf2df';
  // The brush applies paper and pigment once, without desaturating legacy art.
  const color = (value: string) => value;
  const line = { stroke: ink, strokeWidth: pencil ? 1.45 : 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const roughFill = (fill: string) => ({ fill: color(fill), stroke: pencil ? ink : fill, strokeWidth: pencil ? 1.1 : 1.9, strokeLinejoin: 'round' as const });
  const detailColor = watercolor ? night ? '#9dc39b' : '#568c53' : pencil ? '#73934c' : night ? '#aab4a0' : '#6e795b';
  const groundRandom = random(5489);
  const textureRandom = random(981);
  const weatherRandom = random(765);
  const orderedObjects = getScenePaintOrder(scene);
  const objects = orderedObjects.filter(object => object.stackRank === undefined);
  const promotedObjects = orderedObjects.filter(object => object.stackRank !== undefined);

  function drawBaseObject(object: SceneObject) {
    const { id: objectId, kind, x, y, scale, color: objectColor } = object;
    const objectRandom = random(hash(objectId));
    const fill = color(objectColor);
    const common = { 'data-object-id': objectId, 'data-object-kind': kind, transform: poseTransform(object) };
    switch (kind) {
      case 'drawing': return null;
      case 'mountain':
        return <g key={objectId} {...common} opacity={watercolor ? .84 : pencil ? .78 : .83}>
          <path d="M-140 0 Q-112-36-87-70 Q-65-115-43-127 Q-25-139-9-121 Q10-102 35-72 Q58-50 82-42 Q112-17 142 0Z" {...roughFill(objectColor)} />
          <path d="M-129-1Q-90-44-52-88Q-37-106-32-118M-37-108Q-18-80 7-58M19-65Q40-34 63-18" fill="none" stroke={pencil ? ink : '#f2ebd4'} strokeWidth={pencil ? .8 : 1.5} opacity={pencil ? .46 : .22} />
          {pencil && Array.from({ length: 18 }, (_, i) => <path key={i} d={`M${-95 + i * 11} -5 l${12 + objectRandom() * 12} ${-12 - objectRandom() * 35}`} stroke={ink} opacity=".13" strokeWidth=".7" />)}
        </g>;
      case 'sun':
        return <g key={objectId} {...common}>
          {watercolor && <circle r="51" fill={fill} opacity=".12" />}
          <circle r="34" fill={fill} opacity={pencil ? .9 : .82} stroke={pencil ? ink : fill} strokeWidth={pencil ? .9 : 2} />
          {style === 'crayon' && <circle r="29" fill="none" stroke={color('#f8e1a6')} strokeWidth="3" opacity=".5" />}
          {pencil && <path d="M-24-17L14 25M-29-9L6 29M-17-25L24 17M-29 2L-6 28" stroke={ink} strokeWidth=".6" opacity=".2" />}
        </g>;
      case 'moon':
        return <g key={objectId} {...common}><circle r="45" fill="#f5edd0" opacity=".045" /><circle r="37" fill="#f5edd0" opacity=".07" /><path d="M12-30C-20-31-37-1-21 21C-7 42 19 34 32 13C7 24-15-4 12-30Z" fill={color(objectColor || '#f4dfaa')} stroke={pencil ? ink : 'none'} strokeWidth="1.3" /></g>;
      case 'star':
        return <g key={objectId} {...common} fill={fill}><path d="M0-11L3-3L11 0L3 3L0 11L-3 3L-11 0L-3-3Z" /><circle r="19" opacity=".06" /></g>;
      case 'cloud':
        return <g key={objectId} {...common} opacity={night ? .28 : .8}><path d="M-62 13C-76 8-69-7-53-8C-52-22-29-29-15-18C-4-42 31-35 39-14C57-17 75-2 69 12C42 18-29 21-62 13Z" fill={fill} stroke={pencil ? ink : 'none'} strokeWidth=".9" /><path d="M-46 20Q-4 24 43 19" {...line} fill="none" opacity={pencil ? .2 : .08} /></g>;
      case 'house':
        return <g key={objectId} {...common}>
          <ellipse cx="8" cy="4" rx="84" ry="12" fill={ink} opacity=".08" />
          <path d="M-55-74L-55 0L58 0L58-74L0-115Z" {...roughFill(objectColor)} />
          <path d="M58 0L81-14L81-85L58-74Z" fill={color('#b88f70')} opacity=".84" />
          <path d="M-68-70L-5-127L65-77L83-86L18-132L-5-127Z" fill={color('#7c7764')} stroke={pencil ? ink : color('#7c7764')} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M-67-69L-5-125L64-76" fill="none" stroke={color('#686f60')} strokeWidth="5" strokeLinecap="round" />
          <path d="M35-116V-141H48V-105" fill={color('#a78a6f')} stroke={pencil ? ink : 'none'} strokeWidth="1" />
          <path d="M41-151Q30-162 42-174Q52-184 40-197" fill="none" stroke={color('#f8f0da')} strokeWidth="6" opacity=".55" strokeLinecap="round" />
          <path d="M-53-49L56-49M-52-22L57-22M-37-74V-53M-8-99V-75M35-90V-54M-27-45V-25M47-46V-26" fill="none" stroke={color('#9f8063')} strokeWidth={pencil ? .55 : 1.1} opacity=".3" />
          <path d="M-34 0V-46Q-20-53-8-46V0Z" fill={color('#8a8166')} stroke={pencil ? ink : color('#8a8166')} strokeWidth="1.2" />
          <circle cx="-13" cy="-23" r="1.8" fill={color('#e5cca0')} />
          <rect x="13" y="-62" width="27" height="29" rx="1.6" fill={pencil ? '#ece5cf' : '#f6d88e'} stroke={color('#8e7e60')} strokeWidth="3" />
          <path d="M26-61V-34M14-47H39" stroke={color('#9d8968')} strokeWidth="1.4" />
          <rect x="8" y="-33" width="37" height="4" rx="1" fill={color('#947d61')} />
          <circle cx="-5" cy="-88" r="8" fill={pencil ? '#ece5cf' : '#efd69d'} stroke={color('#947d61')} strokeWidth="2" />
          <path d="M-39 1L-42 7H0L-4 1" fill={color('#c3ad89')} />
          <path d="M67-49L74-53V-27L67-24Z" fill={color('#e2bc7a')} opacity=".9" />
          <path d="M-59 0l-8-11m7 9 2-14m59 19 5-10m1 10 7-14m-83 6-4 8" fill="none" stroke={detailColor} strokeWidth="1.4" />
        </g>;
      case 'pine':
        return <g key={objectId} {...common}>
          <ellipse cy="3" rx="34" ry="6" fill={ink} opacity=".08" />
          <path d="M-3 0L-2-120L3-120L5 0Z" fill={color('#817760')} />
          <path d="M0-145L-24-99L-12-102L-36-63L-23-69L-47-23Q-2-9 46-25L23-70L35-64L13-104L24-99Z" {...roughFill(objectColor)} />
          <path d="M0-126L2-26M0-99L-18-88M1-79L23-63M0-63L-25-49M2-43L30-29" fill="none" stroke={pencil ? ink : color('#e5e0ba')} strokeWidth={pencil ? .8 : 1.2} opacity=".28" />
          <path d="M-30-36L-14-43M10-79L21-71M-12-91L-7-94M-23-59L-12-64M14-37L26-31" stroke={pencil ? ink : color('#566e5a')} strokeWidth={pencil ? 1 : 2.3} opacity=".28" strokeLinecap="round" />
        </g>;
      case 'tree':
        return <g key={objectId} {...common}>
          <ellipse cy="5" rx="47" ry="8" fill={ink} opacity=".08" />
          <path d="M-5 0Q-3-49-9-93L0-104Q7-54 5 0Z" fill={color('#8e8064')} />
          <path d="M0-37L-24-68M2-56L25-88" fill="none" stroke={color('#8e8064')} strokeWidth="5" />
          <path d="M-43-69C-73-86-60-117-41-120C-51-150-21-169-3-156C17-175 45-152 44-132C72-121 64-84 42-80C38-57 15-55 0-64C-18-50-34-52-43-69Z" {...roughFill(objectColor)} />
          <path d="M-46-102C-46-130-17-142 1-132C18-149 41-126 38-112C58-94 25-71 10-86C-13-68-34-83-33-95" fill={color('#d5c58b')} opacity=".16" />
          {Array.from({ length: 22 }, (_, i) => { const lx = (objectRandom() - .5) * 88; const ly = -75 - objectRandom() * 65; return <path key={i} d={`M${lx} ${ly}q5-5 9-1`} fill="none" stroke={pencil ? ink : color('#647b58')} strokeWidth={pencil ? .7 : 1.7} opacity=".23" strokeLinecap="round" />; })}
          <path d="M0-55V-87M0-75L-17-94M0-65L18-86" fill="none" stroke={color('#817b5e')} strokeWidth="2.6" opacity=".55" />
        </g>;
      case 'flower':
        return <g key={objectId} {...common}>
          {[[-14, -8, -40], [1, -2, -57], [18, 0, -33]].map(([fx, fy, top], i) => <g key={i}>
            <path d={`M${fx} ${fy}Q${fx - 5} ${top / 2} ${fx + 1} ${top}`} fill="none" stroke={color('#7b8d61')} strokeWidth="1.8" />
            <path d={`M${fx} ${top / 2}q-17-10-16-1q4 9 16 5m0-10q14-13 16-4q-2 8-15 10`} fill={color('#9aa570')} />
            {[0, 60, 120, 180, 240, 300].map(a => <ellipse key={a} cx={fx + 1} cy={top - 5} rx="4.7" ry="7" transform={`rotate(${a} ${fx + 1} ${top})`} fill={fill} stroke={pencil ? ink : 'none'} strokeWidth=".5" />)}
            <circle cx={fx + 1} cy={top} r="3.6" fill={color('#e7c578')} />
          </g>)}
        </g>;
      case 'bird':
        return <g key={objectId} {...common}><path d="M-15 0Q-6-10 0 0Q7-8 17-2" fill="none" stroke={fill} strokeWidth={pencil ? 1.8 : 2.4} strokeLinecap="round" /></g>;
      case 'boat':
        return <g key={objectId} {...common}>
          <path d="M-45 9Q-3 15 50 9M-30 16H33" fill="none" stroke={paper} strokeWidth="1.5" opacity=".5" strokeLinecap="round" />
          <path d="M-36-8Q2-2 37-12L23 4Q-3 11-25 3Z" {...roughFill(objectColor)} />
          <path d="M-34-9Q-3-18 37-12Q2-2-34-9Z" fill={color('#dbbf8f')} stroke={color('#916e52')} strokeWidth="1.6" />
          <path d="M-17-13L-13-6M6-14L8-7M18-11L-16-24" fill="none" stroke={color('#946f54')} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M-17-24L-29-28" stroke={color('#946f54')} strokeWidth="5" strokeLinecap="round" />
        </g>;
      case 'bench':
        return <g key={objectId} {...common}>
          <path d="M-35-2L-30-39M32-2L27-39M-30-42H31M-32-32H33M-38-18H38" fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round" />
          <path d="M-40-15H40M-28-12L-32 0M29-12L33 0" fill="none" stroke={color('#827760')} strokeWidth="4" strokeLinecap="round" />
        </g>;
      case 'lamp':
        return <g key={objectId} {...common}>
          <circle cy="-89" r="32" fill={color('#f7d894')} opacity=".12" /><circle cy="-89" r="21" fill={color('#f7d894')} opacity=".14" />
          <path d="M0 0V-77M-9 0H9" fill="none" stroke={fill} strokeWidth="4" strokeLinecap="round" />
          <path d="M-10-78L-14-101H14L10-78Z" fill={pencil ? '#e9ddbe' : '#f0cf89'} stroke={fill} strokeWidth="2.5" />
          <path d="M-17-103L0-115L17-103Z" fill={fill} /><path d="M0-114V-120" stroke={fill} strokeWidth="2" />
        </g>;
      case 'cat':
        return <g key={objectId} {...common}>
          <path d="M-8 0C-27-6-25-33-10-37L-12-54L-2-48L8-55L11-36C23-24 20-9 16 0Z" {...roughFill(objectColor)} />
          <path d="M12-1Q36 5 34-14Q33-25 24-23" fill="none" stroke={fill} strokeWidth="7" strokeLinecap="round" />
          <path d="M-7-37l3 1m7-1 3-1M-2-31l2 2 2-2M-12-31L-23-34M10-31L20-34" fill="none" {...line} strokeWidth="1.1" />
        </g>;
      case 'bush':
        return <g key={objectId} {...common}><path d="M-38 0Q-55-22-30-30Q-30-54-8-43Q8-63 25-39Q48-44 44-22Q62-6 40 0Z" {...roughFill(objectColor)} /><path d="M-27-17l10-5M-2-30l6 7M23-16l10-4M-12-8l9-3" {...line} fill="none" opacity=".22" /></g>;
      case 'mushroom':
        return <g key={objectId} {...common}><path d="M-5 0L-3-25H5L8 0Z" fill={color('#e5d9b7')} stroke={pencil ? ink : 'none'} strokeWidth=".8" /><path d="M-24-22Q-21-43 0-43Q20-42 26-22Q0-16-24-22Z" {...roughFill(objectColor)} /><circle cx="-10" cy="-30" r="3" fill={paper} opacity=".8" /><circle cx="5" cy="-35" r="3.5" fill={paper} opacity=".8" /><circle cx="15" cy="-27" r="2.4" fill={paper} opacity=".8" /></g>;
      case 'person':
        return <g key={objectId} {...common}>
          <circle cy="-63" r="9" fill={color('#d9b68e')} /><path d="M-12-48Q1-54 12-48L17-16H-16Z" {...roughFill(objectColor)} /><path d="M-7-15L-9 0M7-15L10 0M-12-44L-23-26M12-43L23-30" fill="none" stroke={color('#7f7764')} strokeWidth="5" strokeLinecap="round" /><path d="M-10-65Q-8-81 5-74Q13-70 10-62" fill={color('#7b6b54')} />
        </g>;
    }
  }

  function drawObject(object: SceneObject) {
    const base = brushLegacy(drawBaseObject(object), { style, ink, objectColor: object.color, uid, ownerId: object.id, subject: materialSubject(object) });
    // Both the built-in brushes and free marks use object-local masks. Keeping
    // the object's current transform outside the mask carries holes with it.
    const localBase = isValidElement<{ transform?: string }>(base) ? cloneElement(base, { transform: undefined }) : base;
    const markKeys = objectMarkKeys(object);
    const occurrences = new Map<string, number>();
    return <g key={`${object.id}-drawing`} data-manual-object={object.id} style={{transformOrigin:"0 0",transformBox:"view-box"}}>
      {base && <g transform={poseTransform(object)}>
        <ErasureMask viewport={viewport} erasures={scene.erasures} targetKey={legacyErasureKey(object)} frame={object}>{localBase}</ErasureMask>
      </g>}
      <g transform={poseTransform(object)} data-object-id={object.kind === 'drawing' ? object.id : undefined} data-object-kind={object.kind === 'drawing' ? 'drawing' : undefined} data-marks-for={object.id}>
        {object.label && <title>{object.label}</title>}
        {object.marks?.map((mark, markIndex) => {
          const canonical = JSON.stringify(Object.fromEntries(Object.entries(mark).sort(([a], [b]) => a.localeCompare(b))));
          const occurrence = occurrences.get(canonical) ?? 0;
          occurrences.set(canonical, occurrence + 1);
          const markKey = `${object.id}:${canonical}:${occurrence}`;
          return <ErasureMask viewport={viewport} key={markKey} erasures={scene.erasures} targetKey={markKeys[markIndex]} frame={object}><BrushMark mark={mark} style={style} objectColor={object.color} ink={ink} markKey={markKey} uid={uid} subject={materialSubject(object)} preserveStrokeColor={object.id.startsWith('hand-')} /></ErasureMask>;
        })}
      </g>
    </g>;
  }

  // Background pigment participates in the same pen queue as characters. A
  // wash is one continuous area, including its texture, so details cannot pop
  // into view before the brush reaches them.
  function drawBackdrop(node: ReactNode, layer: 'sky' | 'ground', pigment: string) {
    const owner = backgroundErasureKey(scene, layer);
    return <g data-object-id={owner} data-drawing-mark={owner} data-playback-area="true" data-playback-fill-only="true" data-brush-medium={style}>
      {watercolor ? brushLegacy(node, { style, ink, objectColor: pigment, uid, ownerId: owner, subject: layer === 'ground' ? '草地 meadow' : '天空 sky' }) : node}
    </g>;
  }

  // Free compositions use the model's exact layer order, including shortcut brushes.
  const backObjects = scene.ground === 'none' ? [] : objects.filter(isBackdropObject);
  const left=viewport.x-20,right=viewport.x+viewport.width+20,bottom=viewport.y+viewport.height+20;
  const frontObjects = scene.ground === 'none' ? objects : objects.filter(object => !isBackdropObject(object));

  return <svg ref={canvasRef} id={id} data-scene-key={canvasSceneKey(scene)} className={className} style={{ cursor: drawingCursor, backgroundColor: paper }} xmlns="http://www.w3.org/2000/svg" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} role="img" aria-label={t('{title}，{style}风格的画作',{title:t(scene.title),style:t(pencil?'彩铅':watercolor?'水彩':'蜡笔')})} preserveAspectRatio="xMidYMid meet">
    <defs>
      <BrushDefinitions uid={uid} />
      <linearGradient id={`${uid}-sky`} x1="0" x2="0" y1="0" y2="1"><stop stopColor={skyTop} /><stop offset="1" stopColor={skyBottom} /></linearGradient>
      <linearGradient id={`${uid}-lake`} x1="0" x2=".15" y1="0" y2="1"><stop stopColor={water} /><stop offset="1" stopColor={watercolor ? '#b6e7e7' : pencil ? '#d4edf2' : night ? '#80948b' : '#d8d6b8'} /></linearGradient>
      <linearGradient id={`${uid}-water-land`} x1="0" y1="0" x2=".15" y2="1"><stop stopColor="#d4e9a2"/><stop offset=".45" stopColor={land}/><stop offset="1" stopColor="#8cc476"/></linearGradient>
      <linearGradient id={`${uid}-water-near`} x1=".1" y1="0" x2=".7" y2="1"><stop stopColor="#c7e39a"/><stop offset=".55" stopColor="#94ca77"/><stop offset="1" stopColor="#72b775"/></linearGradient>
      <linearGradient id={`${uid}-pencil-land`} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#e5edbc" /><stop offset="1" stopColor="#d4e3a6" /></linearGradient>
      <linearGradient id={`${uid}-pencil-near`} x1="0" x2=".15" y1="0" y2="1"><stop stopColor="#e0edba" /><stop offset=".65" stopColor="#cce29e" /><stop offset="1" stopColor="#b9d88e" /></linearGradient>
      <radialGradient id={`${uid}-light`}><stop stopColor={pencil ? '#fffefb' : '#f9e7bb'} stopOpacity=".65" /><stop offset="1" stopColor={pencil ? '#fffefb' : '#f9e7bb'} stopOpacity="0" /></radialGradient>
      <filter id={`${uid}-edge`} x="-5%" y="-6%" width="110%" height="112%"><feTurbulence type="fractalNoise" baseFrequency={watercolor ? '.035' : '.075'} numOctaves="2" seed="7" result="noise" />{watercolor && <feGaussianBlur in="SourceGraphic" stdDeviation=".45" result="washed" />}<feDisplacementMap in={watercolor ? 'washed' : 'SourceGraphic'} in2="noise" scale={watercolor ? 2.6 : pencil ? .65 : 1.25} xChannelSelector="R" yChannelSelector="G" /></filter>
      <pattern id={`${uid}-paper`} width="76" height="76" patternUnits="userSpaceOnUse">
        {Array.from({ length: watercolor ? 42 : pencil ? 38 : 65 }, (_, i) => <circle key={i} cx={textureRandom() * 76} cy={textureRandom() * 76} r={watercolor ? .12 + textureRandom() * .3 : pencil ? .15 + textureRandom() * .35 : .35 + textureRandom() * .7} fill={watercolor ? i % 3 ? '#ad9574' : '#ffffff' : pencil ? i % 3 ? '#b88d62' : '#ffffff' : i % 3 ? '#7e7254' : '#fffdf4'} opacity={watercolor ? i % 3 ? .035 : .19 : pencil ? i % 3 ? .035 : .28 : i % 3 ? .065 : .45} />)}
        <path d="M7 32l4-1M42 12l6 1M19 68l5-1M56 48l4 1" stroke={pencil ? '#b88d62' : '#8e8267'} strokeWidth={pencil || watercolor ? '.3' : '.5'} opacity={watercolor ? '.025' : pencil ? '.025' : '.08'} />
      </pattern>
      <pattern id={`${uid}-grain`} width={pencil ? 17 : 23} height={pencil ? 19 : 21} patternUnits="userSpaceOnUse" patternTransform={pencil ? 'rotate(-19)' : 'rotate(7)'}>
        {pencil ? <><path d="M1 0V19M5 3V16M11 0V19M15 4V17" stroke="#655f51" strokeWidth=".45" opacity=".12" /><path d="M3 7L13 6M4 14L16 13" stroke="#655f51" strokeWidth=".4" opacity=".045" /></> : <><path d="M2 3l4 1m8 6 6-1m-13 8 5 1" stroke="#fff7df" strokeWidth="1.2" opacity=".26" /><circle cx="19" cy="3" r=".8" fill="#fffbe9" opacity=".3" /><circle cx="3" cy="12" r=".6" fill="#625b44" opacity=".1" /></>}
      </pattern>
      <clipPath id={`${uid}-bounds`}><rect {...viewport} rx="2" /></clipPath>
    </defs>
    <g clipPath={ref('bounds')} data-scene-layer="true">
      <rect {...viewport} fill={paper} />
      <g data-pigment-layer="true">
      <ErasureMask viewport={viewport} erasures={scene.erasures} targetKey={backgroundErasureKey(scene, 'sky')}>
      {drawBackdrop(<g>
      {!blankPaper && <rect x={viewport.x} y={viewport.y} width={viewport.width} height={scene.ground === 'none' ? viewport.height : 430-viewport.y} fill={ref('sky')} />}
      {sunset && <ellipse cx="690" cy="215" rx="270" ry="235" fill={ref('light')} opacity={night ? .1 : .52} />}
      {night && <g fill="#f1e5bc" opacity=".6">{Array.from({ length: 30 }, (_, i) => { const r = random(i * 97 + 23); return <circle key={i} cx={viewport.x+r()*viewport.width} cy={viewport.y+30+r()*240} r={.6 + r() * .7} />; })}</g>}
      </g>, 'sky', skyTop)}
      </ErasureMask>
      <g>
        {backObjects.map(drawObject)}
        {scene.ground !== 'none' && <ErasureMask viewport={viewport} erasures={scene.erasures} targetKey={backgroundErasureKey(scene, 'ground')}>
        {drawBackdrop(<g>
        <path d={`M${left} 352L-20 352Q113 298 255 338Q360 369 482 338Q605 321 748 353Q876 317 1020 346L${right} 346V${bottom}H${left}Z`} fill={watercolor ? night ? '#8db09b' : '#b9d69b' : pencil ? '#d3e3ae' : night ? '#879481' : '#c3c8a8'} />
        <path d={`M${left} 374L-15 374Q131 337 276 362Q409 381 534 358Q703 336 1020 366L${right} 366V${bottom}H${left}Z`} fill={watercolor ? night ? land : ref('water-land') : pencil ? ref('pencil-land') : land} />
        {scene.ground !== 'meadow' && <>
          <path d={scene.ground === 'coast' ? `M${left} 385L-20 385Q240 344 470 376Q735 340 1020 354L${right} 354V566L1020 566Q812 505 659 548Q498 583 306 530Q111 494-20 526L${left} 526Z` : `M384 376Q547 346 734 358Q812 363 906 385Q810 402 816 431Q823 452 891 468Q942 481 1007 479L${right} 479V570L1020 570Q825 526 685 553Q534 579 378 527Q293 499 353 470Q434 430 364 409Q328 394 384 376Z`} fill={ref('lake')} />
          <path d={scene.ground === 'coast' ? 'M-20 385Q240 344 470 376Q735 340 1020 354M-20 526Q111 494 306 530Q498 583 659 548Q812 505 1020 566' : 'M383 377Q549 347 733 359M359 411Q427 432 352 471Q295 499 379 527M905 387Q810 404 820 433Q830 454 892 470'} fill="none" stroke={pencil ? '#6babc5' : color('#eee8cb')} strokeWidth={pencil ? .65 : 3} opacity={pencil ? '.38' : '.55'} />
          <g fill="none" stroke={pencil ? '#72b3cb' : '#f4edcf'} strokeLinecap="round" opacity={pencil ? .34 : .57} strokeWidth={pencil ? .65 : 1.6}>
            <path d="M497 386h39m23 0h16m58-12h45m24 19h46m-292 31h34m16-7h55m91-15h80m-209 33h49m9 10h76m-196 18h43m26-8h25m69 13h84m-247 23h81m48 13h48m-166 14h56m27 6h67m56-32h48m-7 28h76m-289 12h31m72 17h56" />
            <path d="M674 381h25m-18 17h44m-63 19h69m-81 17h95m-111 18h99m-97 19h111" opacity={pencil ? '.3' : '.5'} strokeWidth={pencil ? '.9' : '2.8'} />
          </g>
          <path d="M1020 484Q909 457 868 471Q929 497 1020 513Z" fill={grass} opacity=".38" />
        </>}
        <path d={`M${left} 472L-20 472Q106 448 218 483Q356 524 470 548Q555 568 669 550Q825 527 1020 579L${right} 579V${bottom}H${left}Z`} fill={watercolor ? night ? grass : ref('water-near') : pencil ? ref('pencil-near') : night ? '#71836b' : '#c9c4a0'} />
        <path d={`M${left} 535L-20 535Q114 484 222 514Q345 556 400 640L400 ${bottom}H${left}Z`} fill={grass} opacity={pencil ? .22 : watercolor ? .43 : .47} />
        <path d="M219 640Q196 558 229 505Q248 468 272 431Q283 413 278 397L296 397Q305 429 283 460Q257 505 264 539Q273 582 302 640Z" fill={watercolor ? '#f2dfac' : pencil ? '#fff0cb' : '#e7d4ac'} opacity={pencil ? '.9' : '.76'} />
        <path d="M222 628Q209 548 243 496Q274 450 286 420" fill="none" stroke={pencil ? '#d8be88' : color('#f4e3c0')} strokeWidth={pencil ? '.65' : '2.5'} opacity={pencil ? '.4' : '.56'} />
        <g fill="none" stroke={detailColor} strokeWidth={pencil ? .7 : 1.2} strokeLinecap="round">
          {Array.from({ length: pencil ? 30 : 70 }, (_, i) => { const gx = viewport.x+groundRandom()*viewport.width; const gy = 555+groundRandom()*Math.max(78,viewport.y+viewport.height-562); const h = 3 + groundRandom() * 7; return <path key={i} d={`M${gx} ${gy}q-2-${h / 2}-4-${h}m4 ${h}q1-${h} 3-${h + 2}`} opacity={pencil ? .16 + groundRandom() * .18 : .12 + groundRandom() * .2} />; })}
          <path d="M54 416l-3-10m4 10 4-13M88 430l-3-6m4 6 3-10M367 457l-2-9m2 9 5-12M914 442l-3-9m3 9 4-12M942 419l-2-7m2 7 4-10" opacity={pencil ? '.3' : '.42'} />
        </g>
        <g fill={color('#f0e5bd')} opacity=".85"><ellipse cx="73" cy="558" rx="2.2" ry="3.5" transform="rotate(-20 73 558)" /><ellipse cx="80" cy="547" rx="2" ry="3" /><ellipse cx="111" cy="576" rx="2.2" ry="3.5" /><ellipse cx="880" cy="598" rx="2.5" ry="3.5" /><ellipse cx="896" cy="593" rx="2" ry="3" /></g>
        </g>, 'ground', land)}
        </ErasureMask>}
        {frontObjects.map(drawObject)}
        {scene.ground === 'lake' && <ErasureMask viewport={viewport} erasures={scene.erasures} targetKey={backgroundErasureKey(scene, 'ground')}><g data-object-id={`${backgroundErasureKey(scene, 'ground')}:reeds`} fill="none" stroke={detailColor} strokeWidth="1.6" strokeLinecap="round" opacity=".53"><path d="M367 493q-6-25-9-34m10 34q-2-28 4-37m-5 36q7-22 16-29M827 498q-4-21-10-28m11 30q0-23 8-30" /><path d="M358 459l-3-8m17 5 1-10m10 17 4-8m430 16-3-7m22 4 4-8" strokeWidth="3.8" /></g></ErasureMask>}
      </g>

      <ErasureMask viewport={viewport} erasures={scene.erasures} targetKey={backgroundErasureKey(scene, 'weather')}>
      {scene.weather === 'rain' && <g data-object-id={backgroundErasureKey(scene, 'weather')} stroke={pencil ? '#90b8d6' : '#88a1a0'} strokeWidth={pencil ? '.75' : '1.1'} strokeLinecap="round" opacity={pencil ? '.25' : '.36'}>{Array.from({ length: 90 }, (_, i) => { const x = viewport.x+weatherRandom()*viewport.width; const y = viewport.y+weatherRandom()*viewport.height; return <path key={i} d={`M${x} ${y}l-5 14`} />; })}<rect {...viewport} fill={pencil ? '#bbdbef' : '#799294'} opacity={pencil ? '.045' : '.1'} stroke="none" /></g>}
      {scene.weather === 'snow' && <g data-object-id={backgroundErasureKey(scene, 'weather')} fill="#fffdf3" opacity=".87">{Array.from({ length: 100 }, (_, i) => <circle key={i} cx={viewport.x+weatherRandom()*viewport.width} cy={viewport.y+weatherRandom()*viewport.height} r={1 + weatherRandom() * 2.2} />)}</g>}
      </ErasureMask>
      {promotedObjects.map(drawObject)}
      </g>
      <rect {...viewport} fill={ref('paper')} pointerEvents="none" />
      <rect x={viewport.x+1} y={viewport.y+1} width={viewport.width-2} height={viewport.height-2} fill="none" stroke={pencil ? '#dfcaa6' : '#ddcfad'} strokeWidth={pencil ? '1' : '2'} opacity={pencil ? '.16' : '.2'} />
    </g>
  </svg>;
}

// Microphone captions, level feedback and the recording clock do not change
// pigment. Keep those frequent parent updates out of the SVG render tree.
export default memo(SceneCanvas);
