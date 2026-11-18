export type BrushCompanionState = 'resting' | 'listening' | 'preparing' | 'drawing' | 'thinking-drawing';

export function brushCompanionState({ listening, preparing, drawing, blocked }: {
  listening: boolean; preparing: boolean; drawing: boolean; blocked: boolean;
}): BrushCompanionState {
  if (blocked) return 'resting';
  // Model work and physical strokes are independent. Do not hide a new
  // request merely because a painter is still finishing the previous idea.
  if (preparing && drawing) return 'thinking-drawing';
  if (drawing) return 'drawing';
  if (preparing) return 'preparing';
  return listening ? 'listening' : 'resting';
}

/** Audio already supplies normalized RMS. Ignore room noise; never invent movement. */
export function brushVoiceAmount(level: number): number {
  if (!Number.isFinite(level) || level <= .035) return 0;
  return Math.min(1, (level - .035) / .5);
}

/** Retains the last real sample only briefly if a capture callback stops arriving. */
export const BRUSH_LEVEL_FRESH_MS = 220;
