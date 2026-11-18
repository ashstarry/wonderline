import type { ChineseAcousticActivity } from './chinese-neural-activity';
import type { SpeechUpdate } from './qwen-events';
import { stripOverlap } from './rolling-speech';
import { chineseVoiceStats } from './chinese-voice-activity';
import { reconcileChineseHypothesis, stripChineseCommitted, type ChineseHypothesisBranch } from './chinese-hypothesis';
import { selectChineseSpeechBoundary, splitChineseSpeechClauses } from './chinese-speech-boundary';

const RATE = 16000, WINDOW = 12 * RATE, OVERLAP = 2 * RATE;
const meaningful = (text: string) => /[\p{L}\p{N}]/u.test(text);
function join(left: string, right: string) {
  return left + right;
}

/** Re-decoded audio can revise the uncommitted suffix; stable words stay outside. */
export function mergeChinesePendingOverlap(pending: string, decoded: string) {
  if (!pending || !decoded) return pending || decoded;
  const tokens = (text: string) => {
    const chars: string[] = [], starts: number[] = []; let at = 0;
    for (const character of text) {
      if (/[\p{L}\p{N}]/u.test(character)) { chars.push(character.toLowerCase()); starts.push(at); }
      at += character.length;
    }
    return { chars: chars.join(''), starts };
  };
  const a = tokens(pending), b = tokens(decoded);
  const minimum = a.chars.length === 1 ? 1 : 2;
  for (let n = Math.min(a.chars.length, b.chars.length, 160); n >= minimum; n--) {
    if (a.chars.endsWith(b.chars.slice(0, n))) return pending.slice(0, a.starts[a.chars.length - n]) + decoded;
  }
  // Small spelling revisions are common at the retained audio boundary. Align
  // only that known overlap, never run vocabulary-based or semantic correction.
  let bestLength = 0, bestScore = 0;
  for (let n = Math.min(a.chars.length, 80); n >= 8; n--) {
    const suffix = a.chars.slice(-n), target = b.chars.slice(0, n + 2);
    let row = Array.from({ length: target.length + 1 }, (_, i) => i);
    for (let i = 1; i <= n; i++) {
      const next = [i];
      for (let j = 1; j <= target.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (suffix[i - 1] === target[j - 1] ? 0 : 1));
      row = next;
    }
    for (let m = Math.max(8, n - 2); m < row.length; m++) {
      const edits = row[m], score = Math.min(n, m) - edits * 4;
      if (edits <= Math.min(2, Math.floor(Math.min(n, m) * .16)) && score > bestScore) { bestLength = n; bestScore = score; }
    }
  }
  return bestLength ? pending.slice(0, a.starts[a.chars.length - bestLength]) + decoded : pending + decoded;
}

export type ChineseRollingDiagnostic = {
  windowStart: number; windowEnd: number; paused: boolean; cutAtPause: boolean;
  rawLength: number; committedLength: number; partialLength: number; branch: ChineseHypothesisBranch;
};

/** Chinese experiment: acoustic windows may end before a drawing clause does. */
export class ChineseRollingSpeech {
  private buffer = new Int16Array(0);
  private base = 0; private received = 0; private requested = 0;
  private previous = ''; private committed = ''; private carry = '';
  private overlap = ''; private overlapSamples = 0;
  private partial = ''; private stable = ''; private ordinal = 0; private revision = 0;
  private busy = false; private ending = false; private closed = false;
  private controller = new AbortController();
  constructor(private id: string, private infer: (pcm: Int16Array, signal: AbortSignal) => Promise<string>,
    private update: (u: SpeechUpdate) => void, private error: () => void, private started = Date.now(),
    private diagnostic?: (value: ChineseRollingDiagnostic) => void, private activity?: ChineseAcousticActivity, private acousticError?: (stage: 'processing' | 'release') => void) {}

