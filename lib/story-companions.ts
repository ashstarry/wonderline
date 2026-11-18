import { z } from 'zod';
import type { ArtStyle, ErasureStroke, Scene, SceneObject } from './scene';
import { erasureStrokeSchema, paperViewportSchema, sceneObjectSchema, sceneSchema } from './scene-validation';
import { legacyErasureKey, objectMarkKeys } from './eraser';
import { inspectText } from './content-filter';
import { localToPaper } from './object-pose';
import type { PaperViewport } from './paper-viewport';

export const COMPANION_KEY = 'wonderline-companions-v1';
export const COMPANION_LIMIT = 8;
export const COMPANION_NAME_LIMIT = 24;
export const COMPANION_MAX_BYTES = 2 * 1024 * 1024;
export type CompanionBounds = { x: number; y: number; width: number; height: number };
export type Companion = { id: string; name: string; createdAt: number; style: ArtStyle; object: SceneObject; erasures: ErasureStroke[]; bounds: CompanionBounds };
export type CompanionFailure = 'invalid' | 'blocked' | 'full' | 'too-large' | 'unavailable' | 'changed' | 'duplicate-name' | 'duplicate-id' | 'missing-object' | 'no-room';
export class CompanionError extends Error {
  constructor(public readonly reason: CompanionFailure) { super(`Companion: ${reason}`); this.name = 'CompanionError'; }
}

export function normalizeCompanionName(name: string): string {
  if (typeof name !== 'string') throw new CompanionError('invalid');
  const normalized = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (inspectText(normalized).blocked) throw new CompanionError('blocked');
  if (!normalized || normalized.length > COMPANION_NAME_LIMIT || !/^[\p{L}\p{N}\p{M} .’'-]+$/u.test(normalized) || !/[\p{L}\p{N}]/u.test(normalized)) throw new CompanionError('invalid');
  return normalized;
}
const nameKey = (name: string) => normalizeCompanionName(name).toLocaleLowerCase('en');
const objectKeys = (object: SceneObject) => new Set([...objectMarkKeys(object), ...(object.kind === 'drawing' ? [] : [legacyErasureKey(object)])]);
const entrySchema = z.object({
  id: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/), name: z.string().max(COMPANION_NAME_LIMIT).refine(name => {
    try { return normalizeCompanionName(name) === name; } catch { return false; }
  }),
  createdAt: z.number().finite().nonnegative().max(8.64e15), style: z.enum(['crayon', 'pencil', 'watercolor']),
  object: sceneObjectSchema, erasures: z.array(erasureStrokeSchema).max(200), bounds: paperViewportSchema,
}).strict().superRefine((entry, ctx) => {
  const keys = objectKeys(entry.object);
  if (entry.erasures.some(stroke => stroke.targets.some(target => !keys.has(target.key)))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Unrelated erasure target' });
  if (!sceneSchema.safeParse({ title: entry.name, sky: 'paper', weather: 'clear', ground: 'none', objects: [entry.object], erasures: entry.erasures }).success) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid companion scene' });
});
const collectionSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema).max(COMPANION_LIMIT)
  .refine(entries => new Set(entries.map(entry => entry.id)).size === entries.length)
  .refine(entries => new Set(entries.map(entry => entry.name.toLocaleLowerCase('en'))).size === entries.length),
}).strict();

function checkedCompanion(entry: Companion): Companion {
  const checked = entrySchema.safeParse(entry);
  if (!checked.success) throw new CompanionError('invalid');
  return checked.data as Companion;
}

