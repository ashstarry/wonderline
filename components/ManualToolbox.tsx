'use client';
import { useEffect, useRef, type Ref } from 'react';
import { Circle, Square, Check, ChevronLeft, ChevronRight, Eraser, Pencil, MousePointer2, Shrink, Expand, RotateCcw, RotateCw, ArrowUp, BringToFront, X } from 'lucide-react';
import ColorPalette, { QUICK_COLORS } from './ColorPalette';
import { useLanguage } from './LanguageProvider';
import { MANUAL_SIZES } from '../lib/manual-tools';
import type { EraserShape } from '../lib/eraser-shape';
import './manual-toolbox.css';
import type { ObjectSelectionState } from './ObjectTransformLayer';

type Props = {
  open:boolean; triggerRef:Ref<HTMLButtonElement>; onToggle:()=>void;
  tool: 'pen' | 'eraser' | 'move' | 'none'; color: string; size: number; disabled: boolean;
  onToolChange: (tool: 'pen' | 'eraser' | 'move') => void;
  onColorChange: (color: string) => void; onSizeChange: (size: number) => void;
  eraserShape?: EraserShape; onEraserShapeChange?: (shape: EraserShape) => void;
  onClose: () => void;
  selection?: ObjectSelectionState;
  revealSelectionActions?: boolean;
  onObjectAction?: (action: 'smaller' | 'bigger' | 'left' | 'right' | 'straighten' | 'front' | 'delete') => void;
};
export default function ManualToolbox({open,triggerRef,onToggle,tool,color,size,disabled,onToolChange,onColorChange,onSizeChange,eraserShape='round',onEraserShapeChange,onClose,selection,onObjectAction,revealSelectionActions=false}: Props) {
  const {t}=useLanguage();
  const scrollport=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!revealSelectionActions||!open||tool!=='move'||!selection||selection.dragging)return;
    const node=scrollport.current;
    const first=node?.querySelector<HTMLElement>('[data-object-action="smaller"]');
    const last=node?.querySelector<HTMLElement>('[data-object-action="right"]');
    if(!node||!first||!last)return;
    const origin=node.getBoundingClientRect().top;
    const top=first.getBoundingClientRect().top-origin+node.scrollTop-8;
    const bottom=last.getBoundingClientRect().bottom-origin+node.scrollTop+8;
    // Move only this drawer's scrollport, never the paper or surrounding page.
    if(top<node.scrollTop||bottom>node.scrollTop+node.clientHeight)node.scrollTop=Math.max(0,top);
  },[revealSelectionActions,open,tool,selection?.id,selection?.dragging]);

  useEffect(()=>{
    if(!open)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();onClose();}};
    window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);
  },[onClose,open]);
  return <aside className={`manual-sidebar ${open?'is-open':''}`} aria-label={t('画具侧栏')}>
    <div className="manual-sidebar__rail"><button ref={triggerRef} className="manual-sidebar__toggle" aria-expanded={open} aria-controls="manual-toolbox" aria-label={t(open?'收起画具':'展开画具')} title={t(open?'收起画具':'展开画具')} onClick={onToggle}>
      {tool==='move'?<MousePointer2 size={20}/>:tool==='eraser'?<Eraser size={20}/>:<Pencil size={20}/>}<span>{t('画具')}</span>{open?<ChevronLeft size={16}/>:<ChevronRight size={16}/>}</button></div>
    <div className="manual-sidebar__drawer" inert={!open} aria-hidden={!open}>
      <div ref={scrollport} id="manual-toolbox" className="manual-toolbox">
        <div className="manual-toolbox__tools" role="group" aria-label={t('小画具')}>
          <button className={tool==='pen'?'selected':''} onClick={()=>onToolChange('pen')} disabled={disabled} aria-pressed={tool==='pen'} aria-label={t('自己画')}><Pencil size={24}/><span>{t('画笔')}</span></button>
          <button className={tool==='eraser'?'selected':''} onClick={()=>onToolChange('eraser')} disabled={disabled} aria-pressed={tool==='eraser'} aria-label={t('橡皮，按住拖动擦除')}><Eraser size={24}/><span>{t('橡皮')}</span></button>
          <button className={tool==='move'?'selected':''} onClick={()=>onToolChange('move')} disabled={disabled} aria-pressed={tool==='move'} aria-label={t('操控物件')}><MousePointer2 size={24}/><span>{t('物件')}</span></button>
        </div>
        {tool==='move'?<>
          <div className="manual-toolbox__object-actions" role="group" aria-label={t('物件操作')}>
            <button className="is-front" disabled={disabled||!selection||selection.dragging} aria-label={t('置顶')} onClick={()=>onObjectAction?.('front')}><BringToFront size={22}/><span>{t('置顶')}</span></button>
            {([{action:'smaller',label:'变小',Icon:Shrink},{action:'bigger',label:'变大',Icon:Expand},{action:'left',label:'向左转',Icon:RotateCcw},{action:'right',label:'向右转',Icon:RotateCw},{action:'straighten',label:'摆正',Icon:ArrowUp},{action:'delete',label:'删除',Icon:X}] as const).map(({action,label,Icon})=><button key={action} data-object-action={action} className={action==='delete'?'is-delete':''} disabled={disabled||!selection||selection.dragging||(action==='straighten'&&selection.rotation===0)} aria-label={t(label)} onClick={()=>onObjectAction?.(action)}><Icon size={22}/><span>{t(label)}</span></button>)}
          </div>
          <div className="manual-toolbox__move-tip"><MousePointer2 size={20}/>{selection?<><span>{t('拖一拖，换位置')}</span><span>{t('拉圆角，变大小')}</span></>:<span>{t('点选画中的物件')}</span>}</div>
        </>:<>
          {tool==='pen'&&<><div className="manual-toolbox__colors" role="group" aria-label={t('画笔颜色')}>
            {QUICK_COLORS.map(choice=><button key={choice.value} disabled={disabled} aria-pressed={color===choice.value&&tool==='pen'} aria-label={t(choice.name)} title={t(choice.name)} onClick={()=>onColorChange(choice.value)}><i style={{backgroundColor:choice.value}}>{color===choice.value&&tool==='pen'&&<Check size={15}/>}</i></button>)}
          </div>
          {open&&<ColorPalette value={color} onChange={onColorChange} disabled={disabled}/>}</>}
          {tool==='eraser'&&<div className="manual-toolbox__shapes" role="group" aria-label={t('橡皮形状')}>
            {(['round','square'] as const).map(shape=><button key={shape} disabled={disabled} aria-pressed={eraserShape===shape} onClick={()=>onEraserShapeChange?.(shape)} aria-label={t(shape==='round'?'圆形橡皮':'方形橡皮')}>{shape==='round'?<Circle size={22}/>:<Square size={22}/>}<span>{t(shape==='round'?'圆形':'方形')}</span></button>)}
          </div>}
          <div className="manual-toolbox__sizes" role="group" aria-label={t(tool==='eraser'?'橡皮大小':'画笔大小')}>
            {MANUAL_SIZES.map(choice=><button key={choice.value} disabled={disabled} className={size===choice.value?'selected':''} aria-pressed={size===choice.value} aria-label={t('{size}号{tool}',{size:t(choice.label),tool:t(tool==='eraser'?'橡皮':'画笔')})} onClick={()=>onSizeChange(choice.value)}><span className="manual-toolbox__size-dot"><i style={{width:choice.preview,height:choice.preview,borderRadius:tool==='eraser'&&eraserShape==='square'?2:undefined}}/></span><span>{t(choice.label)}</span></button>)}
          </div>
        </>}
      </div>
    </div>
  </aside>;
}
