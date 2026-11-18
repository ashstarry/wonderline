import type { DrawingMark, ErasureStroke, ErasureTarget, Scene, SceneObject } from './scene';
import { handStrokePaths, type HandPoint } from './freehand';
import { ERASURE_LIMITS, sceneSchema } from './scene-validation';

export { ERASURE_LIMITS };

const canonicalMark = (mark: DrawingMark, object: SceneObject): string => JSON.stringify(
  Object.fromEntries(Object.entries({ ...mark, ...(mark.type !== 'line' && mark.fill === undefined ? { fill: object.color } : {}) })
    .filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
);

/** Two independent 32-bit hashes keep long path data out of persisted target names. */
function hash(value: string): string {
  let left = 0x811c9dc5, right = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}

/** Keys follow unchanged marks through insertion/reordering; an identical new stroke gets its own occurrence. */
export function objectMarkKeys(object: SceneObject): string[] {
  const occurrences = new Map<string, number>();
  return (object.marks ?? []).map(mark => {
    const signature = hash(canonicalMark(mark, object));
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    return `mark:${object.id}:${signature}:${occurrence}`;
  });
}

export function legacyErasureKey(object: SceneObject): string {
  return `legacy:${object.id}:${object.kind}:${object.color.slice(1).toLowerCase()}`;
}

export function backgroundErasureKey(scene: Scene, layer: 'sky' | 'ground' | 'weather'): string {
  // Style changes keep the same paper and holes. Replacing a background creates fresh paint.
  const appearance = layer === 'sky' ? `${scene.sky}:${scene.ground === 'none' ? 'full' : 'upper'}`
    : layer === 'ground' ? `${scene.ground}:${scene.sky === 'night' ? 'night' : 'day'}` : scene.weather;
  return `background:${layer}:${appearance}`;
}

export function collectErasureTargets(scene: Scene): ErasureTarget[] {
  const targets: ErasureTarget[] = (['sky', 'ground', 'weather'] as const).map(layer => ({ key: backgroundErasureKey(scene, layer), x: 0, y: 0, scale: 1 }));
  for (const object of scene.objects) {
    const transform = { x: object.x, y: object.y, scale: object.scale, ...(object.rotation === undefined ? {} : {rotation:object.rotation}) };
    if (object.kind !== 'drawing') targets.push({ key: legacyErasureKey(object), ...transform });
    for (const key of objectMarkKeys(object)) targets.push({ key, ...transform });
  }
  return targets;
}

/** A gesture adds a local vector mask; it never deletes or rewrites any underlying drawing. */
export function appendErasure(scene: Scene, points: readonly HandPoint[], width: number, id: string, targets = collectErasureTargets(scene), shape: 'round' | 'square' = 'round'): Scene {
  if (!Number.isFinite(width) || width < 1 || width > ERASURE_LIMITS.width) throw new Error('请重新选一下橡皮的大小。');
  if (!targets.length) return scene;
  const stroke: ErasureStroke = { id, paths: handStrokePaths(points, scene.paper), width, targets, ...(shape === 'square' ? {shape} : {}) };
  const next: Scene = { ...scene, erasures: [...(scene.erasures ?? []), stroke] };
  if (!sceneSchema.safeParse(next).success) throw new Error('这张纸上的修改已经很多啦。这次擦除没有保存，可以先撤销一次再继续。');
  return next;
}

/** Only paint present at erase time is masked; fresh AI/manual geometry draws over previous holes. */
export function preserveErasures(base: Scene, next: Scene): Scene {
  const keys = new Set(collectErasureTargets(next).map(target => target.key));
  const erasures = (base.erasures ?? []).flatMap(stroke => {
    const targets = stroke.targets.filter(target => keys.has(target.key));
    return targets.length ? [{ ...stroke, targets }] : [];
  });
  const { erasures: _ignored, ...scene } = next;
  return erasures.length ? { ...scene, erasures } : scene;
}

/** Eraser metadata stays local; the model receives the ordinary editable scene geometry. */
export function sceneForModel(scene: Scene): Scene {
  const { erasures: _ignored, ...modelScene } = scene;
  return modelScene;
}