export function readCompanions(raw: string | null): Companion[] | null {
  if (raw === null) return [];
  if (!raw || raw.length * 2 > COMPANION_MAX_BYTES) return null;
  try { const parsed = collectionSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data.entries as Companion[] : null; } catch { return null; }
}
export function serializeCompanions(entries: Companion[]): string {
  if (entries.length > COMPANION_LIMIT) throw new CompanionError('full');
  const checked = collectionSchema.safeParse({ version: 1, entries });
  if (!checked.success) throw new CompanionError('invalid');
  const raw = JSON.stringify(checked.data);
  if (raw.length * 2 > COMPANION_MAX_BYTES) throw new CompanionError('too-large');
  return raw;
}
export type CompanionStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type CompanionState = { entries: Companion[]; raw: string | null };
export function loadCompanions(storage: CompanionStorage): CompanionState {
  let raw: string | null;
  try { raw = storage.getItem(COMPANION_KEY); } catch { throw new CompanionError('unavailable'); }
  const entries = readCompanions(raw);
  if (!entries) throw new CompanionError('invalid');
  return { entries, raw };
}
/** Same single-key optimistic concurrency as the picture book; never evict or replace a stale snapshot. */
export function storeCompanions(storage: CompanionStorage, entries: Companion[], expectedRaw: string | null): CompanionState {
  if (readCompanions(expectedRaw) === null) throw new CompanionError('invalid');
  const raw = serializeCompanions(entries);
  try {
    if (storage.getItem(COMPANION_KEY) !== expectedRaw) throw new CompanionError('changed');
    storage.setItem(COMPANION_KEY, raw);
  } catch (error) { if (error instanceof CompanionError) throw error; throw new CompanionError('unavailable'); }
  return { entries: readCompanions(raw)!, raw };
}
export function addCompanion(entries: Companion[], entry: Companion): Companion[] {
  const checked = checkedCompanion(entry);
  if (entries.some(previous => previous.id === checked.id)) throw new CompanionError('duplicate-id');
  if (entries.some(previous => nameKey(previous.name) === nameKey(checked.name))) throw new CompanionError('duplicate-name');
  return readCompanions(serializeCompanions([checked, ...entries]))!;
}
export function removeCompanion(entries: Companion[], id: string): Companion[] {
  return readCompanions(serializeCompanions(entries.filter(entry => entry.id !== id)))!;
}

/** Change the child's name for a saved friend without replacing their identity
 * or artwork. Existing name validation and storage concurrency still apply. */
export function renameCompanion(entries: Companion[], id: string, name: string): Companion[] {
  const previous = entries.find(entry => entry.id === id);
  if (!previous) throw new CompanionError('changed');
  const normalized = normalizeCompanionName(name);
  if (entries.some(entry => entry.id !== id && nameKey(entry.name) === nameKey(normalized))) throw new CompanionError('duplicate-name');
  if (previous.name === normalized) return entries;
  const next = entries.map(entry => entry.id === id ? { ...entry, name: normalized,
    object: renameCompanionLabel(entry.object, previous.name, normalized),
  } : entry);
  serializeCompanions(next);
  return next;
}

/** Labels are metadata, never new lettering or drawing marks. */
export function renameCompanionLabel(object: SceneObject, previousName: string, nextName: string): SceneObject {
  const label = object.label;
  if (!label) return object;
  const normalized = label.normalize('NFKC'), key = normalized.toLocaleLowerCase('en');
  const previous = previousName.normalize('NFKC').toLocaleLowerCase('en');
  if (key !== previous && !key.startsWith(`${previous} · `)) return object;
  const descriptor = key === previous ? undefined : normalized.slice(previousName.normalize('NFKC').length + 3);
  return { ...object, label: namedObjectLabel(nextName, descriptor) };
}

/** The DOM supplies the actual current geometry bounds, not a model's estimate. */
export function createCompanion(scene: Scene, objectId: string, name: string, style: ArtStyle, bounds: CompanionBounds, id: string, now = Date.now()): Companion {
  if (!sceneSchema.safeParse(scene).success) throw new CompanionError('invalid');
  const object = scene.objects.find(item => item.id === objectId);
  if (!object) throw new CompanionError('missing-object');
  const keys = objectKeys(object);
  return checkedCompanion({ id, name: normalizeCompanionName(name), createdAt: now, style, object, bounds,
    erasures: (scene.erasures ?? []).flatMap(stroke => {
      const targets = stroke.targets.filter(target => keys.has(target.key));
      return targets.length ? [{ ...stroke, targets }] : [];
    }),
  });
}
export function companionObjectId(entry: Companion | string): string {
  const id = typeof entry === 'string' ? entry : entry.id;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new CompanionError('invalid');
  return `companion-${id}`;
}
export function namedObjectLabel(name: string, original: SceneObject | string | undefined): string {
  const normalized = normalizeCompanionName(name);
  const label = typeof original === 'string' ? original : original?.label || original?.kind;
  if (!label || label === normalized || label.startsWith(`${normalized} · `)) return (label || normalized).slice(0, 40);
  return `${normalized} · ${label}`.slice(0, 40).replace(/[\uD800-\uDBFF]$/, '');
}

