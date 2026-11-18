export type TranscriptRange = { start: number; end: number };
/** UTF-16 coordinates in the original, cumulative stable text of one session. */
export type TranscriptTarget = TranscriptRange & { entryId: string };

const MAX_VOICE_TEXT_LENGTH = 12000;

/** Invalid saved coordinates never become deletion instructions. */
function validatedRanges(value: unknown): TranscriptRange[] {
  if (!Array.isArray(value) || value.length > MAX_VOICE_TEXT_LENGTH) return [];
  const ranges = value.flatMap(range => range && typeof range === 'object' &&
    Number.isInteger(range.start) && Number.isInteger(range.end) &&
    range.start >= 0 && range.end > range.start && range.end <= MAX_VOICE_TEXT_LENGTH
    ? [{ start: range.start as number, end: range.end as number }] : []);
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: TranscriptRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function withoutRanges(text: string, ranges: TranscriptRange[]): string {
  let cursor = 0;
  let result = '';
  for (const range of ranges) {
    result += text.slice(cursor, range.start);
    cursor = range.end;
  }
  return result + text.slice(cursor);
}

/** The conversation is independent from the bounded undo history of the picture. */
export type ConversationEntry = {
  id: string;
  kind: 'voice' | 'text';
  /** Committed ASR text for one session, or the submitted typed message. */
  text: string;
  /** The latest ASR hypothesis. Replace this tail; never append repeated hypotheses. */
  partial: string;
  status: 'listening' | 'saved' | 'unconfirmed';
  createdAt: number;
  updatedAt: number;
  sessionId?: string;
  revision?: number;
  /** Only offsets are retained; discarded words are not persisted elsewhere. */
  omittedRanges?: TranscriptRange[];
};

export type VoiceConversationUpdate = {
  sessionId: string;
  revision: number;
  stableText: string;
  partial: string;
  done: boolean;
};

export const CONVERSATION_STORAGE_KEY = 'softspoken-conversation-v1';

/** One record per microphone session; another session cannot replace earlier words. */
export function upsertVoiceEntry(entries: ConversationEntry[], update: VoiceConversationUpdate, now = Date.now()): ConversationEntry[] {
  if (!update.sessionId || !Number.isInteger(update.revision) || update.revision < 0) return entries;
  const id = `voice:${update.sessionId}`;
  const index = entries.findIndex(entry => entry.id === id);
  const previous = entries[index];
  if (previous && (previous.kind !== 'voice' || previous.status !== 'listening' || update.revision < (previous.revision ?? -1) || (update.revision === previous.revision && !update.done))) return entries;
  // A flush with no new stable text must not erase already committed words.
  const omittedRanges = previous?.omittedRanges;
  // Coordinates always address incoming raw ASR text. An empty flush instead
  // keeps the already-filtered display text, so it must not apply them twice.
  if (update.stableText && previous && omittedRanges?.length) {
    const previousLength = previous.text.length + omittedRanges.reduce((sum, range) => sum + range.end - range.start, 0);
    // A corrupt/revised cumulative prefix cannot reuse old deletion positions.
    if (update.stableText.length < previousLength || withoutRanges(update.stableText.slice(0, previousLength), omittedRanges) !== previous.text) return entries;
  }
  const text = update.stableText ? withoutRanges(update.stableText, omittedRanges ?? []) : previous?.text || '';
  const partial = update.partial;
  if (!previous && !text.trim() && !partial.trim()) return entries;
  const entry: ConversationEntry = {
    id, kind: 'voice', text, partial,
    status: update.done ? (partial.trim() ? 'unconfirmed' : 'saved') : 'listening',
    createdAt: previous?.createdAt ?? now, updatedAt: now,
    sessionId: update.sessionId, revision: update.revision,
    ...(omittedRanges?.length ? { omittedRanges } : {}),
  };
  return index < 0 ? [...entries, entry] : entries.map((current, i) => i === index ? entry : current);
}

/**
 * Remove only confirmed source spans. A queued result may refer to an older
 * sentence or session; it never searches/replaces the latest displayed words.
 * Empty entries remain as tombstones so a later cumulative update cannot
 * resurrect the omitted sentence. The view hides those empty entries.
 */
export function omitVoiceRanges(entries: ConversationEntry[], targets: readonly TranscriptTarget[], now = Date.now()): ConversationEntry[] {
  let changed = false;
  const result = entries.map(entry => {
    if (entry.kind !== 'voice') return entry;
    const previous = validatedRanges(entry.omittedRanges);
    const originalLength = entry.text.length + previous.reduce((sum, range) => sum + range.end - range.start, 0);
    const requested = validatedRanges(targets.filter(target => target && target.entryId === entry.id))
      .filter(range => range.end <= originalLength);
    if (!requested.length) return entry;
    const merged = validatedRanges([...previous, ...requested]);
    if (JSON.stringify(merged) === JSON.stringify(previous)) return entry;

    // Translate only newly removed intervals into the filtered string's space.
    // This avoids masking an already-filtered prefix for a second time.
    const visible: TranscriptRange[] = [];
    for (const range of requested) {
      let cursor = range.start;
      let hiddenBefore = 0;
      for (const hidden of previous) {
        if (hidden.end <= cursor) { hiddenBefore += hidden.end - hidden.start; continue; }
        if (hidden.start >= range.end) break;
        if (hidden.start > cursor) visible.push({ start: cursor - hiddenBefore, end: Math.min(hidden.start, range.end) - hiddenBefore });
        cursor = Math.max(cursor, hidden.end);
        hiddenBefore += hidden.end - hidden.start;
        if (cursor >= range.end) break;
      }
      if (cursor < range.end) visible.push({ start: cursor - hiddenBefore, end: range.end - hiddenBefore });
    }
    changed = true;
    return { ...entry, text: withoutRanges(entry.text, validatedRanges(visible)), omittedRanges: merged, updatedAt: now };
  });
  return changed ? result : entries;
}

/** Caller owns a stable submission ID so retries do not duplicate a typed message. */
export function appendTextEntry(entries: ConversationEntry[], text: string, id: string, now = Date.now()): ConversationEntry[] {
  if (!text.trim() || !id || entries.some(entry => entry.id === id)) return entries;
  return [...entries, { id, kind: 'text', text, partial: '', status: 'saved', createdAt: now, updatedAt: now }];
}

/** Cancel/error keeps the heard words, including the unconfirmed tail, on the page. */
export function interruptVoiceEntry(entries: ConversationEntry[], sessionId?: string, now = Date.now()): ConversationEntry[] {
  let changed = false;
  const result = entries.map(entry => {
    if (entry.kind !== 'voice' || entry.status !== 'listening' || (sessionId && entry.sessionId !== sessionId)) return entry;
    changed = true;
    return { ...entry, status: 'unconfirmed' as const, updatedAt: now };
  });
  return changed ? result : entries;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readEntry(value: unknown): ConversationEntry | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id || (value.kind !== 'voice' && value.kind !== 'text') || typeof value.text !== 'string') return null;
  const partial = typeof value.partial === 'string' ? value.partial : '';
  const candidates = value.kind === 'voice' ? validatedRanges(value.omittedRanges) : [];
  let omittedRanges = candidates;
  for (;;) {
    const originalLength = value.text.length + omittedRanges.reduce((sum, range) => sum + range.end - range.start, 0);
    const valid = omittedRanges.filter(range => range.end <= originalLength);
    if (valid.length === omittedRanges.length) break;
    omittedRanges = valid;
  }
  if (!value.text.trim() && !partial.trim() && !omittedRanges.length) return null;
  const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : 0;
  const updatedAt = typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;
  const status = value.kind === 'text' ? 'saved' : value.status === 'saved' && !partial.trim() ? 'saved' : 'unconfirmed';
  return {
    id: value.id, kind: value.kind, text: value.text, partial, status, createdAt, updatedAt,
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(Number.isInteger(value.revision) && Number(value.revision) >= 0 ? { revision: Number(value.revision) } : {}),
    ...(omittedRanges.length ? { omittedRanges } : {}),
  };
}

