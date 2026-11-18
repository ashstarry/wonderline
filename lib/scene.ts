import type { PaperViewport } from './paper-viewport';
export type ArtStyle = 'crayon' | 'pencil' | 'watercolor';
export type ObjectKind = 'house' | 'tree' | 'pine' | 'mountain' | 'cloud' | 'sun' | 'moon' | 'star' | 'flower' | 'bird' | 'boat' | 'bench' | 'lamp' | 'cat' | 'bush' | 'mushroom' | 'person' | 'drawing';
export type DrawingMark = {
 type: 'path' | 'ellipse' | 'rect' | 'line' | 'text';
 d?: string; x?: number; y?: number; w?: number; h?: number; x2?: number; y2?: number;
 fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; text?: string;
};
export type SceneObject = { id: string; kind: ObjectKind; x: number; y: number; scale: number; rotation?: number; stackRank?: number; color: string; label?: string; marks?: DrawingMark[]; };
export type ErasureTarget = { key: string; x: number; y: number; scale: number; rotation?: number; };
export type ErasureStroke = { id: string; paths: string[]; width: number; shape?: 'round' | 'square'; targets: ErasureTarget[]; };
export type Scene = { title: string; sky: 'day' | 'sunset' | 'night' | 'paper'; weather: 'clear' | 'rain' | 'snow'; ground: 'lake' | 'meadow' | 'coast' | 'none'; objects: SceneObject[]; erasures?: ErasureStroke[]; paper?: PaperViewport; };
export type ClarificationContext = { instruction: string; question: string; };
export type ImagineInput = { text: string; scene: Scene; recent?: string[]; clarification?: ClarificationContext; mode?: 'live' | 'finish'; canvasViewport?: PaperViewport; };
export type ImagineResult = { scene: Scene; message: string; action?: 'update' | 'undo' | 'clarify' | 'ignore'; };
export const INITIAL_SCENE: Scene = {
 title: '湖边，留一盏灯', sky: 'sunset', weather: 'clear', ground: 'lake', objects: [
 {id:'mountain-left',kind:'mountain',x:220,y:345,scale:1.3,color:'#a0aa94'},
 {id:'mountain-right',kind:'mountain',x:790,y:340,scale:1.6,color:'#aab39a'},
 {id:'sun',kind:'sun',x:575,y:135,scale:1.1,color:'#e9b36c'},
 {id:'cloud-left',kind:'cloud',x:240,y:148,scale:1.3,color:'#fff4e2'},
 {id:'cloud-right',kind:'cloud',x:835,y:205,scale:.8,color:'#fff4e2'},
 {id:'house',kind:'house',x:300,y:397,scale:1.25,color:'#d2a378'},
 {id:'pine-left',kind:'pine',x:154,y:408,scale:1.3,color:'#748775'},
 {id:'pine-mid',kind:'pine',x:207,y:421,scale:.95,color:'#8d9e82'},
 {id:'tree-right',kind:'tree',x:808,y:449,scale:1.3,color:'#9b9e73'},
 {id:'boat',kind:'boat',x:605,y:455,scale:.85,color:'#ad7859'},
 {id:'flower',kind:'flower',x:770,y:542,scale:.7,color:'#ce916e'},
 {id:'bird1',kind:'bird',x:480,y:204,scale:.7,color:'#786c5b'},
 {id:'bird2',kind:'bird',x:513,y:193,scale:.5,color:'#786c5b'} ]
};
export const STYLE_LABELS: Record<ArtStyle,string> = {crayon:'蜡笔',pencil:'彩铅',watercolor:'水彩'};
export const cloneScene = (s: Scene): Scene => JSON.parse(JSON.stringify(s));
