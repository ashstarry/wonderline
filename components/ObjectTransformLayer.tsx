'use client';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent, type Ref } from 'react';
import { BookmarkPlus, X } from 'lucide-react';
import { companionActionPosition } from './object-action-placement';
export { companionActionPosition } from './object-action-placement';
import type { Scene, SceneObject } from '../lib/scene';
import type { PaperViewport } from '../lib/paper-viewport';
import { commitObjectPose, moveObject, resizeObject, rotateObject, removeObject, bringObjectToFront, transformedBox, type ObjectBox, type ObjectPose, type Point } from '../lib/object-transform';
import { useLanguage } from './LanguageProvider';
import './object-selection-actions.css';

export type ObjectSelectionState = { id: string; rotation: number; dragging: boolean } | null;
export type ObjectTransformControls = { cancelGesture: () => boolean; turn: (degrees: number | null) => void; resize: (factor: number) => void; remove: () => void; front: () => void };
type Props = { scene: Scene; viewport: PaperViewport; enabled: boolean; controlsRef?: Ref<ObjectTransformControls>; onCommit: (scene: Scene, phrase: string) => void; onSelectionChange?: (selection: ObjectSelectionState) => void; onKeepCompanion?: (id: string) => void; canKeepCompanion?: (object: SceneObject) => boolean };
type Selection = { id: string; box: ObjectBox };
type Gesture = { pointer: number; start: Point; object: SceneObject; box: ObjectBox; resize: boolean; pose: ObjectPose; holder: SVGGElement; original: string | null; scene: Scene };
const matrixPoint = (point: Point, matrix: DOMMatrix) => new DOMPoint(point.x, point.y).matrixTransform(matrix);
export const COMPANION_ACTION_WIDTH=134;
export const COMPANION_ACTION_HEIGHT=44;
export const companionActionWidth=(language:'en'|'zh')=>language==='zh'?COMPANION_ACTION_WIDTH:158;

export function ObjectCompanionAction({id,language,position,screenScale,onKeep}:{id:string;language:'en'|'zh';position:NonNullable<ReturnType<typeof companionActionPosition>>;screenScale:number;onKeep:()=>void}) {
  const label=language==='zh'?'保存为伙伴':'Save companion';
  const hint=language==='zh'?'下次画画还能用':'Use in another picture';
  const descriptionId=`save-companion-hint-${id}`;
  return <foreignObject x={position.x} y={position.y} width={position.width} height={position.height} style={{overflow:'visible'}}>
    <div style={{width:position.width*screenScale,height:COMPANION_ACTION_HEIGHT,transform:`scale(${1/screenScale})`,transformOrigin:'top left'}}>
      <button type="button" className="object-companion-action" data-keep-companion={id} aria-label={label} aria-describedby={descriptionId} title={`${label} · ${hint}`} aria-haspopup="dialog" onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();onKeep();}} onKeyDown={event=>event.stopPropagation()} onKeyUp={event=>event.stopPropagation()}>
        <BookmarkPlus className="object-companion-action__icon" size={18} strokeWidth={1.7} aria-hidden="true"/><span className="object-companion-action__copy"><span className="object-companion-action__label">{label}</span><span id={descriptionId} className="object-companion-action__hint">{hint}</span></span>
      </button>
    </div>
  </foreignObject>;
}