/** Rebase only mask coordinate space, not its local shape. Transforming paths,
 * widths and their original frames together leaves every erased hole identical. */
function masksOnPaper(erasures: ErasureStroke[], paper: PaperViewport): ErasureStroke[] {
  const points = erasures.flatMap(stroke => stroke.paths.flatMap(path => [...path.matchAll(/[ML]([-+\d.]+) ([-+\d.]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }))));
  if (!points.length) return erasures;
  const inside = (point: {x:number;y:number}) => point.x >= paper.x && point.x <= paper.x + paper.width && point.y >= paper.y && point.y <= paper.y + paper.height;
  if (points.every(inside)) return erasures;
  const minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const q = Math.min(1, paper.width * .96 / Math.max(1, maxX - minX), paper.height * .96 / Math.max(1, maxY - minY));
  const tx = paper.x + (paper.width - (maxX - minX) * q) / 2 - minX * q;
  const ty = paper.y + (paper.height - (maxY - minY) * q) / 2 - minY * q;
  const mapped = erasures.map(stroke => ({ ...stroke, width: stroke.width * q,
    paths: stroke.paths.map(path => path.replace(/([ML])([-+\d.]+) ([-+\d.]+)/g, (_, command: string, x: string, y: string) => `${command}${(Number(x) * q + tx).toFixed(6)} ${(Number(y) * q + ty).toFixed(6)}`)),
    targets: stroke.targets.map(target => ({ ...target, x: target.x * q + tx, y: target.y * q + ty, scale: target.scale * q })),
  }));
  if (mapped.some(stroke => !erasureStrokeSchema.safeParse(stroke).success)) throw new CompanionError('no-room');
  return mapped;
}

export function companionScene(entry: Companion): Scene {
  const checked = checkedCompanion(entry);
  // Thumbnail paper can be small; masks retain their saved coordinate space.
  // A larger invisible paper is unnecessary because the renderer receives this
  // viewport separately; thumbnail scene itself deliberately has no paper.
  return { title: checked.name, sky: 'paper', weather: 'clear', ground: 'none', objects: [checked.object], erasures: checked.erasures };
}

/** Conservative geometry envelope used only to choose a less crowded new slot.
 * It never claims exact visual contact and never moves existing artwork. */
function approximateBounds(object: SceneObject): CompanionBounds {
  const points: {x:number;y:number}[] = [];
  const add = (x: number, y: number) => points.push(localToPaper({ x, y }, object));
  const addBox = (left:number,top:number,right:number,bottom:number) => { add(left,top);add(left,bottom);add(right,top);add(right,bottom); };
  for (const mark of object.marks ?? []) {
    if (mark.type === 'path') {
      const tokens = mark.d!.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
      const counts: Record<string, number> = { M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0 };
      let i=0, command='M', x=0, y=0, startX=0, startY=0;
      while (i<tokens.length) {
        if (/^[A-Za-z]$/.test(tokens[i])) command=tokens[i++];
        const upper=command.toUpperCase(), relative=command!==upper, count=counts[upper];
        if (!count) { if (upper==='Z') {x=startX;y=startY;add(x,y);} continue; }
        const nums=tokens.slice(i,i+count).map(Number); i+=count;
        if (nums.length!==count || nums.some(n=>!Number.isFinite(n))) break;
        const ox=relative?x:0,oy=relative?y:0;
        if (upper==='H') { x=nums[0]+ox; add(x,y); }
        else if (upper==='V') { y=nums[0]+oy; add(x,y); }
        else if (upper==='A') { const endX=nums[5]+ox,endY=nums[6]+oy,radius=Math.max(nums[0],nums[1]); addBox(Math.min(x,endX)-radius,Math.min(y,endY)-radius,Math.max(x,endX)+radius,Math.max(y,endY)+radius); x=endX;y=endY; }
        else { for(let n=0;n<count;n+=2)add(nums[n]+ox,nums[n+1]+oy); x=nums[count-2]+ox;y=nums[count-1]+oy; }
        if(upper==='M'){startX=x;startY=y;command=relative?'l':'L';}
      }
    } else if (mark.type==='line') { add(mark.x!,mark.y!);add(mark.x2!,mark.y2!); }
    else if (mark.type==='ellipse') addBox(mark.x!-mark.w!/2,mark.y!-mark.h!/2,mark.x!+mark.w!/2,mark.y!+mark.h!/2);
    else addBox(mark.x!,mark.y!,mark.x!+(mark.w??40),mark.y!+(mark.h??20));
  }
  if(object.kind!=='drawing'||!points.length)addBox(-85,-130,85,20);
  const x=Math.min(...points.map(point=>point.x)),y=Math.min(...points.map(point=>point.y));
  return {x,y,width:Math.max(...points.map(point=>point.x))-x,height:Math.max(...points.map(point=>point.y))-y};
}
const overlap = (a:CompanionBounds,b:CompanionBounds) => Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));

