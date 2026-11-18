"use client";
import { researchTextNoticeVisible } from '@/lib/research-recording';
import { chooseDrawingSpeed, drawingExperimentEnabled, drawingPaperStorageKey, studioApi, studioPage } from '@/lib/studio-endpoint';
import DrawingSpeedChoice from '@/components/DrawingSpeedChoice';
import PictureBook from '@/components/PictureBook';
import PaperInspiration from '@/components/PaperInspiration';
import { InspirationSpeechOnset, isUnmarkedPaper } from '@/lib/paper-inspiration-flow';
import StoryTheatre from '@/components/StoryTheatre';
import { StudioLibraryNav } from '@/components/StudioDiscover';
import CompanionShelf, { CompanionSpark } from '@/components/CompanionShelf';
import CompanionCanvasPicker, { type CompanionPickCandidate } from '@/components/CompanionCanvasPicker';
import { isCompanionCandidate } from '@/lib/companion-candidates';
import { getScenePaintOrder } from '@/lib/scene-paint-order';
import { COMPANION_KEY, CompanionError, addCompanion, createCompanion, loadCompanions, namedObjectLabel, normalizeCompanionName, removeCompanion, renameCompanion, storeCompanions, type Companion, type CompanionState } from '@/lib/story-companions';
import { parseCompanionSave, parseCompanionRemember, parseCompanionIdeaRequest } from '@/lib/companion-voice';
import { companionSubject, shouldDeferCompanionLookahead, namedCompanionObject, newlyDrawnSubjects, prepareCompanionRecall, renameCompanionInScene } from '@/lib/companion-turn';
import type { PictureBookDraft, PictureBookEntry } from '@/lib/picture-book';
import '@/components/studio-extras.css';

import { useLanguage } from '../components/LanguageProvider';
import { CHINESE_UI_ENABLED } from '@/lib/ui-language';

import { embedDrawingFont } from '@/lib/drawing-font';
import { PreviewBuffer } from '@/lib/preview-buffer';
import { rollbackDrawingTurn, ROLLED_BACK_DRAWING_MESSAGE } from '@/lib/drawing-rollback';
import { DrawingLookahead, canLookAhead, type LookaheadContext } from '@/lib/drawing-lookahead';
import type { DrawingLayout } from '@/lib/imagine-stream-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Settings, Feather, Mic, RefreshCw, RotateCcw, Undo2, Redo2, Upload, X, Volume2, VolumeX, Keyboard, MessageCircle } from 'lucide-react';
import SceneCanvas from '@/components/SceneCanvas';
import FreehandLayer, { type FreehandControls } from '@/components/FreehandLayer';
import { QUICK_COLORS } from '@/components/ColorPalette';
import ManualToolbox from '@/components/ManualToolbox';
import ObjectTransformLayer, { type ObjectTransformControls, type ObjectSelectionState } from '@/components/ObjectTransformLayer';
import VoiceControls from '@/components/VoiceControls';
import DrawingTurnNotice from '@/components/DrawingTurnNotice';
import { DrawingFailure, RolledBackDrawingFailure, drawingFailureKind } from '@/lib/drawing-failure';
import { TurnFeedbackGate, inputIsBusy } from '@/lib/turn-flow';
import PaperResponse, { type PaperResponseHandle } from '@/components/PaperResponse';
import { brushCompanionState } from '@/components/brush-companion-state';
import { type ConversationEntry, appendTextEntry, interruptVoiceEntry, omitVoiceRanges, type TranscriptTarget } from '@/lib/conversation';
import { VoiceTranscriptIndex } from '@/lib/transcript-omission';
import { CONTENT_BLOCKED_MESSAGE, inspectText } from '@/lib/content-filter';
import { filterVoiceTranscript } from '@/lib/content-filter-transcript';
import { LEGACY_PAPER_ID, paperIdFor, restorePaperConversations, serializePaperConversations } from '@/lib/paper-conversation';
import { preserveErasures, sceneForModel } from '@/lib/eraser';
import { readDrawingHistory, writeDrawingHistory, type DrawingHistoryEntry } from '@/lib/drawing-history';
import { removePlaybackArtifacts } from '@/components/svg-stroke-playback';
import { ArtStyle, Scene, INITIAL_SCENE, STYLE_LABELS, cloneScene } from '@/lib/scene';
import { startStreamingRecording, startStreamingFile, type StreamingHandle, type StreamingUpdate } from '@/lib/audio';
import { LivePaintingQueue, StreamUpdateGate, EMPTY_PAINT_QUEUE, type PaintQueueState } from '@/lib/live-painting';
import { listMicrophones, type MicrophoneDevice } from '@/lib/microphone';
import { checkAsrConnection } from '@/lib/asr-connection';
import { requestImagine } from '@/lib/imagine-stream-client';
import { measureCanvasContext } from '@/components/canvas-context';
import { DEFAULT_PAPER, fitPaperViewport, retainPaperExtent } from '@/lib/paper-viewport';
import { artworkExportSize } from '@/lib/artwork-export';

type Entry = DrawingHistoryEntry;
type LivePhase = 'off' | 'requesting' | 'recording' | 'uploading' | 'finishing' | 'draining';
type Clarification = { instruction: string; question: string };
type MotionPreference = 'system' | 'draw' | 'still';
const examples = ['画一只穿宇航服的鲸鱼', '月亮上开了一间咖啡馆', '让这幅画下起糖果雨'];
const initialEntry = ():Entry => ({scene:{title:'轻轻画',sky:'paper',weather:'clear',ground:'none',objects:[]},phrase:'',message:'',style:'crayon'});
const microphoneStorageKey = 'softspoken-microphone-v2';
const motionStorageKey = 'softspoken-motion-v1';
const conversationStorageKey = 'softspoken-conversation-v1';
const penColorStorageKey = 'softspoken-pen-color-v1';
const penColors = QUICK_COLORS;