  feed(bytes: ArrayBuffer) {
    if (this.closed || this.ending) return;
    const pcm = new Int16Array(bytes), combined = new Int16Array(this.buffer.length + pcm.length);
    combined.set(this.buffer); combined.set(pcm, this.buffer.length);
    this.buffer = combined; this.received += pcm.length;
    try { this.activity?.feed(pcm); } catch { try { this.acousticError?.('processing'); } catch {} this.fail(); return; }
    if (this.buffer.length > 24 * RATE) { this.fail(); return; }
    void this.pump();
  }
  finish() { if (!this.closed) { try { this.activity?.finish(); } catch { try { this.acousticError?.('processing'); } catch {} this.fail(); return; } this.ending = true; void this.pump(); } }
  cancel() { this.closed = true; this.controller.abort(); this.buffer = new Int16Array(0); const activity = this.activity; this.activity = undefined; try { activity?.close(); } catch { try { this.acousticError?.('release'); } catch {} } }
  private fail() { if (!this.closed) { this.cancel(); this.error(); } }
  private emit(segments: SpeechUpdate['segments'], done = false) {
    this.update({ sessionId: this.id, revision: ++this.revision, partial: this.partial, stableText: this.stable,
      segments, done, mode: 'openrouter-rolling', elapsedMs: Date.now() - this.started, receivedSeconds: this.received / RATE });
  }
  private append(text: string, segments: SpeechUpdate['segments']) {
    if (!meaningful(text)) return;
    if (this.stable.length + text.length > 12000) throw new Error('Transcript limit');
    for (const clause of splitChineseSpeechClauses(text)) {
      if (meaningful(clause)) segments.push({ id: `${this.id}:${++this.ordinal}`, text: clause });
    }
    this.stable = join(this.stable, text);
  }
  private async pump() {
    if (this.closed || this.busy) return;
    const fresh = this.buffer.subarray(this.overlapSamples), stats = this.activity ? this.activity.stats(this.base + this.overlapSamples, this.received) : chineseVoiceStats(fresh);
    if (!stats.voiced) {
      if (this.ending) {
        try {
          const segments: SpeechUpdate['segments'] = [];
          // Explicit stop releases the unfinished sentence, including one retained
          // across several silence-only acoustic windows. No paid silence call.
          this.append(this.partial || this.carry, segments); this.partial = this.carry = '';
          this.emit(segments, true); this.cancel();
        } catch { this.fail(); }
        return;
      }
      if (fresh.length >= RATE * .6) {
        const keep = this.activity?.preRollSamples ?? 3200;
        this.base = this.received - Math.min(keep, this.buffer.length); this.buffer = this.buffer.slice(-keep);
        this.previous = this.carry; this.committed = this.overlap = ''; this.overlapSamples = 0;
      }
      return;
    }
    // A pause may now be INSIDE the buffer: the next utterance can arrive
    // while an earlier HTTP request is in flight. Split at that first pause,
    // so sentence two is not mistaken for a replacement of sentence one.
    const pauseStats = this.overlapSamples ? (this.activity ? this.activity.stats(this.base, this.received) : chineseVoiceStats(this.buffer)) : stats;
    const pauseEnd = pauseStats.firstPauseEnd;
    const paused = pauseEnd !== undefined || stats.silence >= .5;
    if (!this.ending && this.buffer.length < RATE * .4) return;
    if (!this.ending && this.received - this.requested < RATE * .4 && !paused) return;
    const snapshot = this.buffer.slice(0, Math.min(WINDOW, pauseEnd ?? WINDOW)), start = this.base, end = start + snapshot.length;
    if (!this.ending && end <= this.requested) return;
    const isFinal = this.ending && end === this.received;
    const cutAtPause = pauseEnd !== undefined && snapshot.length === pauseEnd;
    const isPaused = cutAtPause || (this.activity ? this.activity.stats(start + this.overlapSamples, end) : chineseVoiceStats(snapshot.subarray(this.overlapSamples))).silence >= .5;
    const rollover = snapshot.length >= WINDOW;
    this.busy = true; this.requested = end;
    try {
      const raw = (await this.infer(snapshot, this.controller.signal)).trim().slice(0, 3000);
      if (this.closed) return;
      const acoustic = stripOverlap(raw, this.overlap);
      const candidate = raw ? (this.overlapSamples ? mergeChinesePendingOverlap(this.carry, acoustic) : join(this.carry, acoustic)) : '';
      const reconciled = reconcileChineseHypothesis(this.previous, candidate, this.committed);
      const hypothesis = reconciled.text;
      const result = selectChineseSpeechBoundary(this.previous, hypothesis, {
        paused: isPaused, final: isFinal, settledText: this.committed || undefined,
      });
      const segments: SpeechUpdate['segments'] = [];
      const next = stripChineseCommitted(result.committed, this.committed) ?? '';
      this.append(next, segments);
      // Prefix alignment failure must not silently acknowledge new speech.
      if (meaningful(next) || result.committed === this.committed) this.committed = result.committed;
      this.previous = hypothesis;
      this.partial = stripChineseCommitted(hypothesis, this.committed) ?? '';
      if (isFinal || isPaused || rollover) {
        const retain = rollover && !isPaused && !isFinal ? OVERLAP : 0;
        const consumed = snapshot.length - retain;
        this.buffer = this.buffer.slice(consumed); this.base += consumed;
        // Remove only already committed speech from retained audio. Its pending
        // suffix is re-decoded and merged above so an ASR-invented terminal stop
        // at the 12-second cut cannot freeze inside a still-incomplete word.
        this.overlap = retain ? this.stable.slice(-220) : ''; this.overlapSamples = retain;
        this.carry = this.partial; this.previous = this.carry; this.committed = '';
      }
      try { this.diagnostic?.({ windowStart: start, windowEnd: end, paused: isPaused, cutAtPause,
        rawLength: raw.length, committedLength: this.stable.length, partialLength: this.partial.length, branch: reconciled.branch }); } catch { /* Diagnostics cannot interrupt speech. */ }
      this.emit(segments, isFinal);
      if (isFinal) this.cancel();
    } catch { if (!this.closed) this.fail(); }
    finally { this.busy = false; if (!this.closed) void this.pump(); }
  }
}
