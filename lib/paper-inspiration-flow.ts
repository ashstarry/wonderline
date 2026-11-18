import type { Scene } from './scene';

/** The existing audio meter supplies RMS × 5, not a speech probability. */
const ONSET_LEVEL = .055;
const MAX_SAMPLE_GAP_MS = 450;

/**
 * A one-shot presentation cue, never an ASR gate. Two nearby audible samples
 * let the opening yield before a transcript arrives without reacting to one
 * microphone click. Sustained non-speech noise may also dismiss the opening.
 */
export class InspirationSpeechOnset {
  private candidateAt: number | null = null;
  private heard = false;

  observe(level: number, nowMs: number): boolean {
    if (this.heard) return false;
    if (!Number.isFinite(level) || !Number.isFinite(nowMs) || level < ONSET_LEVEL) {
      this.candidateAt = null;
      return false;
    }
    const previous = this.candidateAt;
    this.candidateAt = nowMs;
    if (previous === null || nowMs <= previous || nowMs - previous > MAX_SAMPLE_GAP_MS) return false;
    this.heard = true;
    this.candidateAt = null;
    return true;
  }

  reset(): void {
    this.candidateAt = null;
    this.heard = false;
  }
}

/** Existing scenery or erasure history is artwork, even when it looks empty. */
export function isUnmarkedPaper(scene: Scene): boolean {
  return scene.objects.length === 0 && scene.sky === 'paper' && scene.ground === 'none'
    && scene.weather === 'clear' && !(scene.erasures?.length);
}
