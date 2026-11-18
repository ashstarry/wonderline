import type { ObjectBox } from '../lib/object-transform';
import type { PaperViewport } from '../lib/paper-viewport';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Position the companion action beside its selection, without changing the object. */
export function companionActionPosition(
  box: ObjectBox,
  viewport: PaperViewport,
  screenScale: number,
  widthPx: number,
  heightPx = 44,
): ObjectBox | null {
  const scale = Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
  if (![box.x, box.y, box.width, box.height, viewport.x, viewport.y, viewport.width, viewport.height, widthPx, heightPx].every(Number.isFinite) ||
      box.width < 0 || box.height < 0 || widthPx <= 0 || heightPx <= 0) return null;

  // Search in screen pixels so the frame gap and control clearance stay constant
  // as the paper zooms. The corner centres match ObjectTransformLayer exactly.
  const width = Math.max(40, widthPx), height = Math.max(40, heightPx);
  const paperWidth = viewport.width * scale, paperHeight = viewport.height * scale;
  const margin = 8, gap = 6, clearance = 22 + 4;
  if (!Number.isFinite(paperWidth) || !Number.isFinite(paperHeight) ||
      paperWidth < width + margin * 2 || paperHeight < height + margin * 2) return null;
  const left = margin, right = paperWidth - margin - width;
  const top = margin, bottom = paperHeight - margin - height;
  const frame = {
    left: (box.x - viewport.x) * scale - 5,
    top: (box.y - viewport.y) * scale - 5,
    right: (box.x + box.width - viewport.x) * scale + 5,
    bottom: (box.y + box.height - viewport.y) * scale + 5,
  };
  const handles = [
    { x: frame.right, y: frame.top },
    { x: clamp(frame.right, 12, paperWidth - 12), y: clamp(frame.bottom, 12, paperHeight - 12) },
  ];
  const below = frame.bottom + gap, above = frame.top - height - gap;
  // When the lower edge cannot fit on the paper, keep the same left alignment
  // above the selection before considering a side or an inset position.
  const preferred = { x: frame.left, y: below > bottom && above >= top && above <= bottom ? above : below };
  const xs = [preferred.x, frame.right - width, frame.left - width - gap, frame.right + gap, left, right];
  const ys = [preferred.y, below, above, frame.top, frame.bottom - height, (frame.top + frame.bottom - height) / 2, top, bottom];
  for (const handle of handles) {
    xs.push(handle.x - clearance - width, handle.x + clearance);
    ys.push(handle.y - clearance - height, handle.y + clearance);
  }

  type Candidate = { x: number; y: number; score: number };
  const best: { external: Candidate | null; inset: Candidate | null } = { external: null, inset: null };
  const consider = (rawX: number, rawY: number) => {
    const x = clamp(rawX, left, right), y = clamp(rawY, top, bottom);
    if (handles.some(handle => Math.hypot(handle.x - clamp(handle.x, x, x + width), handle.y - clamp(handle.y, y, y + height)) < clearance - 1e-7)) return;
    const anchorDistance = Math.hypot(x - preferred.x, y - preferred.y);
    if (!best.inset || anchorDistance < best.inset.score - 1e-7) best.inset = { x, y, score: anchorDistance };
    if (x + width > frame.left - gap && x < frame.right + gap &&
        y + height > frame.top - gap && y < frame.bottom + gap) return;
    const frameDistance = Math.hypot(Math.max(frame.left - x - width, x - frame.right, 0), Math.max(frame.top - y - height, y - frame.bottom, 0));
    // Prefer a small shift along the frame to dropping the action far below it.
    // Distance also keeps viewport-corner candidates behind nearby alternatives.
    const score = frameDistance * 12 + anchorDistance;
    if (!best.external || score < best.external.score - 1e-7) best.external = { x, y, score };
  };

  // A fixed-size set of frame edges, viewport edges and handle tangencies covers
  // cramped selections without a pixel-by-pixel search or an arbitrary fallback.
  for (const y of ys) {
    for (const x of xs) consider(x, y);
    const boundedY = clamp(y, top, bottom);
    for (const handle of handles) {
      const dy = Math.abs(handle.y - clamp(handle.y, boundedY, boundedY + height));
      if (dy >= clearance) continue;
      const dx = Math.sqrt(clearance ** 2 - dy ** 2);
      consider(handle.x - dx - width, boundedY);
      consider(handle.x + dx, boundedY);
    }
  }
  for (const x of xs) {
    const boundedX = clamp(x, left, right);
    for (const handle of handles) {
      const dx = Math.abs(handle.x - clamp(handle.x, boundedX, boundedX + width));
      if (dx >= clearance) continue;
      const dy = Math.sqrt(clearance ** 2 - dx ** 2);
      consider(boundedX, handle.y - dy - height);
      consider(boundedX, handle.y + dy);
    }
  }
  const position = best.external ?? best.inset;
  return position ? { x: viewport.x + position.x / scale, y: viewport.y + position.y / scale, width: width / scale, height: height / scale } : null;
}
