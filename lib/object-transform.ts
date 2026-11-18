import type { Scene } from './scene';
import { preserveErasures } from './eraser';
import type { PaperViewport } from './paper-viewport';

export type Point = { x: number; y: number };
export type ObjectBox = { x: number; y: number; width: number; height: number };
import { localToPaper, paperToLocal, type ObjectPose } from './object-pose';
export type { ObjectPose } from './object-pose';
const orientation = (pose: ObjectPose) => pose.rotation === undefined ? {} : { rotation: pose.rotation };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

export function moveObject(object: ObjectPose, box: ObjectBox, delta: Point, paper: PaperViewport): ObjectPose {
  // Already clipped artwork can still move inward without jumping on pickup.
  const dx = clamp(delta.x, Math.min(0, paper.x - box.x), Math.max(0, paper.x + paper.width - box.x - box.width));
  const dy = clamp(delta.y, Math.min(0, paper.y - box.y), Math.max(0, paper.y + paper.height - box.y - box.height));
  return { x: round(clamp(object.x + dx, -10000, 10000)), y: round(clamp(object.y + dy, -10000, 10000)), scale: object.scale, ...orientation(object) };
}

/** Uniform resize, anchored at the measured top-left corner. No deformation. */
export function resizeObject(object: ObjectPose, box: ObjectBox, delta: Point, paper: PaperViewport): ObjectPose {
  const length = box.width ** 2 + box.height ** 2;
  const requested = length > 0 ? 1 + (delta.x * box.width + delta.y * box.height) / length : 1;
  const edgeLimit = Math.min((paper.x + paper.width - box.x) / Math.max(1, box.width), (paper.y + paper.height - box.y) / Math.max(1, box.height));
  const ratio = clamp(requested, .2 / object.scale, Math.min(3.5 / object.scale, Math.max(1, edgeLimit)));
  return { x: round(box.x + (object.x - box.x) * ratio), y: round(box.y + (object.y - box.y) * ratio), scale: round(object.scale * ratio), ...orientation(object) };
}

export function transformedBox(box: ObjectBox, before: ObjectPose, after: ObjectPose): ObjectBox {
  const corners = [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]]
    .map(([x,y]) => localToPaper(paperToLocal({x,y},before),after));
  const xs=corners.map(p=>p.x), ys=corners.map(p=>p.y), x=Math.min(...xs), y=Math.min(...ys);
  return {x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};
}

/** Turn around the visible centre, including drawings whose origin is (0,0). */
export function rotateObject(object: ObjectPose, box: ObjectBox, degrees: number, paper: PaperViewport): ObjectPose {
  if (!Number.isFinite(degrees)) return object;
  const center={x:box.x+box.width/2,y:box.y+box.height/2};
  const anchor=localToPaper({x:object.x-center.x,y:object.y-center.y},{...center,scale:1,rotation:degrees});
  const rotation=round((((object.rotation??0)+degrees+180)%360+360)%360-180);
  const pose={x:round(anchor.x),y:round(anchor.y),scale:object.scale,rotation};
  const rotated=transformedBox(box,object,pose);
  // Nudge inward only when the rotated object fits. Never shrink or distort it.
  const dx=rotated.width<=paper.width?clamp(0,paper.x-rotated.x,paper.x+paper.width-rotated.x-rotated.width):0;
  const dy=rotated.height<=paper.height?clamp(0,paper.y-rotated.y,paper.y+paper.height-rotated.y-rotated.height):0;
  return {...pose,x:round(pose.x+dx),y:round(pose.y+dy)};
}

export function commitObjectPose(scene: Scene, id: string, pose: ObjectPose): Scene {
  if (![pose.x, pose.y, pose.scale, pose.rotation ?? 0].every(Number.isFinite) || Math.abs(pose.rotation ?? 0) > 180 || pose.scale < .2 || pose.scale > 3.5 || Math.abs(pose.x) > 10000 || Math.abs(pose.y) > 10000) return scene;
  const object = scene.objects.find(item => item.id === id);
  if (!object || (object.x === pose.x && object.y === pose.y && object.scale === pose.scale && (object.rotation ?? 0) === (pose.rotation ?? object.rotation ?? 0))) return scene;
  // Keep stable IDs, marks, layer order and original erasure frames. Existing
  // masks are object-local, so the holes travel with the pigment naturally.
  return { ...scene, objects: scene.objects.map(item => item.id === id ? { ...item, ...pose } : item) };
}

/** Remove one object and only its erase targets. History retains the original. */
export function removeObject(scene: Scene, id: string): Scene {
  if (!scene.objects.some(object => object.id === id)) return scene;
  return preserveErasures(scene, { ...scene, objects: scene.objects.filter(object => object.id !== id) });
}

/** Explicit toolbar action. Selecting or moving an object never changes depth. */
export function bringObjectToFront(scene: Scene, id: string): Scene {
  const selected = scene.objects.find(object => object.id === id);
  if (!selected) return scene;
  const promoted = scene.objects.filter(object => object.stackRank !== undefined).sort((a, b) => a.stackRank! - b.stackRank!);
  if (promoted.at(-1)?.id === id) return scene;
  const ranks = new Map([...promoted.filter(object => object.id !== id), selected].map((object, index) => [object.id, index + 1]));
  return { ...scene, objects: scene.objects.map(object => {
    const stackRank = ranks.get(object.id);
    return stackRank === undefined || stackRank === object.stackRank ? object : { ...object, stackRank };
  }) };
}
