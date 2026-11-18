import { z } from 'zod';
import { DEFAULT_PAPER } from './paper-viewport';
import type { Scene } from './scene';
import { CANVAS_CONTEXT_LIMITS, canvasSceneKey, needsMarkBounds } from './canvas-context';
import { getScenePaintOrder } from './scene-paint-order';

const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const coordinate = z.number().finite().min(-CANVAS_CONTEXT_LIMITS.coordinate).max(CANVAS_CONTEXT_LIMITS.coordinate);
const size = z.number().finite().min(0).max(CANVAS_CONTEXT_LIMITS.size);
const bounds = z.tuple([coordinate, coordinate, size, size]);
export const canvasContextSchema = z.object({
  version: z.literal(1), scene_key: z.string().max(64), paint_order: z.array(id).max(CANVAS_CONTEXT_LIMITS.objects),
  objects: z.array(z.object({
    id, bounds: bounds.nullable(),
    marks: z.array(z.object({ index: z.number().int().min(0).max(99), bounds }).strict()).max(CANVAS_CONTEXT_LIMITS.marks).optional(),
  }).strict()).max(CANVAS_CONTEXT_LIMITS.objects),
  marks_truncated: z.boolean(),
}).strict().refine(value => value.objects.reduce((sum, object) => sum + (object.marks?.length ?? 0), 0) <= CANVAS_CONTEXT_LIMITS.marks);

/** Advisory browser measurements never replace the authoritative scene. Drop
 * invalid/stale context, including wrong order or mark IDs, without failing art. */
export function modelCanvasContext(scene: Scene, raw: unknown, instruction: string) {
  const parsed = canvasContextSchema.safeParse(raw);
  if (!parsed.success || parsed.data.scene_key !== canvasSceneKey(scene)) return undefined;
  const context = parsed.data, ordered = getScenePaintOrder(scene);
  if (context.paint_order.length !== ordered.length || context.paint_order.some((id, index) => id !== ordered[index].id)
    || context.objects.length !== ordered.length || new Set(context.objects.map(object => object.id)).size !== ordered.length) return undefined;
  const byId = new Map(scene.objects.map(object => [object.id, object]));
  for (const item of context.objects) {
    const object = byId.get(item.id);
    if (!object || item.marks?.some(mark => mark.index >= (object.marks?.length ?? 0)) || new Set(item.marks?.map(mark => mark.index)).size !== (item.marks?.length ?? 0)) return undefined;
  }
  const detail = needsMarkBounds(instruction);
  const measured = new Map(context.objects.map(object => [object.id, object]));
  return {
    canvas: { ...(scene.paper ?? DEFAULT_PAPER), origin: 'original-paper-top-left', x_direction: 'right', y_direction: 'down' },
    bounds_format: '[left,top,width,height]; source geometry before erasing, clipping, pigment and occlusion',
    paint_order: ordered.map(object => object.id),
    objects: ordered.map(object => {
      const item = measured.get(object.id)!;
      return { id: object.id, transform: [object.x, object.y, object.scale, ...(object.rotation ? [object.rotation] : [])], geometry_bounds: item.bounds,
        ...(detail && item.marks ? { mark_bounds: item.marks.map(mark => [mark.index, ...mark.bounds]) } : {}) };
    }),
    mark_bounds_truncated: detail && context.marks_truncated,
  };
}
