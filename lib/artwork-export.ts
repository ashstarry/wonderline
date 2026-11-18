/** Export the visible paper at its actual aspect ratio; an expanded viewBox
 * must never be squeezed back into the original 1000 × 640 rectangle. */
export function artworkExportSize(viewBox: string | null): { width: number; height: number } {
  const values = viewBox?.trim().split(/[\s,]+/).map(Number);
  const valid = values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0;
  const paperWidth = valid ? values[2] : 1000;
  const paperHeight = valid ? values[3] : 640;
  const scale = 2000 / Math.max(paperWidth, paperHeight);
  return { width: Math.max(1, Math.round(paperWidth * scale)), height: Math.max(1, Math.round(paperHeight * scale)) };
}