const legacySystemPhrases = new Set(['从湖边开始', '换一张空白纸', '重新从湖边开始', '自己画了一笔', '手画了一笔', '手绘一笔', '擦掉一笔', '我自己用画笔添了一笔', '我用橡皮擦掉了自己的笔触']);

function migrateLegacyHistory(history: unknown): ConversationEntry[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((entry, index) => {
    if (!record(entry) || typeof entry.phrase !== 'string' || !entry.phrase.trim() || legacySystemPhrases.has(entry.phrase.trim()) || entry.kind === 'manual' || entry.source === 'manual') return [];
    return [{ id: `legacy:${index}`, kind: 'text' as const, text: entry.phrase, partial: '', status: 'saved' as const, createdAt: index, updatedAt: index }];
  });
}

/**
 * Restore all valid words without a history-length or string-length truncation.
 * Optional archived batches are flattened back into the same chronological log.
 * A page reload cannot resume an old microphone: its draft remains unconfirmed.
 */
export function restoreConversation(raw: unknown, legacyHistory: unknown = []): ConversationEntry[] {
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return migrateLegacyHistory(legacyHistory); }
  }
  const current = Array.isArray(value) ? value : record(value) && Array.isArray(value.entries) ? value.entries : null;
  const archived = record(value) && Array.isArray(value.archived) ? value.archived.flatMap(batch => Array.isArray(batch) ? batch : record(batch) && Array.isArray(batch.entries) ? batch.entries : []) : [];
  if (!current && !archived.length) return migrateLegacyHistory(legacyHistory);
  const entries: ConversationEntry[] = [];
  const byId = new Map<string, number>();
  for (const candidate of [...archived, ...(current ?? [])]) {
    const entry = readEntry(candidate);
    if (!entry) continue;
    const index = byId.get(entry.id);
    if (index === undefined) { byId.set(entry.id, entries.length); entries.push(entry); }
    else {
      const old = entries[index];
      // Archived and active records may overlap at the boundary. Prefer the
      // newest cumulative copy; an empty flush cannot erase committed words.
      if ((entry.revision ?? -1) > (old.revision ?? -1) || ((entry.revision ?? -1) === (old.revision ?? -1) && entry.updatedAt >= old.updatedAt)) {
        // An intentionally empty tombstone is authoritative. When overlapping
        // storage batches differ, carry omissions forward into the newer copy.
        const winner = entry.text || entry.omittedRanges?.length ? entry : { ...entry, text: old.text, ...(old.omittedRanges?.length ? { omittedRanges: old.omittedRanges } : {}) };
        entries[index] = omitVoiceRanges([winner], (old.omittedRanges ?? []).map(range => ({ entryId: entry.id, ...range })), winner.updatedAt)[0];
      } else if (entry.omittedRanges?.length) {
        entries[index] = omitVoiceRanges([old], entry.omittedRanges.map(range => ({ entryId: old.id, ...range })), old.updatedAt)[0];
      }
    }
  }
  return entries;
}

/** Storage failures are intentionally thrown so the UI can report them. */
export function serializeConversation(entries: ConversationEntry[]): string {
  return JSON.stringify({ version: 1, entries });
}

function instructionChunks(text: string): string[] {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?\n]*|[。！？!?\n]+/gu) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    let remainder = sentence.trim();
    if (!remainder) continue;
    if (current && current.length + remainder.length + 1 > 600) { chunks.push(current); current = ''; }
    while (remainder.length > 600) {
      // Keep UTF-16 surrogate pairs intact while respecting the API limit.
      const end = /[\uD800-\uDBFF]/.test(remainder[599]) ? 599 : 600;
      chunks.push(remainder.slice(0, end)); remainder = remainder.slice(end);
    }
    current = current ? `${current}\n${remainder}` : remainder;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Only the API context is bounded; the displayed/persisted conversation is not. */
export function recentInstructions(entries: ConversationEntry[]): string[] {
  const recent: string[] = [];
  for (let i = entries.length - 1; i >= 0 && recent.length < 5; i--) {
    const chunks = instructionChunks(entries[i].text);
    recent.unshift(...chunks.slice(-(5 - recent.length)));
  }
  return recent;
}
