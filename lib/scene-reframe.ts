import type { Scene, SceneObject } from './scene';
import type { ObjectPose } from './object-pose';
import type { CanvasGeometryContext } from './canvas-context';

const pigment = (o: SceneObject) => JSON.stringify([o.kind, o.color, o.label ?? null, o.marks ?? null]);
export type PoseChange = { before: ObjectPose; after: ObjectPose };
/** Reparenting promoted art changes SVG ancestry, but never its existing ink. */
export function depthOnlyChanges(before: Scene, after: Scene): Set<string> {
  const changes = new Set<string>();
  if (JSON.stringify(before.erasures ?? []) !== JSON.stringify(after.erasures ?? [])) return changes;
  for (const object of after.objects) {
    const old = before.objects.find(item => item.id === object.id);
    if (!old || old.stackRank === object.stackRank || pigment(old) !== pigment(object)) continue;
    if (old.x === object.x && old.y === object.y && old.scale === object.scale && (old.rotation ?? 0) === (object.rotation ?? 0)) changes.add(object.id);
  }
  return changes;
}
/** A transform is safe to animate only when the actual pigment and masks match. */
export function poseOnlyChanges(before: Scene, after: Scene): Map<string, PoseChange> {
  const changes = new Map<string, PoseChange>();
  if (JSON.stringify(before.erasures ?? []) !== JSON.stringify(after.erasures ?? [])) return changes;
  for (const object of after.objects) {
    const old = before.objects.find(item => item.id === object.id);
    if (!old || pigment(old) !== pigment(object)) continue;
    if (old.x !== object.x || old.y !== object.y || old.scale !== object.scale || (old.rotation ?? 0) !== (object.rotation ?? 0)) changes.set(object.id, { before: old, after: object });
  }
  return changes;
}
/** World-space delta: before * inverse(after), for a wrapper around final art. */
export function poseDelta(before: ObjectPose, after: ObjectPose) {
  const r = before.scale / after.scale, a = ((before.rotation ?? 0) - (after.rotation ?? 0)) * Math.PI / 180;
  const c = Math.cos(a) * r, s = Math.sin(a) * r;
  return [c, s, -s, c, before.x - c * after.x + s * after.y, before.y - s * after.x - c * after.y];
}

/** Local, deliberately opt-in experiment. Treat related old art as one group,
 * leave its marks/order/holes intact, and reserve a readable lower foreground.
 * This proposes geometry only; it never guesses who the story's protagonist is. */
export function makeForegroundRoom(scene: Scene, geometry: CanvasGeometryContext): Scene | null {
  const paper = scene.paper ?? { x: 0, y: 0, width: 1000, height: 640 };
  if (!scene.objects.length || scene.ground !== 'none' || scene.objects.some(o => o.id.startsWith('hand-'))) return null;
  const boxes = scene.objects.map(o => geometry.objects.find(item => item.id === o.id)?.bounds);
  if (boxes.some(box => !box || !box.every(Number.isFinite))) return null;
  const b = boxes as [number, number, number, number][];
  const left = Math.min(...b.map(v=>v[0])), top = Math.min(...b.map(v=>v[1]));
  const width = Math.max(...b.map(v=>v[0]+v[2])) - left, height = Math.max(...b.map(v=>v[1]+v[3])) - top;
  if (width < paper.width * .6 || height < paper.height * .48 || top + height < paper.y + paper.height * .68) return null;
  const ratio = Math.min(.82, paper.width * .74 / width, paper.height * .43 / height);
  if (ratio < .55 || scene.objects.some(o=>o.scale * ratio < .2)) return null;
  const x = paper.x + (paper.width - width * ratio) / 2;
  const y = paper.y + paper.height * .08;
  return { ...scene, objects: scene.objects.map(o=>({ ...o, x: x + (o.x-left)*ratio, y: y + (o.y-top)*ratio, scale: o.scale*ratio })) };
}
