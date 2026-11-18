import { drawingFailureKind, RolledBackDrawingFailure } from './drawing-failure';

export type StableSegment = { id: string; text: string };
export type PaintQueueState = {
  painting: boolean;
  pendingCount: number;
  pendingText: string;
  paintingText: string;
  failedText: string;
  failureKind: 'turn' | 'service' | null;
  paused: boolean;
  error: string;
};
export const EMPTY_PAINT_QUEUE: PaintQueueState = {
  painting: false, pendingCount: 0, pendingText: '', paintingText: '', failedText: '',
  failureKind: null, paused: false, error: '',
};

/** onUpdate, done and stop can report the same terminal event; the UI handles it once. */
export class StreamUpdateGate {
  private sessionId = '';
  private revision = -1;
  private terminal = false;
  get ended() { return this.terminal; }

  accept(update: { sessionId: string; revision: number; done: boolean }): boolean {
    if (this.terminal || (this.sessionId && this.sessionId !== update.sessionId)) return false;
    if (update.revision < this.revision || (update.revision === this.revision && !update.done)) return false;
    this.sessionId = update.sessionId;
    this.revision = update.revision;
    this.terminal = update.done;
    return true;
  }

  fail(): boolean {
    if (this.terminal) return false;
    this.terminal = true;
    return true;
  }
}

/** Serialize model commits, NOT visual playback. The callback resolves as soon
 * as a validated scene is committed; painters run on their own clocks. Thus the
 * next phrase sees locked, complete geometry while the previous art is still
 * being drawn. Draft ASR hypotheses never enter this queue. */
export class LivePaintingQueue {
  private waiting: StableSegment[] = [];
  private seen = new Set<string>();
  private flight: StableSegment[] = [];
  private failed: StableSegment[] = [];
  private failureKind: 'turn' | 'service' | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  private paused = false;
  private error = '';
  private scheduled = false;
  private reservedNext: string | null = null;

  constructor(
    private readonly paint: (phrase: string, signal: AbortSignal, segments: readonly StableSegment[]) => Promise<void>,
    private readonly changed: (state: PaintQueueState) => void,
    private readonly options: { maxSegmentsPerTurn?: 1 | 2 } = {},
  ) {}

  snapshot(): PaintQueueState {
    return {
      painting: !!this.controller,
      pendingCount: this.waiting.length,
      pendingText: this.waiting.map(segment => segment.text).join('\n'),
      paintingText: this.flight.map(segment => segment.text).join('\n'),
      failedText: this.failed.map(segment => segment.text).join('\n'),
      failureKind: this.failureKind,
      paused: this.paused,
      error: this.error,
    };
  }

  add(segments: StableSegment[]): boolean {
    if (this.stopped) return false;
    let accepted = false;
    for (const segment of segments) {
      if (!segment.id || this.seen.has(segment.id)) continue;
      const text = segment.text.trim();
      // Empty/duplicate ASR events are not a new thought and must not dismiss a failure.
      if (!text) continue;
      this.seen.add(segment.id);
      accepted = true;
      // Keep the API's per-request limit without dropping a very long utterance.
      for (let start = 0; start < text.length; start += 600) {
        this.waiting.push({ id: `${segment.id}:${start}`, text: text.slice(start, start + 600) });
      }
    }
    if (!accepted) return false;
    if (!this.paused) this.clearFailure();
    this.changed(this.snapshot());
    this.schedule();
    return true;
  }

  /** Reserve one confirmed phrase for background generation. It must not be
   * coalesced with words arriving later, or a prepared result could be misapplied. */
  peekNext(): StableSegment | null {
    return this.controller && !this.stopped && !this.paused && this.waiting[0] ? { ...this.waiting[0] } : null;
  }
  reserveNext(id: string): boolean {
    if (this.peekNext()?.id !== id) return false;
    this.reservedNext = id;
    return true;
  }

  /** A partial can retire the notice, but only stable speech changes the work queue. */
  dismissTurnFailure() {
    if (this.stopped || this.paused || !this.error) return;
    this.error = '';
    this.changed(this.snapshot());
  }

  retry() {
    if (this.stopped || !this.failed.length || this.controller) return;
    // Explicit retry is the only way a failed request is ever submitted again.
    this.waiting.unshift(...this.failed);
    this.clearFailure();
    this.changed(this.snapshot());
    this.schedule();
  }

  cancel() {
    this.stopped = true;
    this.controller?.abort();
    this.controller = null;
    this.waiting = [];
    this.reservedNext = null;
    this.flight = [];
    this.clearFailure();
    this.changed(this.snapshot());
  }

  private schedule() {
    if (this.scheduled || this.stopped || this.paused || this.controller || !this.waiting.length) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.pump();
    });
  }

  private clearFailure() {
    this.failed = [];
    this.failureKind = null;
    this.paused = false;
    this.error = '';
  }

  private async pump() {
    if (this.stopped || this.paused || this.controller || !this.waiting.length) return;
    // Later speech may already be queued when a request fails. Continue with that
    // fresh work without replaying the failed batch or asking the child to retry.
    if (!this.paused) this.clearFailure();
    const batch: StableSegment[] = [];
    let length = 0;
    const reserved = this.waiting[0]?.id === this.reservedNext;
    this.reservedNext = null;
    while (this.waiting.length) {
      const candidate = this.waiting[0];
      const nextLength = length + candidate.text.length + (batch.length ? 1 : 0);
      // Keep a short conversational beat rather than one sprawling backlog.
      // Every segment still runs exactly once, without truncating its text.
      if (batch.length && (reserved || batch.length >= (this.options.maxSegmentsPerTurn ?? 2) || nextLength > 160)) break;
      batch.push(this.waiting.shift()!);
      length = nextLength;
    }
    this.flight = batch;
    const controller = new AbortController();
    this.controller = controller;
    this.changed(this.snapshot());
    try {
      await this.paint(batch.map(segment => segment.text).join('\n'), controller.signal, batch.map(segment => ({...segment})));
    } catch (cause) {
      if (this.stopped || controller.signal.aborted || this.controller !== controller) return;
      // Do not automatically replay an uncertain request: it could already have incurred a model charge.
      const rolledBack = cause instanceof RolledBackDrawingFailure;
      this.failed = rolledBack ? [] : batch;
      this.failureKind = drawingFailureKind(cause);
      this.paused = !rolledBack && this.failureKind === 'service';
      this.error = cause instanceof Error ? cause.message : '这一笔暂时没有完成。';
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this.flight = [];
      }
      if (!this.stopped) {
        this.changed(this.snapshot());
        this.schedule();
      }
    }
  }
}
