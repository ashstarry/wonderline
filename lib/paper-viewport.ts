/** Logical coordinates of the whole sheet, independent of its screen pixels. */
export type PaperViewport = { x: number; y: number; width: number; height: number };
export const DEFAULT_PAPER: Readonly<PaperViewport> = Object.freeze({ x: 0, y: 0, width: 1000, height: 640 });
export const PAPER_COORDINATE_LIMIT = 10000;

export function isPaperViewport(value: unknown): value is PaperViewport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const paper = value as PaperViewport;
  return [paper.x, paper.y, paper.width, paper.height].every(Number.isFinite) &&
    paper.x >= -PAPER_COORDINATE_LIMIT && paper.y >= -PAPER_COORDINATE_LIMIT &&
    paper.width > 0 && paper.height > 0 && paper.width <= PAPER_COORDINATE_LIMIT * 2 && paper.height <= PAPER_COORDINATE_LIMIT * 2 &&
    paper.x + paper.width <= PAPER_COORDINATE_LIMIT && paper.y + paper.height <= PAPER_COORDINATE_LIMIT;
}

/** Undo and scene replacement must not shrink the camera before old ink is erased. */
export function retainPaperExtent(previous: PaperViewport, next: PaperViewport): PaperViewport {
  const a = isPaperViewport(previous) ? previous : DEFAULT_PAPER;
  const b = isPaperViewport(next) ? next : DEFAULT_PAPER;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/**
 * Expand one logical axis to match the screen, retaining the whole existing
 * sheet and its center. Geometry is never stretched to fill a different aspect.
 * Pathological ratios stop at the safe coordinate limit instead of overflowing.
 */
export function fitPaperViewport(pixelWidth: number, pixelHeight: number, base: PaperViewport = DEFAULT_PAPER): PaperViewport {
  const paper = isPaperViewport(base) ? base : DEFAULT_PAPER;
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) return { ...paper };
  const centerX = paper.x + paper.width / 2;
  const centerY = paper.y + paper.height / 2;
  const maximumWidth = 2 * (PAPER_COORDINATE_LIMIT - Math.abs(centerX));
  const maximumHeight = 2 * (PAPER_COORDINATE_LIMIT - Math.abs(centerY));
  const ratio = pixelWidth / pixelHeight;
  let width = paper.width;
  let height = paper.height;
  if (ratio >= paper.width / paper.height) width = Math.min(maximumWidth, Math.max(paper.width, paper.height * ratio));
  else height = Math.min(maximumHeight, Math.max(paper.height, paper.width / ratio));
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}
