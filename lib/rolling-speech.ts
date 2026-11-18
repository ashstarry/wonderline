import type { SpeechUpdate } from './qwen-events';

const RATE = 16000, WINDOW = 12 * RATE, OVERLAP = 2 * RATE;
const boundary = /[，。！？；,.!?;]/;
const trim = (s: string) => s.replace(/^[\s，。！？；,.!?;]+/, '');
function letters(text: string) {
  const positions: number[] = [], chars: string[] = [];
  for (let i = 0; i < text.length; i++) if (/[\p{L}\p{N}]/u.test(text[i])) { positions.push(i); chars.push(text[i].toLowerCase()); }
  return { value: chars.join(''), positions };
}
export function sharedClause(a: string, b: string) {
  const tokenize = (s: string) => [...s].map((c, i) => ({ c: boundary.test(c) ? '.' : c.toLowerCase(), end: i + 1 })).filter(t => !/\s/.test(t.c));
  const left = tokenize(a), right = tokenize(b); let end = 0;
  for (let i = 0; i < Math.min(left.length, right.length) && left[i].c === right[i].c; i++) if (right[i].c === '.') end = right[i].end;
  // In continuous speech ASR can insert a comma into an already stable prefix.
  // Accept that internal boundary without demanding identical earlier punctuation.
  // A newly invented terminal period still needs the ordinary two-hypothesis check.
  const av = letters(a).value, bv = letters(b).value; let shared = 0, count = 0;
  while (shared < Math.min(av.length, bv.length) && av[shared] === bv[shared]) shared++;
  for (let i = 0; i < b.length; i++) {
    if (/[\p{L}\p{N}]/u.test(b[i])) count++;
    if (boundary.test(b[i]) && count <= shared && bv.length - count >= 2) end = Math.max(end, i + 1);
  }
  return b.slice(0, end);
}
/** Map an already committed prefix through small ASR spelling revisions. */
export function stripCommitted(text: string, committed: string) {
  const a = letters(committed).value, { value: b, positions } = letters(text);
  if (!a) return trim(text);
  if (b.startsWith(a)) return trim(text.slice((positions[a.length - 1] ?? text.length) + 1));
  // Bounded edit alignment; trailing hypothesis text is free, prefix edits are not.
  const target = b.slice(0, Math.min(b.length, a.length + 48));
  let prev = Array.from({ length: target.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= target.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === target[j - 1] ? 0 : 1));
    prev = row;
  }
  let end = 0, score = Infinity;
  for (let j = Math.max(1, a.length - 32); j < prev.length; j++) if (prev[j] < score) { score = prev[j]; end = j; }
  // A very different revision cannot safely duplicate old painting commands.
  if (!end || score > Math.max(3, a.length * .35)) return '';
  return trim(text.slice(positions[end - 1] + 1));
}
export function stripOverlap(text: string, tail: string) {
  const a = letters(tail).value, { value: b, positions } = letters(text);
  for (let n = Math.min(a.length, b.length, 160); n >= 2; n--) if (a.endsWith(b.slice(0, n))) return trim(text.slice(positions[n - 1] + 1));
  // The retained two seconds may begin mid-word. Match a long suffix even when
  // ASR revises one or two letters; do not replay that overlap as a new command.
  let best = 0, bestScore = 0;
  for (let n = Math.min(a.length, 80); n >= 8; n--) {
    const suffix = a.slice(-n), target = b.slice(0, n + 2); let row = Array.from({length:target.length+1},(_,i)=>i);
    for (let i=1;i<=n;i++) {const next=[i];for(let j=1;j<=target.length;j++)next[j]=Math.min(row[j]+1,next[j-1]+1,row[j-1]+(suffix[i-1]===target[j-1]?0:1));row=next;}
    for(let m=Math.max(8,n-2);m<row.length;m++){
      const edits=row[m],score=Math.min(n,m)-edits*4;
      if(edits<=Math.min(2,Math.floor(Math.min(n,m)*.16))&&score>bestScore){best=m;bestScore=score;}
    }
  }
  if(best) return trim(text.slice(positions[best-1]+1));
  return text;
}
export function voiceStats(pcm: Int16Array) {
  let voiced = 0, last = -1;
  for (let offset = 0; offset + 320 <= pcm.length; offset += 320) {
    let sum = 0; for (let i = offset; i < offset + 320; i++) sum += pcm[i] * pcm[i];
    if (Math.sqrt(sum / 320) / 32768 > .0035) { voiced++; last = offset + 320; }
  }
  return { voiced: voiced >= 2, silence: last < 0 ? pcm.length / RATE : (pcm.length - last) / RATE };
}
export function pcmWav(pcm: Int16Array) {
  const bytes = new Uint8Array(44 + pcm.byteLength), view = new DataView(bytes.buffer);
  const word = (s: string, at: number) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  word('RIFF', 0); view.setUint32(4, bytes.length - 8, true); word('WAVEfmt ', 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); word('data', 36); view.setUint32(40, pcm.byteLength, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

/** One in-flight inference, latest audio wins; painting never gates recognition. */
export class RollingSpeech {
  private buffer = new Int16Array(0);
  private base = 0; private received = 0; private requested = 0;
  private previous = ''; private committed = ''; private overlap = ''; private overlapSamples = 0;
  private partial = ''; private stable = ''; private ordinal = 0; private revision = 0;
  private busy = false; private ending = false; private closed = false;
  private controller = new AbortController();
  constructor(private id: string, private infer: (pcm: Int16Array, signal: AbortSignal) => Promise<string>,
    private update: (u: SpeechUpdate) => void, private error: () => void, private started = Date.now()) {}
  feed(bytes: ArrayBuffer) {
    if (this.closed || this.ending) return;
    const pcm = new Int16Array(bytes), combined = new Int16Array(this.buffer.length + pcm.length);
    combined.set(this.buffer); combined.set(pcm, this.buffer.length); this.buffer = combined; this.received += pcm.length;
    if (this.buffer.length > 24 * RATE) { this.fail(); return; }
    void this.pump();
  }
  finish() { if (!this.closed) { this.ending = true; void this.pump(); } }
  cancel() { this.closed = true; this.controller.abort(); this.buffer = new Int16Array(0); }
  private fail() { if (!this.closed) { this.cancel(); this.error(); } }
  private emit(segments: SpeechUpdate['segments'], done = false) {
    this.update({ sessionId: this.id, revision: ++this.revision, partial: this.partial, stableText: this.stable,
      segments, done, mode: 'openrouter-rolling', elapsedMs: Date.now() - this.started, receivedSeconds: this.received / RATE });
  }
  private async pump() {
    if (this.closed || this.busy) return;
    const fresh = this.buffer.subarray(this.overlapSamples), stats = voiceStats(fresh);
    if (!stats.voiced) {
      if (this.ending) { this.partial = ''; this.emit([], true); this.cancel(); return; }
      if (fresh.length >= RATE * .6) { this.base = this.received - 3200; this.buffer = this.buffer.slice(-3200); this.previous = this.committed = this.overlap = ''; this.overlapSamples = 0; }
      return;
    }
    const paused = stats.silence >= .5;
    if (!this.ending && this.buffer.length < RATE * .4) return;
    if (!this.ending && this.received - this.requested < RATE * .4 && !paused) return;
    // Slice a fixed snapshot. Audio arriving during HTTP stays buffered and is never lost.
    const snapshot = this.buffer.slice(0, WINDOW), end = this.base + snapshot.length;
    if (!this.ending && end <= this.requested) return;
    const isFinal = this.ending && end === this.received;
    const isPaused = voiceStats(snapshot.subarray(this.overlapSamples)).silence >= .5;
    const rollover = snapshot.length >= WINDOW;
    this.busy = true; this.requested = end;
    try {
      const raw = (await this.infer(snapshot, this.controller.signal)).trim().slice(0, 3000);
      if (this.closed) return;
      const hypothesis = stripOverlap(raw, this.overlap);
      const commit = isFinal || isPaused || rollover ? hypothesis : sharedClause(this.previous, hypothesis);
      const segments: SpeechUpdate['segments'] = [];
      if (commit) {
        const next = stripCommitted(commit, this.committed);
        if (letters(next).value) {
          if (this.stable.length + next.length > 12000) { this.fail(); return; }
          segments.push({ id: `${this.id}:${++this.ordinal}`, text: next });
          this.stable += (this.stable && /[\x00-\x7f]$/.test(this.stable) && /^[\x00-\x7f]/.test(next) ? ' ' : '') + next;
        }
        // Failed prefix alignment must not silently acknowledge (and drop) new speech.
        if (letters(next).value || letters(commit).value === letters(this.committed).value) this.committed = commit;
      }
      this.previous = hypothesis; this.partial = stripCommitted(hypothesis, this.committed);
      if (isFinal || isPaused || rollover) {
        const retain = rollover && !isPaused && !isFinal ? OVERLAP : 0;
        const consumed = snapshot.length - retain;
        this.buffer = this.buffer.slice(consumed); this.base += consumed;
        this.overlap = retain ? this.stable.slice(-220) : ''; this.overlapSamples = retain;
        this.previous = this.committed = this.partial = '';
      }
      this.emit(segments, isFinal);
      if (isFinal) this.cancel();
    } catch { if (!this.closed) this.fail(); }
    finally { this.busy = false; if (!this.closed) void this.pump(); }
  }
}