export default function Home() {
 const {t,language,setLanguage,brand}=useLanguage();
 const languageRef=useRef(language);languageRef.current=language;
 const [scene,setScene]=useState<Scene>(()=>initialEntry().scene);
 const [style,setStyle]=useState<ArtStyle>('crayon');
 const [history,setHistory]=useState<Entry[]>([initialEntry()]);
 const [cursor,setCursor]=useState(0);
 const [handTool,setHandTool]=useState<'pen'|'eraser'|'move'|'none'>('move');
 const [penColor,setPenColor]=useState(penColors[0].value);
 const [penWidth,setPenWidth]=useState(5);
 const [eraserShape,setEraserShape]=useState<'round'|'square'>('round');
 const [toolsOpen,setToolsOpen]=useState(false);
 const [objectSelection,setObjectSelection]=useState<ObjectSelectionState>(null);
 const lastObjectSelection=useRef<ObjectSelectionState>(null);
 const handleObjectSelection=useCallback((next:ObjectSelectionState)=>{
  const previous=lastObjectSelection.current;lastObjectSelection.current=next;
  setObjectSelection(next);
  // Let the pointer finish first; opening must never interrupt a drag.
  if(next&&!next.dragging&&(previous?.id!==next.id||previous.dragging))setToolsOpen(true);
 },[]);
 const toolsTrigger=useRef<HTMLButtonElement>(null);
 const closeTools=useCallback(()=>{setToolsOpen(false);toolsTrigger.current?.focus();},[]);
 const [conversation,setConversation]=useState<ConversationEntry[]>([]);
 const [conversationSaveError,setConversationSaveError]=useState('');
 const [drawingSaveError,setDrawingSaveError]=useState('');
 const [playbackTurn,setPlaybackTurn]=useState(0);
 const drawingRestoreFailed=useRef(false);
 const conversationRef=useRef<ConversationEntry[]>([]);
 const activePaperRef=useRef(LEGACY_PAPER_ID);
 const paperConversationsRef=useRef(new Map<string,ConversationEntry[]>());
 const voiceSessionRef=useRef<string|undefined>(undefined);
 const transcriptIndex=useRef(new VoiceTranscriptIndex());
 const logFollowing=useRef(true);
 const [batchPainting,setBatchPainting]=useState(false);
 const [strokePlayback,setStrokePlayback]=useState(false);
 const [awaitingFirstStroke,setAwaitingFirstStroke]=useState(false);
 const [playbackResetKey,setPlaybackResetKey]=useState(0);
 const [motionPreference,setMotionPreference]=useState<MotionPreference>('draw');
 const [reducedMotion,setReducedMotion]=useState(false);
 const [configured,setConfigured]=useState<boolean|null>(null);
 const [asrReady,setAsrReady]=useState(false);
 const [asrConnection,setAsrConnection]=useState<Awaited<ReturnType<typeof checkAsrConnection>>|null>(null);
 const [asrChecking,setAsrChecking]=useState(false);
 const asrLastReady=useRef<{at:number;status:Awaited<ReturnType<typeof checkAsrConnection>>}|null>(null);
 const [clarification,setClarification]=useState<Clarification|null>(null);
 const [notice,setNotice]=useState('');
 const [blockedNotice,setBlockedNotice]=useState(0);
 const [turnFeedback,setTurnFeedback]=useState('');
 const turnGate=useRef(new TurnFeedbackGate());
 const speechDraft=useRef(false);
 const [error,setError]=useState('');
 const [help,setHelp]=useState(false);
 const [pictureBookOpen,setPictureBookOpen]=useState(false);
 const inspirationOnset=useRef(new InspirationSpeechOnset());
 const inspirationSeenRef=useRef(new Set<string>());
 const [inspirationSeen,setInspirationSeen]=useState<Set<string>>(()=>new Set());
 const [theatreOpen,setTheatreOpen]=useState(false);
 const [companionPicking,setCompanionPicking]=useState(false);
 const [pickInitialId,setPickInitialId]=useState<string|null>(null);
 const companionPickEpoch=useRef(0);
 const [companionsOpen,setCompanionsOpen]=useState(false);
 const [companions,setCompanions]=useState<Companion[]>([]);
 const companionsRef=useRef<CompanionState>({entries:[],raw:null});
 const companionsLocked=useRef(false);
 const companionSavePending=useRef(false);
 const [companionError,setCompanionError]=useState('');
 const [companionNotice,setCompanionNotice]=useState('');
 const [companionUndo,setCompanionUndo]=useState<Companion[]|null>(null);
 const [companionCandidates,setCompanionCandidates]=useState<CompanionPickCandidate[]>([]);
 const companionCandidatesRef=useRef<CompanionPickCandidate[]>([]);
 const [activeCompanion,setActiveCompanion]=useState<string|null>(null);
 const activeCompanionRef=useRef<string|null>(null);
 const lastSubjectIds=useRef<string[]>([]);
 const [companionSpark,setCompanionSpark]=useState(0);
 const [resetConfirm,setResetConfirm]=useState(false);
 const [sound,setSound]=useState(false);
 const [seconds,setSeconds]=useState(0);
 const [hydrated,setHydrated]=useState(false);
 const [quickDrawing,setQuickDrawing]=useState(false);
 const [saved,setSaved]=useState(false);
 const [livePhase,setLivePhase]=useState<LivePhase>('off');
 const [asrCatchingUp,setAsrCatchingUp]=useState(false);
 const [liveQueue,setLiveQueue]=useState<PaintQueueState>(EMPTY_PAINT_QUEUE);
 const [stableCaption,setStableCaption]=useState('');
 const [partialCaption,setPartialCaption]=useState('');
 const [microphoneDevices,setMicrophoneDevices]=useState<MicrophoneDevice[]>([]);
 const [selectedMicrophone,setSelectedMicrophone]=useState('system');
 const [savedMicrophoneLabel,setSavedMicrophoneLabel]=useState('');
 const [activeMicrophoneLabel,setActiveMicrophoneLabel]=useState('');
 const [microphoneRefreshing,setMicrophoneRefreshing]=useState(false);
 const [microphonesLoaded,setMicrophonesLoaded]=useState(false);
 const [microphoneListError,setMicrophoneListError]=useState('');
 const sceneRef=useRef(scene);
 const manualPoseScene=useRef<Scene|null>(null);
 const paperFrame=useRef<HTMLDivElement>(null);
 const [paperPixels,setPaperPixels]=useState({width:1000,height:640});
 // History may restore an older, smaller sheet. Keep the camera stable while
 // its visible strokes are erased; shrinking the view would clip their ghosts.
 const paperExtent=useRef({...DEFAULT_PAPER});
 const viewport=useMemo(()=>{
  paperExtent.current=retainPaperExtent(paperExtent.current,scene.paper??DEFAULT_PAPER);
  return fitPaperViewport(paperPixels.width,paperPixels.height,paperExtent.current);
 },[paperPixels,scene.paper]);
 const viewportRef=useRef(viewport);viewportRef.current=viewport;
 useEffect(()=>{const frame=paperFrame.current;if(!frame)return;const resize=new ResizeObserver(entries=>{const rect=entries[0]?.contentRect;if(rect&&rect.width>0&&rect.height>0){freehandControls.current?.cancelGesture();transformControls.current?.cancelGesture();setPaperPixels(previous=>previous.width===rect.width&&previous.height===rect.height?previous:{width:rect.width,height:rect.height});}});resize.observe(frame);return()=>resize.disconnect();},[]);
 const freehandControls=useRef<FreehandControls>(null);
 const transformControls=useRef<ObjectTransformControls>(null);
 const brushCompanion=useRef<PaperResponseHandle>(null);
 const waitingPaintToken=useRef<number|null>(null);
 const shortcutUndo=useRef<()=>void>(()=>{});
 const timeline=useRef({history,cursor});
 const clarificationRef=useRef<Clarification|null>(null);
 const configuredRef=useRef<boolean|null>(null);
 const phaseRef=useRef<LivePhase>('off');
 const queueRef=useRef<LivePaintingQueue|null>(null);
 const recording=useRef<StreamingHandle|null>(null);
 const liveHandlers=useRef<{id:number;onUpdate:(update:StreamingUpdate)=>void;onError:(cause:Error)=>void}|null>(null);
 const liveAbort=useRef<AbortController|null>(null);
 const batchAbort=useRef<AbortController|null>(null);
 const batchPending=useRef(false);
 const timer=useRef<ReturnType<typeof setInterval>|null>(null);
 const stopRef=useRef<()=>void>(()=>{});
 const fileRef=useRef<HTMLInputElement>(null);
 const audioRef=useRef<AudioContext|null>(null);
 const mounted=useRef(true);
 const operation=useRef(0);
 const captionRef=useRef<HTMLDivElement>(null);
 const microphoneChoiceRef=useRef('system');
 const microphoneRefreshId=useRef(0);
 const asrCheckSequence=useRef(0);
 const previewOwner=useRef<{token:number;operation:number}|null>(null);
 const paintSequence=useRef(0);
 const lookahead=useRef(new DrawingLookahead());
 const modelPreview=useRef<(LookaheadContext & {token:number;operation:number})|null>(null);
 const visibleConversation=conversation.filter(entry=>entry.text.trim()||entry.partial.trim());
 const painting=batchPainting||liveQueue.painting||strokePlayback;
 const audioActive=livePhase==='recording'||livePhase==='uploading';
 const liveBusy=livePhase!=='off'||liveQueue.painting||liveQueue.pendingCount>0||liveQueue.paused;
 const busy=batchPainting||liveBusy;
 const inputBusy=inputIsBusy(livePhase,batchPainting,liveQueue);
 const serviceError=error||(liveQueue.paused?liveQueue.error:'');
 const voiceState=configured===null?'loading':livePhase==='requesting'?'preparing':audioActive?'listening':livePhase==='finishing'?'finishing':inputBusy?'drawing':'idle';
 const modelThinking=batchPainting||liveQueue.painting;
 const hasCompanionCandidate=history[cursor]?.scene.objects.some(isCompanionCandidate)??false;
 const canPickCompanion=hydrated&&!modelThinking&&!companionsLocked.current&&hasCompanionCandidate;
 const companionState=brushCompanionState({listening:audioActive,preparing:modelThinking,drawing:strokePlayback,blocked:!!serviceError||help||resetConfirm||pictureBookOpen||theatreOpen||companionsOpen||companionPicking});
 const inspirationVisible=hydrated&&!help&&!resetConfirm&&!pictureBookOpen&&!theatreOpen&&!companionsOpen&&!companionPicking&&!serviceError&&!painting&&!inspirationSeen.has(activePaperRef.current)&&!visibleConversation.length&&isUnmarkedPaper(scene);
 const inspirationCompanion=companions.find(entry=>entry.id===activeCompanion)?.name??companions[0]?.name??null;
 useEffect(()=>{if(!inspirationVisible)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented)dismissInspiration();};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[inspirationVisible]);
 const microphoneLocked=['requesting','recording','finishing'].includes(livePhase);
 const selectedMicrophoneMissing=microphonesLoaded&&!['system','computer'].includes(selectedMicrophone)&&!microphoneDevices.some(device=>device.deviceId===selectedMicrophone);
 const computerMicrophone=microphoneDevices.find(device=>device.isComputer&&/macbook/i.test(device.label))||microphoneDevices.find(device=>device.isComputer);
 const deviceNamesVisible=microphoneDevices.some(device=>!!device.label);
 const microphoneHint=selectedMicrophone==='system'?'跟随系统当前选择的麦克风。第一次录音时，允许浏览器访问即可。':microphoneListError||(selectedMicrophoneMissing?t('上次选择的「{device}」已不可用，请重新选择。',{device:savedMicrophoneLabel||t('麦克风')}):microphonesLoaded&&!deviceNamesVisible?'设备名称还未显示。你可以先用系统默认麦克风录音，或在浏览器设置里允许访问后刷新。':microphonesLoaded&&selectedMicrophone!=='computer'&&!microphoneDevices.find(device=>device.deviceId===selectedMicrophone)?.label?'暂时无法确认这个设备，请重新选择或使用系统默认。':microphonesLoaded&&selectedMicrophone==='computer'&&!computerMicrophone?'没有找到电脑内置麦克风，请选择其他设备。':'只在你点录音后打开麦克风。');
 const asrConnectionLabel=asrChecking?'正在检查':asrReady?'已就绪':asrConnection?.state==='loading'?'正在启动':asrConnection?.state==='startup-error'?'启动失败':asrConnection?.state==='outdated'?'需要重启':'尚未连接';

 function dismissInspiration(){
  const key=activePaperRef.current;
  if(!inspirationSeenRef.current.has(key)){inspirationSeenRef.current.add(key);setInspirationSeen(new Set(inspirationSeenRef.current));}
 }
 function setPhase(phase:LivePhase){phaseRef.current=phase;setLivePhase(phase);}
 function updateConversation(next:ConversationEntry[]){
  conversationRef.current=next;setConversation(next);paperConversationsRef.current.set(activePaperRef.current,next);
  const retained=timeline.current.history.map(paperIdFor);
  for(const id of paperConversationsRef.current.keys())if(id!==activePaperRef.current&&!retained.includes(id))paperConversationsRef.current.delete(id);
  try{localStorage.setItem(drawingPaperStorageKey(conversationStorageKey),serializePaperConversations(paperConversationsRef.current,activePaperRef.current,next,retained));setConversationSaveError('');}catch{setConversationSaveError('暂时无法保存到浏览器，请先复制这些文字。');}
 }
 function keepVoiceDraft(){updateConversation(interruptVoiceEntry(conversationRef.current,voiceSessionRef.current));voiceSessionRef.current=undefined;}
 function chooseHandTool(tool:'pen'|'eraser'|'move'){if(isBusy()||painting)return;setHandTool(tool);setNotice('');}
 function commitHandDrawing(next:Scene,phrase:string){if(isBusy())return;dismissInspiration();commit(next,phrase,'这是你亲手画的。',true);setQuestion(null);setError('');}
 function commitObjectEdit(next:Scene,phrase:string){if(isBusy()||painting)return;commit(next,phrase,'',false,style,true);setQuestion(null);setError('');}
 function objectAction(action:'smaller'|'bigger'|'left'|'right'|'straighten'|'front'|'delete'){
  if(isBusy()||painting)return;
  const controls=transformControls.current;if(!controls)return;
  if(action==='front')controls.front();else if(action==='delete')controls.remove();else if(action==='smaller'||action==='bigger')controls.resize(action==='bigger'?1.15:1/1.15);else controls.turn(action==='straighten'?null:action==='left'?-15:15);
 }
 async function copyConversation(){try{await navigator.clipboard.writeText(conversationRef.current.map(entry=>`${entry.text}${entry.partial}`).filter(Boolean).join('\n\n'));setNotice('所有文字都复制好了。');}catch{setNotice('可以直接选中记录里的文字复制。');}}
 function setQuestion(value:Clarification|null,show=true){clarificationRef.current=value;setClarification(show?value:null);}
 function retireTurnNotice(){setTurnFeedback('');setClarification(null);queueRef.current?.dismissTurnFailure();}
 function dismissTurnNotice(){turnGate.current.advance();retireTurnNotice();setQuestion(null);}
 function isInputBusy(){return inputIsBusy(phaseRef.current,batchPending.current,queueRef.current?.snapshot());}
 function stopClock(){if(timer.current){clearInterval(timer.current);timer.current=null;}}
 function isCurrent(id:number){return mounted.current&&operation.current===id;}
 function isBusy(){const q=queueRef.current?.snapshot();return batchPending.current||phaseRef.current!=='off'||!!q&&(q.painting||q.paused||q.pendingCount>0);}
 function resetBrushPreparation(){waitingPaintToken.current=null;setAwaitingFirstStroke(false);brushCompanion.current?.reset();}
 const handleDrawingChange=useCallback((drawing:boolean)=>{setStrokePlayback(drawing);if(drawing){waitingPaintToken.current=null;setAwaitingFirstStroke(false);brushCompanion.current?.reset();}},[]);
 function resetPlayback(){setPlaybackResetKey(value=>value+1);setStrokePlayback(false);resetBrushPreparation();}
 function rollbackPreview(){previewOwner.current=null;setScene(sceneRef.current);resetBrushPreparation();}
 function replaceTimeline(entries:Entry[],index:number,snap=false){previewOwner.current=null;timeline.current={history:entries,cursor:index};sceneRef.current=entries[index].scene;setHistory(entries);setCursor(index);setScene(entries[index].scene);if(entries[index].style)setStyle(entries[index].style);if(snap)resetPlayback();}
 function commit(next:Scene,phrase:string,message:string,snap=false,nextStyle=style,manualPose=false){manualPoseScene.current=manualPose?next:null;const subjects=newlyDrawnSubjects(sceneRef.current,next);if(subjects.length)lastSubjectIds.current=subjects;const t=timeline.current;const list=[...t.history.slice(0,t.cursor+1),{scene:next,phrase,message,paperId:activePaperRef.current,style:nextStyle}].slice(-31);replaceTimeline(list,list.length-1,snap);}
 function moveHistory(direction:number,allowPaperSwitch=true){
  const t=timeline.current;const index=Math.max(0,Math.min(t.history.length-1,t.cursor+direction));
  const paper=paperIdFor(t.history[index]);const switching=paper!==activePaperRef.current;
  if(index===t.cursor||(switching&&(!allowPaperSwitch||phaseRef.current!=='off')))return false;
  setQuestion(null);
  if(switching){inspirationOnset.current.reset();paperConversationsRef.current.set(activePaperRef.current,conversationRef.current);activePaperRef.current=paper;voiceSessionRef.current=undefined;setStableCaption('');setPartialCaption('');logFollowing.current=true;}
  manualPoseScene.current=null;replaceTimeline(t.history,index);
  if(switching)updateConversation(paperConversationsRef.current.get(paper)??[]);
  return true;
 }
 function undo(){if(isBusy())return;if(transformControls.current?.cancelGesture()||freehandControls.current?.cancelGesture()){setNotice('取消了正在画的这一笔。');return;}if(timeline.current.cursor===0)return;moveHistory(-1);setNotice('回到上一笔了。');}
 function redo(){if(isBusy())return;moveHistory(1);}
 shortcutUndo.current=()=>{if(!help&&!resetConfirm&&!pictureBookOpen&&!theatreOpen&&!companionsOpen&&!companionPicking&&hydrated)undo();};
 async function refreshAsrConnection(signal?:AbortSignal){
  const requestId=++asrCheckSequence.current;setAsrChecking(true);
  try{const connection=await checkAsrConnection({signal,language:languageRef.current});if(mounted.current&&requestId===asrCheckSequence.current){setAsrConnection(connection);setAsrReady(connection.ready);asrLastReady.current=connection.ready?{at:Date.now(),status:connection}:null;}return connection;}
  finally{if(mounted.current&&requestId===asrCheckSequence.current)setAsrChecking(false);}
 }
 async function refreshMicrophones(){
  const requestId=++microphoneRefreshId.current;
  setMicrophoneRefreshing(true);setMicrophoneListError('');
  try{const devices=await listMicrophones();if(mounted.current&&requestId===microphoneRefreshId.current){setMicrophoneDevices(devices);setMicrophonesLoaded(true);}}
  catch(cause){if(mounted.current&&requestId===microphoneRefreshId.current){setMicrophoneDevices([]);setMicrophonesLoaded(true);setMicrophoneListError(cause instanceof Error?cause.message:'暂时无法读取麦克风列表，请在浏览器设置里检查麦克风权限。');}}
  finally{if(mounted.current&&requestId===microphoneRefreshId.current)setMicrophoneRefreshing(false);}
 }
 function chooseMicrophone(deviceId:string){
  if(['requesting','recording','finishing'].includes(phaseRef.current))return;
  const device=microphoneDevices.find(item=>item.deviceId===deviceId);
  if(!['system','computer'].includes(deviceId)&&(!device||!device.label))return;
  microphoneChoiceRef.current=deviceId;setSelectedMicrophone(deviceId);setSavedMicrophoneLabel(device?.label||'');
  try{if(deviceId==='system')localStorage.removeItem(microphoneStorageKey);else localStorage.setItem(microphoneStorageKey,JSON.stringify({deviceId,label:device?.label||'电脑内置麦克风'}));}catch{}
 }
 function chooseMotionPreference(value:MotionPreference){setMotionPreference(value);try{localStorage.setItem(motionStorageKey,value);}catch{}}
 function changeDrawingSpeed(quick:boolean){if(!hydrated||isBusy()||painting)return;lookahead.current.cancel();modelPreview.current=null;chooseDrawingSpeed(quick);setQuickDrawing(quick);}

 useEffect(()=>{
  mounted.current=true;
  setQuickDrawing(drawingExperimentEnabled());
  const statusAbort=new AbortController();
  fetch(studioApi('/api/status'),{signal:statusAbort.signal}).then(r=>r.json() as Promise<{configured:boolean}>).then(s=>{if(!statusAbort.signal.aborted){configuredRef.current=!!s.configured;setConfigured(!!s.configured);}}).catch(()=>{if(!statusAbort.signal.aborted){configuredRef.current=false;setConfigured(false);}});
  let previousHistory:unknown=[];
  try {
   const raw=localStorage.getItem(drawingPaperStorageKey('softspoken-v1'));const restored=readDrawingHistory(raw);
   if(restored){previousHistory=restored.history;replaceTimeline(restored.history.map(entry=>({...entry,style:entry.style??restored.style})),restored.cursor,true);}
   else if(raw){drawingRestoreFailed.current=true;setDrawingSaveError('上次的画暂时无法读取，原记录已保留。新画请先下载保存。');}
  }catch{drawingRestoreFailed.current=true;setDrawingSaveError('暂时无法读取保存的画，请先下载保留新画。');}
  activePaperRef.current=paperIdFor(timeline.current.history[timeline.current.cursor]);
  try{const restored=restorePaperConversations(localStorage.getItem(drawingPaperStorageKey(conversationStorageKey)),previousHistory,activePaperRef.current);paperConversationsRef.current=restored.papers;updateConversation(restored.entries);}catch{setConversationSaveError('暂时无法读取保存的文字，请检查浏览器存储权限。');}
  try{const color=localStorage.getItem(penColorStorageKey);if(color&&/^#[0-9a-f]{6}$/i.test(color))setPenColor(color.toLowerCase());}catch{}

  setHydrated(true);
  return ()=>{mounted.current=false;operation.current++;statusAbort.abort();batchAbort.current?.abort();liveAbort.current?.abort();recording.current?.cancel();queueRef.current?.cancel();lookahead.current.cancel();modelPreview.current=null;if(timer.current)clearInterval(timer.current);void audioRef.current?.close();};
 },[]);
 useEffect(()=>{
  asrLastReady.current=null;setAsrReady(false);
  const controller=new AbortController();
  void refreshAsrConnection(controller.signal).catch(()=>{});
  return()=>controller.abort();
 },[language]);
 useEffect(()=>{
  try{localStorage.removeItem('softspoken-microphone-v1');const saved=JSON.parse(localStorage.getItem(microphoneStorageKey)||'null');if(typeof saved?.deviceId==='string'&&saved.deviceId&&!['default','communications','system'].includes(saved.deviceId)){microphoneChoiceRef.current=saved.deviceId;setSelectedMicrophone(saved.deviceId);setSavedMicrophoneLabel(typeof saved.label==='string'?saved.label:'');}}catch{}
  void refreshMicrophones();
  const refresh=()=>{void refreshMicrophones();};
  navigator.mediaDevices?.addEventListener('devicechange',refresh);
  return()=>{microphoneRefreshId.current++;navigator.mediaDevices?.removeEventListener('devicechange',refresh);};
 },[]);
 useEffect(()=>{
  if(!hydrated||drawingRestoreFailed.current)return;
  try{localStorage.setItem(drawingPaperStorageKey('softspoken-v1'),writeDrawingHistory({history,cursor,style}));setDrawingSaveError('');}
  catch{setDrawingSaveError('浏览器暂时存不下这幅画了，请先点「收好这幅画」下载保留。');}
 },[history,cursor,style,hydrated]);
 useEffect(()=>{if(hydrated)try{localStorage.setItem(penColorStorageKey,penColor);}catch{}},[penColor,hydrated]);
 useEffect(()=>{
  try{const value=localStorage.getItem(motionStorageKey);if(value==='system'||value==='draw'||value==='still')setMotionPreference(value);}catch{}
  const media=window.matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>setReducedMotion(media.matches);update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(t);},[notice]);
 useEffect(()=>{if(!blockedNotice)return;const timer=setTimeout(()=>setBlockedNotice(0),3000);return()=>clearTimeout(timer);},[blockedNotice]);
 useEffect(()=>{if(turnFeedback!==ROLLED_BACK_DRAWING_MESSAGE)return;const timer=setTimeout(()=>setTurnFeedback(current=>current===ROLLED_BACK_DRAWING_MESSAGE?'':current),7000);return()=>clearTimeout(timer);},[turnFeedback]);
 useEffect(()=>{if(!help&&!resetConfirm)return;const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'){setHelp(false);setResetConfirm(false);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[help,resetConfirm]);
 useEffect(()=>{
  const onKey=(event:KeyboardEvent)=>{
   if(event.defaultPrevented||event.isComposing||event.altKey||event.shiftKey||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z')return;
   const target=event.target;
   if(target instanceof Element&&(target.closest('input,textarea,select,[role="textbox"]')||(target instanceof HTMLElement&&target.isContentEditable)))return;
   event.preventDefault();
   if(!event.repeat)shortcutUndo.current();
  };
  window.addEventListener('keydown',onKey);
  return()=>window.removeEventListener('keydown',onKey);
 },[]);
 useEffect(()=>{const el=captionRef.current;if(el&&logFollowing.current)el.scrollTop=el.scrollHeight;},[conversation,livePhase]);

 useEffect(()=>{
  refreshCompanions();
  const changed=(event:StorageEvent)=>{if(event.key===COMPANION_KEY||event.key===null){refreshCompanions();setCompanionUndo(null);}};
  window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
 },[]);

 function companionMessage(cause:unknown){
  const zh=languageRef.current==='zh',reason=cause instanceof CompanionError?cause.reason:'unavailable';
  const messages:Record<string,[string,string]>={
   invalid:['这个名字或伙伴暂时不能保存，原来的伙伴还在。','This name or companion could not be saved. Your saved friends are safe.'],
   blocked:['这个名字不合适，换一个名字吧。','Please choose another name for this friend.'],
   full:['伙伴的小家已经满了，先腾一点位置吧。','There is no room for another friend yet.'],
   'too-large':['这个伙伴暂时太大，没能存下来。','This friend is too detailed to keep just now.'],
   unavailable:['暂时存不下伙伴，之前的伙伴还在。','Your browser could not save this friend. Your previous friends are safe.'],
   changed:['伙伴在另一个页面更新了，请再试一次。','Your companions changed in another tab. Please try again.'],
   'duplicate-name':['已经有伙伴叫这个名字了，再想一个名字吧。','A friend already has this name. Try another name.'],
   'duplicate-id':['这个伙伴已经记住了。','This friend is already remembered.'],
   'missing-object':['请先画出伙伴，再告诉我它的名字。','Draw your friend first, then tell me their name.'],
   'no-room':['这张纸有点挤，换张纸再邀请伙伴吧。','This page is a little full. Try inviting your friend onto a new page.'],
  };
  return (messages[reason]??messages.unavailable)[zh?0:1];
 }
 function refreshCompanions(){
  setCompanionUndo(null);
  try{const next=loadCompanions(localStorage);companionsRef.current=next;companionsLocked.current=false;setCompanions(next.entries);setCompanionError('');}
  catch(cause){companionsLocked.current=true;setCompanionError(companionMessage(cause));}
 }
 function persistCompanions(entries:Companion[]){
  if(companionsLocked.current)throw new CompanionError('unavailable');
  const next=storeCompanions(localStorage,entries,companionsRef.current.raw);
  companionsRef.current=next;setCompanions(next.entries);setCompanionError('');
 }
 function focusCompanion(id:string|null){activeCompanionRef.current=id;setActiveCompanion(id);}
 function showCompanionFailure(cause:unknown){
  const message=companionMessage(cause);setCompanionError(message);setNotice(message);
  if(cause instanceof CompanionError&&cause.reason==='changed')refreshCompanions();
 }
 function refreshCompanionCandidates(){
  const source=sceneRef.current,measured=measureCanvasContext(document.querySelector<SVGSVGElement>('svg#main-artwork'),sceneForModel(source),'');
  // A streamed preview may be ahead of the committed scene. Keep the last
  // matching targets until the confirmed geometry is rendered, never invent
  // a page-sized target or silently select a background.
  if(!measured){
   const eligibleIds=new Set(source.objects.filter(isCompanionCandidate).map(object=>object.id));
   const retained=companionCandidatesRef.current.filter(candidate=>eligibleIds.has(candidate.id));
   companionCandidatesRef.current=retained;setCompanionCandidates(retained);return retained;
  }
  const next:CompanionPickCandidate[]=getScenePaintOrder(source).filter(isCompanionCandidate).flatMap((object,index)=>{
   const bounds=measured.objects.find(item=>item.id===object.id)?.bounds;
   if(!bounds||bounds[2]<=0||bounds[3]<=0)return [];
   return [{id:object.id,label:object.label??(languageRef.current==='zh'?`画中角色 ${index+1}`:`Character ${index+1}`),bounds:{x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]},scene:{...source,sky:'paper',ground:'none',weather:'clear',objects:[object]}}];
  });
  companionCandidatesRef.current=next;setCompanionCandidates(next);return next;
 }
 function cancelCompanionPick(){companionPickEpoch.current++;setCompanionPicking(false);setPickInitialId(null);}
 function chooseCompanionOnCanvas(){
  if(!canPickCompanion)return;
  cancelCompanionPick();setCompanionsOpen(false);setToolsOpen(false);setHandTool('move');
  setNotice(languageRef.current==='zh'?'点选画里的角色，再点它旁边的「留下伙伴」。':'Select a character, then choose Keep companion beside them.');
 }
 function beginCompanionPick(objectId:string){
  if(!canPickCompanion||busy||painting)return;
  const object=sceneRef.current.objects.find(item=>item.id===objectId);
  if(!object||!isCompanionCandidate(object))return;
  const candidates=refreshCompanionCandidates();
  if(!candidates.some(item=>item.id===objectId))return;
  setCompanionError('');setCompanionNotice('');setCompanionsOpen(false);setToolsOpen(false);
  setPickInitialId(objectId);companionPickEpoch.current++;setCompanionPicking(true);
 }
 function showCompanionShelf(){cancelCompanionPick();setCompanionsOpen(true);}
 useEffect(()=>{if(companionPicking)refreshCompanionCandidates();},[companionPicking,history,cursor,viewport,modelThinking]);
 async function savePickedCompanion(objectId:string,name:string):Promise<boolean>{
  if(modelThinking||!companionPicking)return false;
  const object=sceneRef.current.objects.find(item=>item.id===objectId);
  if(!object||!isCompanionCandidate(object)){setCompanionError(languageRef.current==='zh'?'这个角色刚刚变了，请重新点选。':'This character has changed. Please choose them again.');return false;}
  const pickEpoch=companionPickEpoch.current;
  const canCommit=()=>companionPickEpoch.current===pickEpoch&&!batchPending.current&&!queueRef.current?.snapshot().painting;
  return keepCompanion(objectId,name,languageRef.current==='zh'?`它叫${name}。`:`Their name is ${name}.`,undefined,canCommit);
 }
 async function keepCompanion(objectId:string,name:string,phrase:string,signal?:AbortSignal,canCommit?:()=>boolean):Promise<boolean>{
  if(companionSavePending.current||(canCommit&&!canCommit()))return false;
  companionSavePending.current=true;
  const source=sceneRef.current,epoch=operation.current;
  try{
   const normalized=normalizeCompanionName(name),old=companionsRef.current.entries.find(entry=>entry.name.toLocaleLowerCase('en')===normalized.toLocaleLowerCase('en'));
   if(old&&namedCompanionObject(source,old)?.id===objectId){focusCompanion(old.id);setNotice(languageRef.current==='zh'?`${old.name}已经记住啦。`:`${old.name} is already remembered.`);return true;}
   const measure=()=>measureCanvasContext(document.querySelector<SVGSVGElement>('svg#main-artwork'),sceneForModel(source),'')?.objects.find(item=>item.id===objectId)?.bounds;
   let bounds=measure();
   if(!bounds){
    // A model commit can be followed by a naming clause before React paints it.
    // Wait at most one frame, never for the drawing animation or another model.
    await new Promise<void>(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timeout);cancelAnimationFrame(frame);resolve();};const frame=requestAnimationFrame(finish),timeout=setTimeout(finish,48);});
    bounds=measure();
   }
   if(signal?.aborted||operation.current!==epoch||sceneRef.current!==source)return false;
   if(canCommit&&!canCommit()){
    setCompanionError(languageRef.current==='zh'?'新的一笔正在接上，稍后再点保存就好。':'The next drawing is arriving. Try saving again in a moment.');
    return false;
   }
   if(!bounds||bounds[2]<=0||bounds[3]<=0)throw new CompanionError('missing-object');
   const entry=createCompanion(source,objectId,normalized,style,{x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]},crypto.randomUUID());
   persistCompanions(addCompanion(companionsRef.current.entries,entry));setCompanionUndo(null);focusCompanion(entry.id);
   const object=source.objects.find(item=>item.id===objectId)!;
   // Labels are scene metadata, not lettering in the artwork. The next request
   // sees this name and the same geometry through the existing scene context.
   commit({...source,objects:source.objects.map(item=>item.id===objectId?{...item,label:namedObjectLabel(entry.name,object)}:item)},phrase,'');
   const message=languageRef.current==='zh'?`${entry.name}记住啦，下次说名字就能一起冒险。`:`${entry.name} is remembered. Say their name in your next story.`;
   setCompanionNotice(message);setNotice(message);setCompanionError('');return true;
  }catch(cause){showCompanionFailure(cause);return false;}
  finally{companionSavePending.current=false;}
 }
 function forgetCompanion(id:string){
  if(isBusy()||painting||companionSavePending.current)return;
  try{const previous=companionsRef.current.entries;persistCompanions(removeCompanion(previous,id));setCompanionUndo(previous);if(activeCompanionRef.current===id)focusCompanion(null);setCompanionNotice(languageRef.current==='zh'?'伙伴已移出，可以撤销。':'Companion removed. You can undo this.');}
  catch(cause){showCompanionFailure(cause);}
 }
 function changeCompanionName(id:string,name:string,previousName:string):boolean{
  // The existing shelf is read-only while a voice/drawing turn is active.
  // Do not cancel, pause or rebase any in-flight model work to rename a friend.
  if(isBusy()||painting||companionSavePending.current||companionsLocked.current)return false;
  try{
   const previous=companionsRef.current.entries.find(entry=>entry.id===id);
   if(!previous||previous.name!==previousName)throw new CompanionError('changed');
   const entries=renameCompanion(companionsRef.current.entries,id,name),renamed=entries.find(entry=>entry.id===id)!;
   const current=timeline.current;
   const renamedHistory=current.history.map(entry=>{
    const next=renameCompanionInScene(entry.scene,previous,renamed);
    return next===entry.scene?entry:{...entry,scene:next};
   });
   persistCompanions(entries);
   setCompanionUndo(null);
   replaceTimeline(renamedHistory,current.cursor);
   setCompanionNotice(languageRef.current==='zh'?`名字改成${renamed.name}啦，下次可以这样叫它。`:`Now called ${renamed.name}. Use this name in your next story.`);
   return true;
  }catch(cause){showCompanionFailure(cause);return false;}
 }
 function undoForgetCompanion(){
  if(!companionUndo||isBusy()||painting)return;
  try{persistCompanions(companionUndo);setCompanionUndo(null);setCompanionNotice('');}catch(cause){showCompanionFailure(cause);}
 }
 function inviteCompanion(id:string){
  if(isBusy()||painting)return;
  const entry=companionsRef.current.entries.find(item=>item.id===id);if(!entry)return;
  const phrase=languageRef.current==='zh'?`让${entry.name}来这里。`:`Bring ${entry.name} here.`;
  setCompanionsOpen(false);void imagine(phrase);
 }
 function requestCompanionSpark(){const present=companionsRef.current.entries.filter(entry=>namedCompanionObject(sceneRef.current,entry));if(present.length===1)focusCompanion(present[0].id);setCompanionSpark(value=>value+1);}

 function tryLookahead(){
  const snapshot=modelPreview.current, queue=queueRef.current;
  if(!snapshot||!queue||lookahead.current.occupied||!isCurrent(snapshot.operation)||previewOwner.current?.token!==snapshot.token)return;
  const next=queue.peekNext();
  if(!next||!canLookAhead(next.text)||!snapshot.layout.length)return;
  if(shouldDeferCompanionLookahead(next.text,companionsRef.current.entries,snapshot.scene))return;
  if(!queue.reserveNext(next.id))return;
  lookahead.current.start(next.text,snapshot,async(text,context,signal,onPreview)=>{
   return requestImagine({text,language:languageRef.current,scene:context.scene,recent:context.recent,mode:'live',lookahead:{reservations:context.layout,instruction:context.instruction}},{signal,expectedScene:context.scene,onPreview});
  });
 }
 async function paint(phrase:string,id:number,signal:AbortSignal,live=false,transcriptTargets:TranscriptTarget[]=[],typedEntryId?:string){
  const t=timeline.current;
  let baseScene:Scene={...sceneRef.current,paper:viewportRef.current};
  if(!signal.aborted&&isCurrent(id)){
   const naming=parseCompanionSave(phrase);
   if(naming){
    lookahead.current.cancel();setQuestion(null);setTurnFeedback('');
    const subject=companionSubject(sceneRef.current,objectSelection?.id??null,lastSubjectIds.current,naming.target);
    if(subject)await keepCompanion(subject.id,naming.name,phrase,signal);
    else{const message=languageRef.current==='zh'?'你想给哪位伙伴起名字？点选画里的它，再点旁边的「留下伙伴」。':'Which friend would you like to name? Select them, then choose Keep companion beside them.';setNotice(message);setCompanionNotice(message);}
    return;
   }
   if(parseCompanionRemember(phrase)){
    lookahead.current.cancel();setQuestion(null);setTurnFeedback('');
    const entry=companionsRef.current.entries.find(item=>item.id===activeCompanionRef.current);
    setNotice(entry&&namedCompanionObject(sceneRef.current,entry)?(languageRef.current==='zh'?`${entry.name}已经记住啦。`:`${entry.name} is already remembered.`):(languageRef.current==='zh'?'先告诉我伙伴的名字，比如「它叫豆豆」。':'Tell me your friend’s name first, for example “His name is Coco”.'));
    return;
   }
   if(parseCompanionIdeaRequest(phrase)){lookahead.current.cancel();setQuestion(null);setTurnFeedback('');requestCompanionSpark();return;}
   try{
    const recalled=prepareCompanionRecall(phrase,baseScene,companionsRef.current.entries,viewportRef.current);
    if(recalled){
     focusCompanion(recalled.entry.id);
     if(recalled.pure){
      lookahead.current.cancel();setQuestion(null);setTurnFeedback('');
      if(recalled.added){setPlaybackTurn(++paintSequence.current);commit(recalled.scene,phrase,'');}
      return;
     }
     baseScene=recalled.scene;
    }
   }catch(cause){showCompanionFailure(cause);return;}
  }
  const question=clarificationRef.current;
  const inputVersion=turnGate.current.version;
  // A clarification belongs to the next request only. The model can use an answer
  // or follow an independent new idea; retired ideas never enter committed history.
  setQuestion(null);setTurnFeedback('');
  const modelScene=sceneForModel(baseScene);
  const recent=t.history.slice(0,t.cursor+1).filter(e=>paperIdFor(e)===activePaperRef.current).slice(-5).map(e=>e.phrase.slice(0,600));
  if(previewOwner.current)rollbackPreview();
  const token=++paintSequence.current;setPlaybackTurn(token);
  previewOwner.current={token,operation:id};
  // Track first contact separately from model activity. The next request uses
  // the committed scene (including pigment still being drawn), without waiting
  // for either painter. Only model commits are serialized to avoid stale edits.
  waitingPaintToken.current=token;setAwaitingFirstStroke(true);
  const ownsPreview=()=>isCurrent(id)&&previewOwner.current?.token===token&&!signal.aborted;
  const previews=new PreviewBuffer<Scene>(preview=>{if(ownsPreview()){setScene(preserveErasures(baseScene,preview));}});
  const onPlanning=(preview:Scene,layout?:DrawingLayout)=>{
   if(ownsPreview()&&live&&layout?.length){modelPreview.current={scene:preview,layout,instruction:phrase,recent,token,operation:id};tryLookahead();}
  };
  const onPreview=(preview:Scene,layout?:DrawingLayout)=>{
   if(!ownsPreview())return;
   previews.offer(preview);
   onPlanning(preview,layout);
  };
  try{
   if(!configuredRef.current)throw new DrawingFailure('画笔还在等待连接。','service');
   const canvasContext=measureCanvasContext(document.querySelector<SVGSVGElement>('svg#main-artwork'),modelScene,question?`${question.instruction} ${phrase}`:phrase);
   let result=live&&!question?await lookahead.current.take(phrase,modelScene,signal,onPreview,onPlanning):null;
   if(!result){
   if(signal.aborted)throw new DOMException('已取消这一笔。','AbortError');
   result=await requestImagine({text:phrase.trim(),language:languageRef.current,scene:modelScene,...(canvasContext?{canvasContext}:{}),recent,...(question?{clarification:question}:{}),...(live?{mode:'live'}:{})},{signal,expectedScene:modelScene,onPreview});
   }
   if(!ownsPreview())return;
   if(result.action&&result.action!=='update')lookahead.current.cancel();
   if(result.action==='ignore'){
    // Ignore has no previews: leave any earlier valid stroke animation running.
    previewOwner.current=null;setScene(sceneRef.current);resetBrushPreparation();setQuestion(null);
    // Ignore only the exact submitted spans; newer words keep their positions.
    const cleaned=typedEntryId?conversationRef.current.filter(entry=>entry.id!==typedEntryId):omitVoiceRanges(conversationRef.current,transcriptIndex.current.validTargets(transcriptTargets));
    updateConversation(cleaned);
    if(result.message===CONTENT_BLOCKED_MESSAGE)setBlockedNotice(value=>value+1);
    else if(turnGate.current.isCurrent(inputVersion)&&!speechDraft.current)setTurnFeedback('我在听，接着说你想画什么吧。');
   }
   else if(result.action==='undo'){const moved=moveHistory(-1,false);if(!moved)rollbackPreview();setNotice(moved?result.message:'这张纸还没有可以撤销的笔触。');}
   else if(result.action==='clarify'){rollbackPreview();setQuestion({instruction:phrase.slice(0,600),question:result.message},turnGate.current.isCurrent(inputVersion)&&!speechDraft.current);}
   else {commit(preserveErasures(baseScene,result.scene),phrase,result.message);setQuestion(null);}
  }catch(cause){
   let failure=cause;
   if(ownsPreview()){
    // Cancel speculation based on the failed parent, not the next speech itself.
    // The queue will prepare that next idea again from committed artwork.
    previews.dispose();lookahead.current.cancel();
    if(cause instanceof Error&&cause.name==='AbortError')rollbackPreview();
    else{
     const rolledBack=rollbackDrawingTurn(sceneRef.current,conversationRef.current,transcriptIndex.current.validTargets(transcriptTargets),typedEntryId);
     previewOwner.current=null;setScene(rolledBack.scene);resetBrushPreparation();
     updateConversation(rolledBack.conversation);setQuestion(null);
     failure=new RolledBackDrawingFailure(ROLLED_BACK_DRAWING_MESSAGE,drawingFailureKind(cause));
     if(turnGate.current.isCurrent(inputVersion)&&!speechDraft.current)setTurnFeedback(ROLLED_BACK_DRAWING_MESSAGE);
    }
   }
   throw failure;
  }
  finally{previews.dispose();if(modelPreview.current?.token===token)modelPreview.current=null;if(waitingPaintToken.current===token)resetBrushPreparation();}
 }
 async function imagine(phrase:string){
  if(!phrase.trim()||!mounted.current||isBusy())return;
  if(inspectText(phrase).blocked){setBlockedNotice(value=>value+1);return;}
  dismissInspiration();
  if(previewOwner.current)rollbackPreview();
  const id=++operation.current;
  turnGate.current.advance();speechDraft.current=false;retireTurnNotice();
  batchPending.current=true;setBatchPainting(true);setError('');setNotice('');
  const typedEntryId=crypto.randomUUID();
  updateConversation(appendTextEntry(conversationRef.current,phrase,typedEntryId));logFollowing.current=true;
  const controller=new AbortController();batchAbort.current=controller;
  try{await paint(phrase,id,controller.signal,false,[],typedEntryId);}
  catch(e){if(isCurrent(id)&&!(e instanceof RolledBackDrawingFailure)&&drawingFailureKind(e)==='service')setError(e instanceof Error?e.message:'画笔连接暂时断开了。听到的文字已经保留。');}
  finally{if(isCurrent(id)){batchPending.current=false;batchAbort.current=null;setBatchPainting(false);}}
 }
 async function finishRecording(){
  const rec=recording.current;
  if(!rec||!['recording','uploading'].includes(phaseRef.current))return;
  const id=operation.current;
  setPhase('finishing');stopClock();brushCompanion.current?.reset();
  const handlers=liveHandlers.current;
  try{const final=await rec.stop();if(isCurrent(id)&&handlers?.id===id)handlers.onUpdate(final);}
  catch(e){if(isCurrent(id)&&handlers?.id===id)handlers.onError(e instanceof Error?e:new Error('最后一句没有听清，已经画好的内容仍然保留。'));}
  finally{if(isCurrent(id)&&recording.current===rec)recording.current=null;}
 }
 stopRef.current=()=>{void finishRecording();};
 async function startLive(file?:File){
  if(isInputBusy()||!mounted.current)return;
  cancelCompanionPick();inspirationOnset.current.reset();
  transformControls.current?.cancelGesture();freehandControls.current?.cancelGesture();
  if(previewOwner.current)rollbackPreview();
  // Keep service-held work across mic sessions. Reopening the mic is input, not a
  // paid retry, and stale callbacks from the previous capture are aborted.
  const heldQueue=queueRef.current?.snapshot().paused?queueRef.current:null;
  if(!heldQueue){lookahead.current.cancel();modelPreview.current=null;}
  const id=heldQueue?operation.current:++operation.current;
  liveAbort.current?.abort();
  const controller=new AbortController();liveAbort.current=controller;
  turnGate.current.beginSession();speechDraft.current=false;
  resetBrushPreparation();
  setPhase('requesting');setAsrCatchingUp(false);setError('');setNotice('');setSeconds(0);setStableCaption('');setPartialCaption('');setActiveMicrophoneLabel('');setLiveQueue(heldQueue?.snapshot()??EMPTY_PAINT_QUEUE);logFollowing.current=true;voiceSessionRef.current=undefined;
  const gate=new StreamUpdateGate();
  const notifiedBlockedSegments=new Set<string>();
  const queue=heldQueue??new LivePaintingQueue((phrase,signal,segments)=>paint(phrase,id,signal,true,transcriptIndex.current.targets(segments)),next=>{
   if(!isCurrent(id))return;
   setLiveQueue(next);
   tryLookahead();
   if(phaseRef.current==='draining'&&!next.painting&&(!next.pendingCount||next.paused))setPhase('off');
  },{maxSegmentsPerTurn:1});
  queueRef.current=queue;
  const onUpdate=(update:StreamingUpdate)=>{
   if(!isCurrent(id)||controller.signal.aborted)return;
   if(!gate.accept(update))return;
   speechDraft.current=!!update.partial.trim();
   if(turnGate.current.observe(update.stableText,update.partial)){dismissInspiration();retireTurnNotice();}
   transcriptIndex.current.observe(update);
   voiceSessionRef.current=update.sessionId;
   const screened=filterVoiceTranscript(conversationRef.current,update,transcriptIndex.current);
   updateConversation(screened.conversation);
   if(screened.blocked.some(segment=>!notifiedBlockedSegments.has(segment.id)))setBlockedNotice(value=>value+1);
   for(const segment of screened.blocked)notifiedBlockedSegments.add(segment.id);
   setAsrReady(true);setStableCaption(screened.conversation.find(entry=>entry.sessionId===update.sessionId)?.text??'');setPartialCaption(screened.partial);
   if(update.done){stopClock();setPhase('draining');recording.current=null;}
   queue.add(screened.allowed);
   if(update.done){const q=queue.snapshot();if(!q.painting&&(!q.pendingCount||q.paused)){setPhase('off');if(!update.stableText.trim())setNotice('这次没有听到说话声。再试一次吧。');}}
  };
  const onError=(cause:Error)=>{
   if(!isCurrent(id)||controller.signal.aborted||!gate.fail())return;
   keepVoiceDraft();
   stopClock();setPhase('off');recording.current=null;resetBrushPreparation();
   const rawMessage=cause.message||'语音连接暂时断开了。';
   const engineUnavailable=cause instanceof TypeError||/语音.*(?:连接|连上)|还没连上|连上本机|本机识别等待太久|超时|failed to fetch|networkerror/i.test(rawMessage);
   setError(engineUnavailable?'语音服务暂时离线，请稍后再试。':rawMessage);
   if(engineUnavailable){setAsrReady(false);asrLastReady.current=null;}
  };
  liveHandlers.current={id,onUpdate,onError};
  try{
   // Reuse a recent health check, otherwise check in parallel with permission
   // and device startup. Audio capture still only begins after the child's tap.
   const recent=asrLastReady.current;
   const connectionPromise=(recent&&Date.now()-recent.at<30000?Promise.resolve(recent.status):refreshAsrConnection(controller.signal)).then(connection=>{
    if(!connection.ready)throw new Error(connection.message);
    return connection;
   });
   const options={language:languageRef.current,onUpdate,onError,onBacklog:(value:boolean)=>{if(isCurrent(id)&&!controller.signal.aborted)setAsrCatchingUp(value);},onCaptureStopped:()=>{if(isCurrent(id)&&!controller.signal.aborted){stopClock();setPhase('finishing');}},onLevel:(level:number)=>{if(isCurrent(id)&&!controller.signal.aborted){brushCompanion.current?.setLevel(level);if(inspirationOnset.current.observe(level,performance.now()))dismissInspiration();}},signal:controller.signal,deviceId:microphoneChoiceRef.current,onMicrophone:(device:{deviceId:string;label:string})=>{if(isCurrent(id)&&!controller.signal.aborted){setActiveMicrophoneLabel(device.label);void refreshMicrophones();}}};
   const capturePromise=file?startStreamingFile(file,options):startStreamingRecording(options);
   let rec:StreamingHandle;
   try{[rec]=await Promise.all([capturePromise,connectionPromise]);}
   catch(cause){void capturePromise.then(handle=>handle.cancel(),()=>{});throw cause;}
   if(!isCurrent(id)||controller.signal.aborted){rec.cancel();return;}
   void rec.done.then(onUpdate,cause=>onError(cause instanceof Error?cause:new Error('语音连接暂时断开了。')));
   if(gate.ended)return;
   recording.current=rec;setPhase(file?'uploading':'recording');
   const started=Date.now();timer.current=setInterval(()=>{if(!isCurrent(id))return;const elapsed=Math.floor((Date.now()-started)/1000);setSeconds(elapsed);if(elapsed>=600)stopRef.current();},250);
  }catch(cause){onError(cause instanceof Error?cause:new Error('暂时无法打开语音，请查看麦克风设置后再试一次。'));}
 }
 function cancelLive(){
  keepVoiceDraft();dismissTurnNotice();
  operation.current++;liveAbort.current?.abort();liveAbort.current=null;recording.current?.cancel();recording.current=null;liveHandlers.current=null;queueRef.current?.cancel();lookahead.current.cancel();modelPreview.current=null;queueRef.current=null;rollbackPreview();stopClock();setPhase('off');setLiveQueue(EMPTY_PAINT_QUEUE);setError('');setNotice('已取消，未完成的这一笔已撤回。之前的画和字幕都保留。');
 }
 function cancelCurrent(){
  if(!batchPending.current){cancelLive();return;}
  dismissTurnNotice();operation.current++;batchAbort.current?.abort();batchAbort.current=null;batchPending.current=false;setBatchPainting(false);rollbackPreview();setError('');setNotice('这一笔已取消，回到之前的画面。');
 }
 async function microphone(){if(['recording','uploading'].includes(phaseRef.current))await finishRecording();else if(!isInputBusy())await startLive();}
 function upload(file:File|undefined){if(fileRef.current)fileRef.current.value='';if(file&&!isInputBusy())void startLive(file);}
 function example(phrase:string){if(isBusy())return;if(configuredRef.current)void imagine(phrase);else setError('画笔还在准备，稍后再试试这个想法。');}
 async function retryPainting(){
  const id=operation.current;
  if(!configuredRef.current){
   try{const response=await fetch(studioApi('/api/status'));const next=await response.json() as {configured:boolean};if(!isCurrent(id))return;configuredRef.current=!!next.configured;setConfigured(!!next.configured);}
   catch{if(isCurrent(id))setError('画笔暂时还没有连上，待画文字仍然保留。');return;}
  }
  if(isCurrent(id))queueRef.current?.retry();
 }
 async function copyUnfinished(){const q=queueRef.current?.snapshot();const value=[q?.failedText,q?.pendingText].filter(Boolean).join('\n')||partialCaption||stableCaption;try{await navigator.clipboard.writeText(value);setNotice('没画完的话已经复制好了。');}catch{setNotice('可以选中下方保留的文字进行复制。');}}
 async function download(){
  const svg=document.getElementById('main-artwork');if(!svg)return;const clone=svg.cloneNode(true) as SVGElement;removePlaybackArtifacts(clone);const size=artworkExportSize(clone.getAttribute('viewBox'));clone.setAttribute('width',String(size.width));clone.setAttribute('height',String(size.height));try{await embedDrawingFont(clone);}catch{setError('手写字体暂时没能载入，请稍后再保存。');return;}const raw=new XMLSerializer().serializeToString(clone);const blob=new Blob([raw],{type:'image/svg+xml;charset=utf-8'});const url=URL.createObjectURL(blob);
  try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d');if(!ctx)throw new Error();ctx.drawImage(img,0,0,size.width,size.height);const png=await new Promise<Blob|null>(r=>canvas.toBlob(r,'image/png'));if(!png)throw new Error();const out=URL.createObjectURL(png);const a=document.createElement('a');a.href=out;a.download=`${brand}-${t(scene.title)}-${t(STYLE_LABELS[style])}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(out),2000);setSaved(true);setTimeout(()=>setSaved(false),2500);}catch{setError('图片暂时没能保存，请稍后再试。');}finally{URL.revokeObjectURL(url);}
 }
 async function capturePicture():Promise<PictureBookDraft>{
  if(isBusy()||painting)throw new Error(language==='zh'?'等这一笔画完，再收进画册。':'Let this stroke finish before saving.');
  const artwork=document.getElementById('main-artwork');if(!artwork)throw new Error('Canvas unavailable');
  const scene=cloneScene(sceneRef.current),words=JSON.parse(JSON.stringify(conversationRef.current)) as ConversationEntry[];
  const clone=removePlaybackArtifacts(artwork.cloneNode(true) as SVGElement);
  const full=artworkExportSize(clone.getAttribute('viewBox')),ratio=Math.min(320/full.width,240/full.height,1);
  const width=Math.max(1,Math.round(full.width*ratio)),height=Math.max(1,Math.round(full.height*ratio));
  clone.setAttribute('width',String(width));clone.setAttribute('height',String(height));
  if(clone.querySelector('text'))await embedDrawingFont(clone);
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}));
  try{
   const image=new Image();image.src=url;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const context=canvas.getContext('2d');if(!context)throw new Error('Canvas unavailable');
   context.fillStyle='#fbf2df';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
   return{scene,style,conversation:words,thumbnail:canvas.toDataURL('image/png')};
  }finally{URL.revokeObjectURL(url);}
 }
 function openPicture(entry:PictureBookEntry){
  if(isBusy()||painting)return;
  freehandControls.current?.cancelGesture();transformControls.current?.cancelGesture();operation.current++;
  paperConversationsRef.current.set(activePaperRef.current,conversationRef.current);activePaperRef.current=crypto.randomUUID();
  cancelCompanionPick();inspirationOnset.current.reset();companionCandidatesRef.current=[];setCompanionCandidates([]);
  lastSubjectIds.current=[];focusCompanion(null);setCompanionSpark(0);
  transcriptIndex.current.reset();voiceSessionRef.current=undefined;setStableCaption('');setPartialCaption('');logFollowing.current=true;
  commit(cloneScene(entry.scene),language==='zh'?'从小画册继续':'Continue from picturebook','',true,entry.style);
  updateConversation(JSON.parse(JSON.stringify(entry.conversation)));dismissTurnNotice();setError('');setNotice('');setBlockedNotice(0);
 }
 async function toggleSound(){
  if(sound){await audioRef.current?.close();audioRef.current=null;setSound(false);return;}
  try{const ctx=new AudioContext();audioRef.current=ctx;const buffer=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate);const data=buffer.getChannelData(0);let last=0;for(let i=0;i<data.length;i++){last=(last+Math.random()*.04-.02)/1.02;data[i]=last*3;}const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=600;const gain=ctx.createGain();gain.gain.value=.16;source.connect(filter).connect(gain).connect(ctx.destination);source.start();await ctx.resume();setSound(true);}catch{setNotice('环境声暂时无法播放。');}
 }
 function newPaper(next:Scene,phrase:string,message:string,nextStyle=style){
  if(isBusy())return;
  freehandControls.current?.cancelGesture();transformControls.current?.cancelGesture();operation.current++;
  paperConversationsRef.current.set(activePaperRef.current,conversationRef.current);activePaperRef.current=crypto.randomUUID();
  cancelCompanionPick();inspirationOnset.current.reset();companionCandidatesRef.current=[];setCompanionCandidates([]);
  lastSubjectIds.current=[];focusCompanion(null);setCompanionSpark(0);
  transcriptIndex.current.reset();voiceSessionRef.current=undefined;setStableCaption('');setPartialCaption('');logFollowing.current=true;
  commit({...next,paper:viewportRef.current},phrase,message,false,nextStyle);updateConversation([]);dismissTurnNotice();setError('');setNotice('');setBlockedNotice(0);setResetConfirm(false);
 }
 function blank(){newPaper({title:'轻轻画',sky:'paper',weather:'clear',ground:'none',objects:[]},'换一张空白纸','这张纸，装得下任何想象。');}
 function reset(){newPaper(cloneScene(INITIAL_SCENE),'重新从湖边开始','新的一页，慢慢来。');}
 function chooseStyle(value:ArtStyle){
  if(!hydrated||isBusy()||painting||value===style)return;
  newPaper({title:'轻轻画',sky:'paper',weather:'clear',ground:'none',objects:[]},`换一张${t(STYLE_LABELS[value])}画纸`,'这张纸，装得下任何想象。',value);
 }

 const voiceControls=<VoiceControls state={voiceState} catchingUp={asrCatchingUp} seconds={seconds} disabled={(!audioActive&&inputBusy)||configured===null} shortcutEnabled={hydrated&&!help&&!resetConfirm&&!pictureBookOpen&&!theatreOpen&&!companionsOpen&&!companionPicking} canCancel={liveBusy||batchPainting} onToggle={()=>void microphone()} onCancel={cancelCurrent} brushState={companionState} motionMode={motionPreference}/>;
 return <div className="app-shell experimental-studio">
  <header className="topbar">
   <div className="studio-brand-nav"><a href={studioPage("/")} className="brand" aria-label={t("{brand} 首页",{brand})}><Feather size={21}/><span>{brand}</span></a><StudioLibraryNav language={language} onCompanions={showCompanionShelf} onPicturebook={()=>{cancelCompanionPick();setPictureBookOpen(true);}}/></div>
   <div className="style-switcher" role="group" aria-label={t("选择画风")}>{(['crayon','pencil','watercolor'] as ArtStyle[]).map(value=><button key={value} className={style===value?'selected':''} onClick={()=>chooseStyle(value)} disabled={!hydrated||busy||painting} title={style===value?t('当前画风'):t('换一张{style}空白纸',{style:t(STYLE_LABELS[value])})} aria-pressed={style===value}><i className={`pen-dot ${value}`}/>{t(STYLE_LABELS[value])}</button>)}</div>
   {<select className="studio-style-select" aria-label={t('选择画风')} value={style} disabled={!hydrated||busy||painting} onChange={event=>chooseStyle(event.target.value as ArtStyle)}>{(['crayon','pencil','watercolor'] as ArtStyle[]).map(value=><option key={value} value={value}>{t(STYLE_LABELS[value])}</option>)}</select>}
   <div className="studio-header-actions">
    <select className="studio-language-select" aria-label={language==='zh'?'语言':'Language'} value={language} disabled={busy||painting} onChange={event=>setLanguage(event.target.value==='zh'?'zh':'en')}><option value="en">English</option><option value="zh">简体中文</option></select>
    <button className="studio-settings-link" aria-label={t('画室设置')} onClick={()=>setHelp(true)}><Settings size={16}/><span>{language==='zh'?'设置':'Settings'}</span></button>
   </div>
  </header>
  <main className="studio" aria-label={t("画布与语音输入")}>
   <div className="canvas-toolbar"><div className="canvas-heading">{!['一切都可以从这里开始','轻轻画'].includes(scene.title)&&<h1>{t(scene.title)}</h1>}{motionPreference==='system'&&reducedMotion?<button className="enable-drawing" onClick={()=>chooseMotionPreference('draw')}>{t("开启逐笔绘画")}</button>:null}</div><div className="canvas-tools"><button onClick={undo} disabled={busy||cursor===0} aria-label={t("撤销上一笔")} aria-keyshortcuts="Control+Z Meta+Z" title={t("撤销（Ctrl+Z / ⌘Z）")}><Undo2 size={18}/></button><button onClick={redo} disabled={busy||cursor===history.length-1} aria-label={t("重做")} title={t("重做")}><Redo2 size={18}/></button><button className="paper-action" onClick={()=>setResetConfirm(true)} disabled={busy} aria-label={t("重新开始")} title={t("换一张纸")}><RotateCcw size={18}/><span>{t("换纸")}</span></button><button className="save-button" onClick={()=>void download()} disabled={painting} aria-label={t("收好这幅画")} title={t("保存图片")}>{saved?<Check size={17}/>:<ArrowDownToLine size={18}/>}<span>{t(saved?'已保存':'保存')}</span></button></div></div>
   <div className="workspace-row">
   <div className="canvas-stage">
    <ManualToolbox open={toolsOpen} triggerRef={toolsTrigger} onToggle={()=>toolsOpen?closeTools():setToolsOpen(true)} tool={handTool} color={penColor} size={penWidth} disabled={busy||painting||help||resetConfirm||pictureBookOpen||theatreOpen||companionsOpen||companionPicking} onToolChange={chooseHandTool} onColorChange={color=>{setPenColor(color);setHandTool('pen');}} onSizeChange={setPenWidth} eraserShape={eraserShape} onEraserShapeChange={setEraserShape} onClose={closeTools} selection={objectSelection} revealSelectionActions onObjectAction={objectAction}/>
    <div ref={paperFrame} onPointerDownCapture={event=>{if(!(event.target instanceof Element)||!event.target.closest('.paper-inspiration'))dismissInspiration();}} className={`art-frame ${painting?'is-painting':''}`}><SceneCanvas scene={scene} confirmedScene={sceneRef.current} viewport={viewport} style={style} id="main-artwork" className="artwork" playbackResetKey={playbackResetKey} onDrawingChange={handleDrawingChange} motionMode={motionPreference} playbackTurn={playbackTurn} soundEnabled={false} modelPending={modelThinking} animatePose={scene!==manualPoseScene.current}/><FreehandLayer scene={sceneRef.current} viewport={viewport} tool={handTool==='move'?'none':handTool} color={penColor} width={penWidth} eraserShape={eraserShape} reducedMotion={motionPreference==='still'||(motionPreference==='system'&&reducedMotion)} disabled={!hydrated||busy||painting||pictureBookOpen||theatreOpen||companionsOpen||companionPicking} controlsRef={freehandControls} onCommit={commitHandDrawing} onError={setError} onPreview={next=>{setScene(next??sceneRef.current);if(next)resetPlayback();}}/><ObjectTransformLayer scene={sceneRef.current} viewport={viewport} enabled={hydrated&&handTool==='move'&&!busy&&!painting&&!help&&!resetConfirm&&!pictureBookOpen&&!theatreOpen&&!companionsOpen&&!companionPicking} controlsRef={transformControls} onCommit={commitObjectEdit} onSelectionChange={handleObjectSelection} canKeepCompanion={isCompanionCandidate} onKeepCompanion={beginCompanionPick}/><>{<CompanionCanvasPicker selectionFirst active={companionPicking} language={language} candidates={companionCandidates} viewport={viewport} initialObjectId={pickInitialId} disabled={modelThinking||companionsLocked.current} onCancel={cancelCompanionPick} onSave={savePickedCompanion} error={companionError}/>}</>{<PaperInspiration visible={inspirationVisible} language={language} companionName={inspirationCompanion} reducedMotion={motionPreference==='still'||reducedMotion} onDismiss={dismissInspiration}/>}<PaperResponse ref={brushCompanion} state={companionState} medium={style} reducedMotion={motionPreference==='still'||(motionPreference==='system'&&reducedMotion)}/></div>
    <DrawingSpeedChoice quick={quickDrawing} disabled={!hydrated||busy||painting} onChange={changeDrawingSpeed}/>
    <div className="stage-notices">
     {!!blockedNotice&&<DrawingTurnNotice message={CONTENT_BLOCKED_MESSAGE} onDismiss={()=>setBlockedNotice(0)}/>}
     {!serviceError&&<DrawingTurnNotice message={clarification?.question||(turnFeedback===ROLLED_BACK_DRAWING_MESSAGE?'这一句没画出来，再说一次试试吧。':turnFeedback)} onDismiss={dismissTurnNotice}/>}
     {(serviceError||notice)&&<div className={`feedback ${serviceError?'error':''}`} role={serviceError?'alert':'status'}><span>{t(serviceError||notice)}</span>{serviceError&&<button className="feedback-help" onClick={()=>setHelp(true)}>{t("查看设置")}</button>}{(error||!liveQueue.paused)&&<button onClick={()=>{setError('');setNotice('');}} aria-label={t("关闭提示")}><X size={14}/></button>}</div>}
    </div>
    {handTool==='eraser'&&!busy&&!painting&&<div className="hand-drawing-hint">{t("按住拖动，划到哪里擦哪里")}</div>}
   </div>
   <aside className="conversation-panel" aria-label={t("说过的话")}>
    <div className="conversation-heading"><h2><MessageCircle size={15}/>{t("说过的话")}</h2><button onClick={()=>void copyConversation()} disabled={!visibleConversation.length} aria-label={t("复制所有文字记录")}>{t("复制")}</button></div>
    {hydrated&&researchTextNoticeVisible()&&<p style={{fontSize:11,lineHeight:1.5,color:'#737e67',padding:'0 16px',margin:'8px 0'}}>{language==='zh'?'实验模式：识别文字会记录用于调试，不保存录音。':'Experiment: recognized words are logged for debugging. This site does not save audio.'}</p>}
    <div className="conversation-log" ref={captionRef} role="log" aria-live="polite" aria-relevant="additions text" onScroll={event=>{const el=event.currentTarget;logFollowing.current=el.scrollHeight-el.scrollTop-el.clientHeight<45;}}>
     {visibleConversation.map((entry,index)=><article className="conversation-entry" key={entry.id} data-entry-id={entry.id}><div className="entry-label">{entry.kind==='voice'?<Mic size={11}/>:<Keyboard size={11}/>}<span>{entry.id.startsWith('legacy:')?t('之前'):t(entry.kind==='voice'?'说的第 {n} 段':'写的第 {n} 段',{n:index+1})}</span>{entry.status==='listening'&&<i className="live-dot"/>}</div><p>{entry.text}<span className="partial-caption">{entry.partial}</span>{entry.status==='listening'&&<i className="caption-caret" aria-hidden="true"/>}</p>{entry.status==='unconfirmed'&&entry.partial&&<small>{t("最后这几个字还没确认，也替你留着。")}</small>}</article>)}
     {audioActive&&!partialCaption&&!visibleConversation.some(entry=>entry.sessionId===voiceSessionRef.current&&entry.text.trim())&&<p className="listening-placeholder"><span className="live-dot"/>{t("正在听你的新想法…")}</p>}
    </div>
    {(drawingSaveError||conversationSaveError||liveQueue.paused)&&<div className={`conversation-footer ${conversationSaveError||drawingSaveError?'save-warning':''}`} role="status">{t(drawingSaveError||conversationSaveError||'画笔暂时没连上，文字已保留')}</div>}
    {liveQueue.paused&&<div className="pending-paint"><div className="pending-words">{[liveQueue.failedText,liveQueue.pendingText].filter(Boolean).join('\n')}</div><div className="pending-actions"><button onClick={()=>void retryPainting()}>{t("恢复画笔")}</button><button onClick={()=>void copyUnfinished()}>{t("复制待画文字")}</button><button onClick={cancelLive}>{t("取消待画内容")}</button></div></div>}
   </aside>
   </div>
  {voiceControls}
   {companionSpark>0&&<CompanionSpark key={companionSpark} initialIndex={companionSpark-1} name={companions.find(entry=>entry.id===activeCompanion)?.name??null} language={language} onClose={()=>setCompanionSpark(0)}/>}
   <input ref={fileRef} type="file" accept="audio/*" aria-label={t("选择音频文件")} className="sr-only" onChange={e=>upload(e.target.files?.[0])}/>
   <div className="studio-status"><button onClick={()=>setHelp(true)} title={activeMicrophoneLabel||t('麦克风与连接设置')}><span className={asrReady?'ready':''}/>{audioActive?(livePhase==='uploading'?t('音频输入'):activeMicrophoneLabel||t('录音中')):t(selectedMicrophone==='system'?'麦克风跟随系统':'已选定麦克风')}</button></div>
  </main>
  {<CompanionShelf open={companionsOpen} language={language} entries={companions} canPick={canPickCompanion} disabled={!hydrated||busy||painting||companionsLocked.current} onClose={()=>setCompanionsOpen(false)} onRecall={inviteCompanion} onRemove={forgetCompanion} onRename={changeCompanionName} onUndoRemove={companionUndo?undoForgetCompanion:undefined} onPickFromCanvas={chooseCompanionOnCanvas} error={companionError} notice={companionNotice}/>}
  {<><PictureBook open={pictureBookOpen} language={language} disabled={!hydrated||busy||painting} onClose={()=>setPictureBookOpen(false)} onCapture={capturePicture} onOpen={openPicture} onTheatre={()=>{if(isBusy()||painting)return;setPictureBookOpen(false);setTheatreOpen(true);}}/><StoryTheatre open={theatreOpen} language={language} onClose={()=>setTheatreOpen(false)}/></>}
  {(help||resetConfirm)&&<div className="modal-backdrop" onClick={()=>{setHelp(false);setResetConfirm(false);}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={()=>{setHelp(false);setResetConfirm(false);}} aria-label={t("关闭")}><X size={20}/></button><h2 id="modal-title">{t(resetConfirm?'换一张纸':'画室设置')}</h2>{resetConfirm?<><p>{t("新纸会清空这里的画和文字，可以撤销回来。")}</p><button className="primary-button" onClick={blank}>{t("空白纸")}</button><button className="secondary-button" onClick={reset}>{t("湖边小屋")}</button></>:<>
   {CHINESE_UI_ENABLED&&<section className="settings-section language-settings"><h3><label htmlFor="studio-language">{t('语言')}</label></h3><select id="studio-language" value={language} disabled={busy||painting} onChange={event=>setLanguage(event.target.value==='zh'?'zh':'en')}><option value="en" lang="en">English</option><option value="zh" lang="zh-CN">简体中文</option></select></section>}
   <section className="settings-section"><h3>{t("麦克风")}</h3><div className="microphone-picker-row"><label htmlFor="microphone-device" className="sr-only">{t("录音麦克风")}</label><select id="microphone-device" value={selectedMicrophone} disabled={microphoneLocked} onChange={event=>chooseMicrophone(event.target.value)} aria-describedby="microphone-device-hint"><option value="system">{t("跟随系统当前麦克风")}</option><option value="computer">{t("电脑内置麦克风")}</option>{selectedMicrophoneMissing&&<option value={selectedMicrophone} disabled>{savedMicrophoneLabel||t('上次选择的麦克风')}{t("（不可用）")}</option>}{microphoneDevices.map((device,index)=><option key={device.deviceId||`unknown-${index}`} value={device.deviceId||`unknown-${index}`} disabled={!device.label||!device.deviceId}>{device.label||t('未显示名称的设备 {n}',{n:index+1})}</option>)}</select><button className="refresh-microphones" onClick={()=>void refreshMicrophones()} disabled={microphoneRefreshing} aria-label={t("刷新麦克风设备")} title={t("刷新设备列表")}><RefreshCw size={15} className={microphoneRefreshing?'spin':''}/></button></div><p id="microphone-device-hint" className="setting-note">{livePhase==='recording'&&activeMicrophoneLabel?t('正在使用：{device}。停止后可切换。',{device:activeMicrophoneLabel}):t(microphoneHint)}</p></section>
   <section className="settings-section"><h3>{t("语音连接")}<span className={asrReady?'connection-ready':''}>{t(asrConnectionLabel)}</span><button className="check-connection" onClick={()=>void refreshAsrConnection().catch(()=>{})} disabled={asrChecking} aria-label={t("重新检查语音连接")}><RefreshCw size={12} className={asrChecking?'spin':''}/>{t("重新检查")}</button></h3>{asrConnection&&!asrReady&&<p className="connection-message" role="status">{t(asrConnection.message)}</p>}<p>{t("语音通过 OpenRouter 在云端识别，想法由 AI 画出来。本站不保存录音，画作和文字保存在你的浏览器中。")}</p></section>
   <section className="settings-section"><h3>{t("绘画过程")}</h3><div className="motion-options" role="group" aria-label={t("绘画过程")}>{([['system','跟随系统'],['draw','逐笔绘画'],['still','直接显示']] as const).map(([value,label])=><button key={value} aria-pressed={motionPreference===value} className={motionPreference===value?'selected':''} onClick={()=>chooseMotionPreference(value)}>{t(label)}</button>)}</div></section>
   <section className="settings-section"><h3>{t("边说边画")}</h3><p>{t("保持麦克风开启，可以连续说很多句。句间稍停，画笔就会跟上，不用反复开关。每次最多 5 分钟，全部说完后再点方块停止。")}</p><div className="examples">{examples.map(phrase=><button key={phrase} disabled={busy} onClick={()=>{setHelp(false);example(t(phrase));}}>{t(phrase)}</button>)}</div></section>
   {<a className="studio-examples-help" href={studioPage('/examples')} aria-disabled={busy||painting} tabIndex={busy||painting?-1:0} onClick={event=>{if(busy||painting)event.preventDefault();}}>{language==='zh'?'看看怎样一边说、一边画':'See talking & drawing in action'} →</a>}
   <details className="brand-story"><summary>{t('名字的小故事')}</summary><p>{t('灵感来自《爱丽丝漫游奇境》：让对话和图画，一起打开想象的世界。')}</p><a href="https://www.gutenberg.org/files/928/928-h/928-h.htm" target="_blank" rel="noopener noreferrer">{t('读一读原著')} ↗</a></details>
   <button className={`ambient ${sound?'active':''}`} onClick={()=>void toggleSound()} aria-pressed={sound}>{sound?<Volume2 size={17}/>:<VolumeX size={17}/>}<span>{t("湖边白噪音")}</span><span>{t(sound?'已开启':'已关闭')}</span></button>
   <button className="audio-upload-setting" onClick={()=>{setHelp(false);fileRef.current?.click();}} disabled={inputBusy}><Upload size={15}/>{t("上传一段声音")}</button><p className="privacy-note">{t("文字记录和画面保存在当前浏览器，可撤销最近 30 次修改。本站不保存录音。")}</p>
  </>}</section></div>}
 </div>;
}
