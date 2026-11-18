import type { TranscriptTarget, VoiceConversationUpdate } from './conversation';
import type { StableSegment } from './live-painting';

type IndexedSegment = { target: Readonly<TranscriptTarget>; text: string; sessionId: string };
type SessionPosition = { revision: number; stableText: string; valid: boolean };
type IndexedUpdate = VoiceConversationUpdate & { segments: readonly StableSegment[] };

/**
 * Captures the source location when ASR commits a segment, before model work
 * starts. A later reply may arrive after several more sentences; its immutable
 * coordinates still refer only to the sentence that produced that request.
 * This index is ephemeral. Persisted conversation data contains offsets only.
 */
export class VoiceTranscriptIndex {
  private sessions = new Map<string, SessionPosition>();
  private segments = new Map<string, IndexedSegment>();
  private ambiguousIds = new Set<string>();

  reset() {
    this.sessions.clear();
    this.segments.clear();
    this.ambiguousIds.clear();
  }

  observe(update: IndexedUpdate): void {
    if (!update.sessionId || !Number.isInteger(update.revision) || update.revision < 0 || typeof update.stableText !== 'string') return;
    const previous = this.sessions.get(update.sessionId);
    if (previous && update.revision < previous.revision) return;
    // The terminal ASR event may contain no new stable text. It does not reset
    // source positions already captured for the session.
    const stableText = update.stableText || previous?.stableText || '';
    const valid = previous?.valid !== false && (!previous || stableText.startsWith(previous.stableText));
    this.sessions.set(update.sessionId, { revision: update.revision, stableText, valid });
    if (!valid) return;

    const fresh: StableSegment[] = [];
    for (const segment of update.segments) {
      if (!segment.id || !segment.text.trim() || this.ambiguousIds.has(segment.id)) continue;
      const existing = this.segments.get(segment.id);
      if (existing) {
        if (existing.sessionId !== update.sessionId || existing.text !== segment.text.trim()) {
          // An ID collision cannot safely identify either occurrence.
          this.segments.delete(segment.id);
          this.ambiguousIds.add(segment.id);
        }
      } else fresh.push(segment);
    }
    if (!fresh.length) return;
    const pending = new Map<string, IndexedSegment>();
    let cursor = previous?.stableText.length ?? 0;
    for (const segment of fresh) {
      const text = segment.text.trim();
      const start = stableText.indexOf(text, cursor);
      // Match exact committed segments in append order, allowing only the ASR
      // separator between them. Never guess from a repeated phrase elsewhere.
      if (start < 0 || stableText.slice(cursor, start).trim() || pending.has(segment.id)) return;
      const end = start + text.length;
      const target = Object.freeze({ entryId: `voice:${update.sessionId}`, start, end });
      pending.set(segment.id, { target, text, sessionId: update.sessionId });
      cursor = end;
    }
    if (stableText.slice(cursor).trim()) return;
    for (const [id, segment] of pending) this.segments.set(id, segment);
  }

  /** Recheck captured targets when an asynchronous model reply finally arrives. */
  validTargets(targets: readonly TranscriptTarget[]): TranscriptTarget[] {
    return targets.filter(target => {
      if (!target.entryId.startsWith('voice:') || !Number.isInteger(target.start) || !Number.isInteger(target.end) || target.start < 0 || target.end <= target.start) return false;
      const session = this.sessions.get(target.entryId.slice('voice:'.length));
      return !!session?.valid && target.end <= session.stableText.length;
    }).map(target => ({ ...target }));
  }

  /** Unresolvable spans are omitted from the result; they must never be guessed. */
  targets(segments: readonly StableSegment[]): TranscriptTarget[] {
    const result: TranscriptTarget[] = [];
    const seen = new Set<string>();
    for (const segment of segments) {
      if (this.ambiguousIds.has(segment.id)) continue;
      let indexed = this.segments.get(segment.id);
      const direct = !!indexed;
      let offset = 0;
      if (!indexed) {
        // The painting queue chunks >600 characters and suffixes the source ID
        // with the UTF-16 start offset. Do not mistake this for a new sentence.
        const chunk = /^(.*):(\d+)$/u.exec(segment.id);
        if (!chunk) continue;
        indexed = this.segments.get(chunk[1]);
        offset = Number(chunk[2]);
      }
      if (!indexed || (direct && segment.text !== indexed.text) || !Number.isSafeInteger(offset) || !this.sessions.get(indexed.sessionId)?.valid || !segment.text ||
          indexed.text.slice(offset, offset + segment.text.length) !== segment.text ||
          offset + segment.text.length > indexed.text.length) continue;
      const start = indexed.target.start + offset;
      const end = start + segment.text.length;
      // A source range must never split an emoji surrogate pair.
      if ((offset > 0 && /[\uDC00-\uDFFF]/u.test(indexed.text[offset])) ||
          (offset + segment.text.length < indexed.text.length && /[\uD800-\uDBFF]/u.test(segment.text.at(-1)!))) continue;
      const key = `${indexed.target.entryId}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ entryId: indexed.target.entryId, start, end });
    }
    return result;
  }
}