export function placeCompanion(scene: Scene, entry: Companion, viewport: PaperViewport): { scene: Scene; objectId: string; added: boolean } {
  const checked = checkedCompanion(entry), objectId = companionObjectId(checked);
  if (!sceneSchema.safeParse(scene).success || !paperViewportSchema.safeParse(viewport).success) throw new CompanionError('invalid');
  if (scene.objects.some(object => object.id === objectId)) return { scene, objectId, added: false };
  if (scene.objects.length >= 40 || scene.objects.reduce((sum, object) => sum + (object.marks?.length ?? 0), 0) + (checked.object.marks?.length ?? 0) > 450) throw new CompanionError('full');
  const paper=scene.paper??viewport,b=checked.bounds,source=checked.object;
  const ratio=Math.min(paper.width*.28/b.width,paper.height*.32/b.height);
  const scale=Math.max(.2,Math.min(3.5,source.scale*ratio)),factor=scale/source.scale;
  const width=b.width*factor,height=b.height*factor,margin=Math.min(paper.width,paper.height)*.04;
  if(width>paper.width-margin*2||height>paper.height-margin*2)throw new CompanionError('no-room');
  const occupied=scene.objects.map(approximateBounds);
  const candidates: CompanionBounds[]=[];
  for(const [fx,fy] of [[.5,.6],[.25,.6],[.75,.6],[.5,.3],[.25,.3],[.75,.3],[.5,.82],[.2,.82],[.8,.82]]) {
    candidates.push({x:Math.max(paper.x+margin,Math.min(paper.x+paper.width-margin-width,paper.x+paper.width*fx-width/2)),y:Math.max(paper.y+margin,Math.min(paper.y+paper.height-margin-height,paper.y+paper.height*fy-height/2)),width,height});
  }
  const scored=candidates.map((box,index)=>({box,index,score:occupied.reduce((sum,other)=>sum+overlap(box,other),0)}));
  scored.sort((a,b)=>a.score-b.score||a.index-b.index);
  const slot=scored[0].box;
  const {stackRank:_savedRank,...unranked}=source;
  const object: SceneObject={...unranked,id:objectId,label:namedObjectLabel(checked.name,source),x:slot.x+(source.x-b.x)*factor,y:slot.y+(source.y-b.y)*factor,scale};
  const oldKeys=[...objectKeys(source)],newKeys=[...objectKeys(object)],keys=new Map(oldKeys.map((key,index)=>[key,newKeys[index]]));
  const existingErasureIds=new Set(scene.erasures?.map(stroke=>stroke.id));
  const erasures=checked.erasures.map((stroke,index)=>{
    const base=`companion-${checked.id}-e${index}`;let id=base,n=0;
    while(existingErasureIds.has(id))id=`${base}-${++n}`;
    existingErasureIds.add(id);
    return {...stroke,id,targets:stroke.targets.map(target=>({...target,key:keys.get(target.key)!}))};
  });
  const next: Scene={...scene,objects:[...scene.objects,object],...(erasures.length?{erasures:[...(scene.erasures??[]),...masksOnPaper(erasures,paper)]}:{})};
  if(!sceneSchema.safeParse(next).success)throw new CompanionError('no-room');
  return {scene:next,objectId,added:true};
}
