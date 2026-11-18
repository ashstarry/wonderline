import type { Scene } from './scene';

/** Geometry only: [left, top, width, height], before masks, pigment and overlap. */
export type CanvasBounds = [number, number, number, number];
export type CanvasGeometryContext = {
  version: 1;
  scene_key: string;
  paint_order: string[];
  objects: { id: string; bounds: CanvasBounds | null; marks?: { index: number; bounds: CanvasBounds }[] }[];
  marks_truncated: boolean;
};
export const CANVAS_CONTEXT_LIMITS = { objects: 40, marks: 80, coordinate: 20_000, size: 40_000 } as const;

/** A stable snapshot marker, not authentication. Erasures are intentionally
 * excluded because the API receives sceneForModel's unmasked source geometry. */
export function canvasSceneKey(scene: Scene): string {
  const value = JSON.stringify([
    scene.sky, scene.ground, scene.weather,
    scene.objects.map(object => [object.id, object.kind, object.x, object.y, object.scale, object.rotation ?? 0, object.stackRank ?? 0, object.color, object.label ?? null,
      object.marks?.map(mark => [mark.type, mark.d ?? null, mark.x ?? null, mark.y ?? null, mark.w ?? null, mark.h ?? null,
        mark.x2 ?? null, mark.y2 ?? null, mark.fill ?? null, mark.stroke ?? null, mark.strokeWidth ?? null, mark.opacity ?? null, mark.text ?? null]) ?? null]),
  ]);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `v1-${(hash >>> 0).toString(16)}-${value.length}`;
}

export function needsMarkBounds(instruction: string): boolean {
  return /坐|站|拿|握|戴|穿|放|举|抬|靠|贴|抱|踩|叠|挡|遮|透视|位置|前面|后面|上面|下面|旁边|里面|外面|左边|右边|桌上|树下|在.{0,20}[上下里前后]|\b(?:sit|stand|hold|wear|place|behind|front|under|above|overlap|beside|raise)\b/i.test(instruction);
}

export function validCanvasBounds(bounds: readonly number[]): bounds is CanvasBounds {
  return bounds.length === 4 && bounds.every(Number.isFinite)
    && Math.abs(bounds[0]) <= CANVAS_CONTEXT_LIMITS.coordinate && Math.abs(bounds[1]) <= CANVAS_CONTEXT_LIMITS.coordinate
    && bounds[2] >= 0 && bounds[3] >= 0 && bounds[2] <= CANVAS_CONTEXT_LIMITS.size && bounds[3] <= CANVAS_CONTEXT_LIMITS.size;
}
