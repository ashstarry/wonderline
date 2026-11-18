/** Feedback belongs to the last meaningful input, not to an ASR delivery event. */
export class TurnFeedbackGate {
  private revision = 0;
  private observed = '';

  get version(): number { return this.revision; }

  /** Opening a microphone alone should not retire an unanswered notice. */
  beginSession(): void {
    this.observed = '';
  }

  observe(stableText: string, partial: string): boolean {
    // A partial moving into the stable transcript, punctuation refinement, and
    // spaces inserted between ASR chunks do not mean the child said something new.
    const meaningful = `${stableText}${partial}`.normalize('NFC').replace(/[\s\p{P}]/gu, '');
    if (!meaningful || meaningful === this.observed) return false;
    this.observed = meaningful;
    this.advance();
    return true;
  }

  /** A deliberately submitted typed entry is a new turn, even if repeated. */
  advance(): void {
    this.revision++;
  }

  isCurrent(version: number): boolean {
    return this.revision === version;
  }
}

type QueueActivity = { painting: boolean; pendingCount: number; paused: boolean };

/** A service pause retains work without locking the child out of the microphone. */
export function inputIsBusy(phase: string, batch: boolean, queue: QueueActivity | undefined | null): boolean {
  if (batch || ['recording', 'requesting', 'uploading', 'finishing'].includes(phase)) return true;
  if (queue?.painting) return true;
  if (phase === 'draining' && !queue?.paused) return true;
  return !!queue && queue.pendingCount > 0 && !queue.paused;
}
