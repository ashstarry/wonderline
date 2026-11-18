/** One simple size choice applies to both tools. Erasers use screen pixels,
 * then convert to paper coordinates so the cursor and saved mask agree. */
export const MANUAL_SIZES = [
  { value: 3, label: '小', preview: 6, eraserPixels: 24 },
  { value: 5, label: '中', preview: 11, eraserPixels: 38 },
  { value: 9, label: '大', preview: 18, eraserPixels: 64 },
] as const;

export function manualEraserWidth(size: number, screenScale: number): number {
  const pixels = (MANUAL_SIZES.find(choice => choice.value === size) ?? MANUAL_SIZES[1]).eraserPixels;
  const scale = Number.isFinite(screenScale) && screenScale > 0 ? screenScale : 1;
  return Math.max(1, Math.min(256, pixels / scale));
}
