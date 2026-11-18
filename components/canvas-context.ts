import type { Scene } from '../lib/scene';
import { CANVAS_CONTEXT_LIMITS, canvasSceneKey, needsMarkBounds, validCanvasBounds, type CanvasBounds, type CanvasGeometryContext } from '../lib/canvas-context';
import { getScenePaintOrder } from '../lib/scene-paint-order';

/** The SVG engine computes actual curve bounds; parsing SVG numbers as x/y
 * would misread curve controls, relative commands and arc parameters. */
export function measureShapeBounds(shape: SVGGraphicsElement, canvasInverse: DOMMatrix): CanvasBounds | null {
  try {
    const screen = shape.getScreenCTM();
    if (!screen) return null;
    let matrix = canvasInverse.multiply(screen);
    const moving = shape.closest<SVGGraphicsElement>('[data-pose-moving]');
    if (moving) {
      // Model context uses the destination, even while retained pigment moves.
      const wrapper = moving.getScreenCTM(), parent = (moving.parentElement as unknown as SVGGraphicsElement)?.getScreenCTM();
      if (!wrapper || !parent) return null;
      matrix = canvasInverse.multiply(parent).multiply(wrapper.inverse()).multiply(screen);
    }
    const box = shape.getBBox();
    const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]];
    const xs = corners.map(([x, y]) => matrix.a * x + matrix.c * y + matrix.e);
    const ys = corners.map(([x, y]) => matrix.b * x + matrix.d * y + matrix.f);
    const left = Math.min(...xs), top = Math.min(...ys);
    const bounds = [left, top, Math.max(...xs) - left, Math.max(...ys) - top].map(value => Math.round(value * 10) / 10);
    return validCanvasBounds(bounds) ? bounds : null;
  } catch { return null; }
}

function sourceShapes(container: Element): SVGGraphicsElement[] {
  return Array.from(container.querySelectorAll<SVGGraphicsElement>('[data-playback-shape="true"]'))
    .filter(shape => !shape.closest('[data-playback-artifact], [data-playback-decoration], defs, mask, clipPath, pattern'));
}

function union(boxes: CanvasBounds[]): CanvasBounds | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box[0])), top = Math.min(...boxes.map(box => box[1]));
  const bounds = [left, top, Math.max(...boxes.map(box => box[0] + box[2])) - left, Math.max(...boxes.map(box => box[1] + box[3])) - top];
  return validCanvasBounds(bounds) ? bounds.map(value => Math.round(value * 10) / 10) as CanvasBounds : null;
}

/** Reads only an already-rendered, matching snapshot. A stale/missing SVG is
 * optional context, never a reason to delay speech or make another request. */
export function measureCanvasContext(canvas: SVGSVGElement | null, scene: Scene, instruction: string): CanvasGeometryContext | undefined {
  try {
  if (!canvas || !scene.objects.length || scene.objects.length > CANVAS_CONTEXT_LIMITS.objects || canvas.getAttribute('data-scene-key') !== canvasSceneKey(scene)) return undefined;
  let inverse: DOMMatrix;
  try { const matrix = canvas.getScreenCTM(); if (!matrix) return undefined; inverse = matrix.inverse(); } catch { return undefined; }
  const detail = needsMarkBounds(instruction);
  let remaining = CANVAS_CONTEXT_LIMITS.marks, truncated = false;
  const objects = getScenePaintOrder(scene).map(object => {
    // IDs are schema-bounded ASCII; do not use user labels in selectors.
    const containers = Array.from(canvas.querySelectorAll(`[data-object-id="${object.id}"], [data-marks-for="${object.id}"]`))
      .filter(element => !element.closest('[data-playback-artifact]'));
    const shapes = [...new Set(containers.flatMap(sourceShapes))];
    const boxes = shapes.map(shape => measureShapeBounds(shape, inverse));
    const bounds = boxes.every((box): box is CanvasBounds => box !== null) ? union(boxes) : null;
    const item: CanvasGeometryContext['objects'][number] = { id: object.id, bounds };
    if (detail && object.marks?.length) {
      const holder = containers.find(element => element.getAttribute('data-marks-for') === object.id);
      const markShapes = holder ? sourceShapes(holder) : [];
      // Every BrushMark has one original shape. Incomplete DOM snapshots must
      // not attach one mark's bounds to a different canonical mark index.
      if (markShapes.length === object.marks.length) {
        const marks: NonNullable<typeof item.marks> = [];
        for (let index = 0; index < markShapes.length; index++) {
          if (!remaining) { truncated = true; break; }
          const markBounds = measureShapeBounds(markShapes[index], inverse);
          if (markBounds) { marks.push({ index, bounds: markBounds }); remaining--; }
          else truncated = true;
        }
        if (marks.length) item.marks = marks;
      } else truncated = true;
    }
    return item;
  });
  return { version: 1, scene_key: canvasSceneKey(scene), paint_order: getScenePaintOrder(scene).map(object => object.id), objects, marks_truncated: truncated };
  } catch { return undefined; }
}