export default function ObjectTransformLayer({scene,viewport,enabled,controlsRef,onCommit,onSelectionChange,onKeepCompanion,canKeepCompanion}: Props) {
  const {t,language}=useLanguage();
  const svg=useRef<SVGSVGElement>(null), gesture=useRef<Gesture|null>(null), frame=useRef(0);
  const [selection,setSelection]=useState<Selection|null>(null);
  const [dragging,setDragging]=useState(false);
  const [screenScale,setScreenScale]=useState(1);
  const current=useRef({scene,viewport,enabled,onCommit}); current.current={scene,viewport,enabled,onCommit};
  const artwork=()=>svg.current?.parentElement?.querySelector<SVGSVGElement>('#main-artwork')??null;
  function holderFor(id:string){return artwork()?.querySelector<SVGGElement>(`[data-manual-object="${id}"]`)??null;}
  function boxFor(holder:SVGGElement):ObjectBox|null{
    try{const b=holder.getBBox();return b.width+b.height>0?{x:b.x,y:b.y,width:b.width,height:b.height}:null;}catch{return null;}
  }
  function point(event:{clientX:number;clientY:number}):Point|null{
    const matrix=svg.current?.getScreenCTM();return matrix?matrixPoint({x:event.clientX,y:event.clientY},matrix.inverse()):null;
  }
  function restore(g:Gesture){if(g.original===null)g.holder.removeAttribute('transform');else g.holder.setAttribute('transform',g.original);}
  function cancelGesture(){
    const g=gesture.current;if(!g)return false;
    gesture.current=null;cancelAnimationFrame(frame.current);restore(g);setDragging(false);setSelection({id:g.object.id,box:g.box});
    try{svg.current?.releasePointerCapture(g.pointer);}catch{}
    return true;
  }
  useImperativeHandle(controlsRef,()=>({cancelGesture,turn,resize,remove,front}));
  const selectedObject=scene.objects.find(object=>object.id===selection?.id);
  useEffect(()=>{onSelectionChange?.(enabled&&selectedObject?{id:selectedObject.id,rotation:selectedObject.rotation??0,dragging}:null);},[enabled,selectedObject?.id,selectedObject?.rotation,dragging,onSelectionChange]);
  useLayoutEffect(()=>{
    cancelGesture();
    const matrix=svg.current?.getScreenCTM();if(matrix)setScreenScale(Math.max(.05,Math.hypot(matrix.a,matrix.b)));
    setSelection(previous=>{if(!enabled||!previous)return null;const holder=holderFor(previous.id),box=holder&&boxFor(holder);return box?{id:previous.id,box}:null;});
  },[scene,enabled,viewport.x,viewport.y,viewport.width,viewport.height]);
  useEffect(()=>{
    if(!enabled||!svg.current)return;
    const updateScale=()=>{const matrix=svg.current?.getScreenCTM();if(matrix)setScreenScale(Math.max(.05,Math.hypot(matrix.a,matrix.b)));};
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(updateScale);
    observer?.observe(svg.current);window.addEventListener('resize',updateScale);
    return()=>{observer?.disconnect();window.removeEventListener('resize',updateScale);};
  },[enabled]);
  useEffect(()=>()=>{cancelAnimationFrame(frame.current);if(gesture.current)restore(gesture.current);},[]);
  useEffect(()=>{
    if(!enabled)return;
    const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;if(cancelGesture()||selection){event.preventDefault();setSelection(null);}};
    window.addEventListener('keydown',escape,true);return()=>window.removeEventListener('keydown',escape,true);
  },[enabled,selection]);

  function hitObject(client:Point):SceneObject|null{
    const canvas=artwork();if(!canvas)return null;
    // SVG paint order, not array order: backgrounds and foregrounds can differ.
    const holders=Array.from(canvas.querySelectorAll<SVGGElement>('[data-manual-object]')).reverse();
    for(const holder of holders){
      const object=scene.objects.find(item=>item.id===holder.dataset.manualObject);if(!object)continue;
      const shapes=Array.from(holder.querySelectorAll<SVGGeometryElement>('[data-playback-shape="true"]')).reverse();
      for(const shape of shapes){
        if(shape.closest('defs,mask,clipPath,pattern,[data-playback-artifact],[data-playback-decoration]'))continue;
        try{
          const matrix=shape.getScreenCTM();if(!matrix)continue;
          const p=matrixPoint(client,matrix.inverse()),style=getComputedStyle(shape);
          if(Number(style.opacity)===0)continue;
          const hit=(style.fill!=='none'&&Number(style.fillOpacity)>0&&shape.isPointInFill?.(p))||(style.stroke!=='none'&&Number(style.strokeOpacity)>0&&shape.isPointInStroke?.(p));
          if(!hit)continue;
          // A hole is not a selectable painted area. Keep erased portions erased.
          const maskId=shape.closest('[data-erasure-mask]')?.getAttribute('data-erasure-mask');
          if(maskId){
            const paths=canvas.querySelectorAll<SVGPathElement>(`#${maskId} path[stroke="black"], #${maskId} path[fill="black"]`);
            const erased=Array.from(paths).some(path=>{const m=path.getScreenCTM();return m&&(path.getAttribute('fill')==='black'?path.isPointInFill(matrixPoint(client,m.inverse())):path.isPointInStroke(matrixPoint(client,m.inverse())));});
            if(erased)continue;
          }
          return object;
        }catch{/* Ignore a shape that is being detached. */}
      }
    }
    return null;
  }
  function down(event:PointerEvent<SVGSVGElement>){
    if(!enabled||gesture.current||event.button!==0||!event.isPrimary)return;
    const p=point(event);if(!p)return;
    const resize=!!(event.target as Element).closest('[data-resize-handle]');
    const selected=selection&&scene.objects.find(item=>item.id===selection.id);
    const inside=selection&&p.x>=selection.box.x&&p.x<=selection.box.x+selection.box.width&&p.y>=selection.box.y&&p.y<=selection.box.y+selection.box.height;
    const object=resize?selected:hitObject({x:event.clientX,y:event.clientY})??(inside?selected:null);
    if(!object){setSelection(null);return;}
    const holder=holderFor(object.id),box=holder&&boxFor(holder);if(!holder||!box)return;
    event.preventDefault();svg.current?.focus({preventScroll:true});svg.current?.setPointerCapture(event.pointerId);
    gesture.current={pointer:event.pointerId,start:p,object,box,resize,pose:object,holder,original:holder.getAttribute('transform'),scene};
    setSelection({id:object.id,box});setDragging(true);
  }
  function update(event:{clientX:number;clientY:number}){
    const g=gesture.current,p=point(event);if(!g||!p)return;
    const delta={x:p.x-g.start.x,y:p.y-g.start.y};
    g.pose=(g.resize?resizeObject:moveObject)(g.object,g.box,delta,current.current.viewport);
    cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{
      if(gesture.current!==g)return;
      const ratio=g.pose.scale/g.object.scale;
      g.holder.setAttribute('transform',`translate(${g.pose.x-ratio*g.object.x} ${g.pose.y-ratio*g.object.y}) scale(${ratio})`);
      setSelection({id:g.object.id,box:transformedBox(g.box,g.object,g.pose)});
    });
  }
  function up(event:PointerEvent<SVGSVGElement>){
    const g=gesture.current;if(!g||g.pointer!==event.pointerId)return;
    update(event);cancelAnimationFrame(frame.current);gesture.current=null;restore(g);setDragging(false);
    svg.current?.releasePointerCapture(event.pointerId);
    if(!current.current.enabled||current.current.scene!==g.scene)return;
    const next=commitObjectPose(g.scene,g.object.id,g.pose);
    if(next!==g.scene)onCommit(next,g.resize?'调整了大小':'移动了画中物件');
    else setSelection({id:g.object.id,box:g.box});
  }
  function keyboard(event:React.KeyboardEvent<SVGSVGElement>){
    if(!enabled||!selection||gesture.current)return;
    const object=scene.objects.find(item=>item.id===selection.id);if(!object)return;
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();remove();return;}
    const step=(event.shiftKey?20:5)/screenScale;
    const moves:Record<string,Point>={ArrowLeft:{x:-step,y:0},ArrowRight:{x:step,y:0},ArrowUp:{x:0,y:-step},ArrowDown:{x:0,y:step}};
    const resize=['+','=','-','_'].includes(event.key);
    if(!moves[event.key]&&!resize)return;event.preventDefault();
    const delta=resize?{x:selection.box.width*(['-','_'].includes(event.key)?-.1:.1),y:selection.box.height*(['-','_'].includes(event.key)?-.1:.1)}:moves[event.key];
    onCommit(commitObjectPose(scene,object.id,(resize?resizeObject:moveObject)(object,selection.box,delta,viewport)),resize?'调整了大小':'移动了画中物件');
  }
  function turn(degrees:number|null){
    if(!enabled||!selection||gesture.current)return;
    const object=scene.objects.find(item=>item.id===selection.id);if(!object)return;
    const next=commitObjectPose(scene,object.id,rotateObject(object,selection.box,degrees??-(object.rotation??0),viewport));
    if(next!==scene)onCommit(next,degrees===null?'摆正了画中物件':'旋转了画中物件');
  }
  function resize(factor:number){
    if(!enabled||!selection||gesture.current)return;
    const object=scene.objects.find(item=>item.id===selection.id);if(!object)return;
    const next=commitObjectPose(scene,object.id,resizeObject(object,selection.box,{x:selection.box.width*(factor-1),y:selection.box.height*(factor-1)},viewport));
    if(next!==scene)onCommit(next,'调整了大小');
  }
  function remove(){
    if(!enabled||!selection||gesture.current)return;
    const next=removeObject(scene,selection.id);
    if(next!==scene){setSelection(null);onCommit(next,'删除了画中物件');svg.current?.focus({preventScroll:true});}
  }
  function front(){
    if(!enabled||!selection||gesture.current)return;
    const next=bringObjectToFront(scene,selection.id);
    if(next!==scene)onCommit(next,'置顶了画中物件');
  }
  const b=selection?.box,r=12/screenScale,pad=5/screenScale;
  const hx=b?Math.max(viewport.x+r,Math.min(viewport.x+viewport.width-r,b.x+b.width+pad)):0;
  const hy=b?Math.max(viewport.y+r,Math.min(viewport.y+viewport.height-r,b.y+b.height+pad)):0;
  const deleteX=b?b.x+b.width+pad:0;
  const deleteY=b?b.y-pad:0;
  const companionAction=enabled&&!dragging&&b&&selectedObject&&onKeepCompanion&&canKeepCompanion?.(selectedObject)
    ?companionActionPosition(b,viewport,screenScale,companionActionWidth(language),COMPANION_ACTION_HEIGHT):null;
  function keepSelectedCompanion(){
    if(!enabled||gesture.current||!selectedObject||!canKeepCompanion?.(selectedObject))return;
    onKeepCompanion?.(selectedObject.id);
  }
  return <svg ref={svg} className="object-transform-layer" viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} data-transform-enabled={enabled} data-selected-object={selection?.id} tabIndex={enabled?0:-1} aria-label={t('操控画中物件')} style={{pointerEvents:enabled?'auto':'none',cursor:dragging?'grabbing':'grab',touchAction:enabled?'none':'auto'}} onPointerDown={down} onPointerMove={event=>{if(gesture.current?.pointer===event.pointerId)update(event);}} onPointerUp={up} onPointerCancel={cancelGesture} onLostPointerCapture={cancelGesture} onKeyDown={keyboard}>
    {enabled&&b&&<g>
      <rect x={b.x-pad} y={b.y-pad} width={b.width+2*pad} height={b.height+2*pad} fill="none" stroke="#6c9877" strokeWidth={1.5/screenScale} strokeDasharray={`${5/screenScale} ${4/screenScale}`} rx={5/screenScale} pointerEvents="none"/>
      {!dragging&&<g data-delete-object="true" className="object-delete-button" transform={`translate(${deleteX} ${deleteY}) scale(${1/screenScale})`} role="button" tabIndex={0} aria-label={t('删除选中物件')} onPointerDown={e=>{e.stopPropagation();e.currentTarget.focus();}} onClick={e=>{e.stopPropagation();remove();}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();remove();}}}>
        <title>{t('删除选中物件')}</title><circle r={22} fill="transparent"/>
        <circle className="object-delete-button__disc" r={12} fill="#fff4eb" stroke="#c88770" strokeWidth={1.5}/>
        <X x={-7} y={-7} width={14} height={14} color="#ad654d" strokeWidth={2.2} pointerEvents="none"/>
      </g>}
      {companionAction&&selectedObject&&<ObjectCompanionAction id={selectedObject.id} language={language} position={companionAction} screenScale={screenScale} onKeep={keepSelectedCompanion}/>}
      <g data-resize-handle="true" role="button" aria-label={t('拖动这里调整大小')} style={{cursor:'nwse-resize'}}>
        <circle cx={hx} cy={hy} r={22/screenScale} fill="transparent"/>
        <circle cx={hx} cy={hy} r={r} fill="#fffdf5" stroke="#6c9877" strokeWidth={2/screenScale}/>
        <path d={`M${hx-r*.4} ${hy+r*.4}l${r*.8} ${-r*.8}m${-r*.55} 0h${r*.55}v${r*.55}`} fill="none" stroke="#6c9877" strokeWidth={1.8/screenScale} pointerEvents="none"/>
      </g>
    </g>}
  </svg>;
}
