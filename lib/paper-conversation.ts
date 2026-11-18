import { type ConversationEntry, restoreConversation } from './conversation';

export const LEGACY_PAPER_ID = 'legacy-paper';

export function paperIdFor(entry: { paperId?: string } | undefined): string {
  return typeof entry?.paperId === 'string' && entry.paperId.trim() ? entry.paperId.trim() : LEGACY_PAPER_ID;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Paper selection follows the restored drawing cursor, not a stale active-log pointer. */
export function restorePaperConversations(
  raw: string | null,
  legacyHistory: unknown,
  selectedPaperId: string,
): { papers: Map<string, ConversationEntry[]>; entries: ConversationEntry[] } {
  const selected = paperIdFor({ paperId: selectedPaperId });
  const papers = new Map<string, ConversationEntry[]>();
  let value: unknown = null;
  try { value = raw === null ? null : JSON.parse(raw); } catch {}

  if (record(value) && value.version === 2) {
    if (record(value.papers)) {
      for (const [id, entries] of Object.entries(value.papers)) {
        if (id.trim() && Array.isArray(entries)) papers.set(id, restoreConversation({ entries }));
      }
    }
    // Keep the v1-compatible active log usable if its map entry is absent.
    // An explicitly empty map entry is authoritative and must not be replaced.
    const active = paperIdFor({ paperId: typeof value.paperId === 'string' ? value.paperId : undefined });
    if (!papers.has(active) && Array.isArray(value.entries)) papers.set(active, restoreConversation({ entries: value.entries }));
  } else if (Array.isArray(value) || (record(value) && (Array.isArray(value.entries) || Array.isArray(value.archived)))) {
    // Old logs predate paper IDs. Never attach their words to a newer blank paper.
    papers.set(LEGACY_PAPER_ID, restoreConversation(value, legacyHistory));
  } else {
    // Missing/corrupt storage can recover the phrases still in drawing history.
    // Group first so recovery cannot carry words across a known paper boundary.
    const groups = new Map<string, unknown[]>();
    for (const entry of Array.isArray(legacyHistory) ? legacyHistory : []) {
      if (!record(entry)) continue;
      const id = paperIdFor({ paperId: typeof entry.paperId === 'string' ? entry.paperId : undefined });
      const group = groups.get(id) ?? [];
      group.push(entry); groups.set(id, group);
    }
    for (const [id, entries] of groups) papers.set(id, restoreConversation(null, entries));
  }

  if (!papers.has(selected)) papers.set(selected, []);
  return { papers, entries: papers.get(selected)! };
}

/** Keep logs reachable through undo/redo, without mutating the live map. */
export function serializePaperConversations(
  papers: Map<string, ConversationEntry[]>,
  activePaperId: string,
  entries: ConversationEntry[],
  retainedPaperIds: string[],
): string {
  const active = paperIdFor({ paperId: activePaperId });
  const ids = new Set([...retainedPaperIds.map(paperId => paperIdFor({ paperId })), active]);
  const retained = [...ids].map(id => [id, id === active ? entries : papers.get(id) ?? []] as const);
  return JSON.stringify({ version: 2, paperId: active, entries, papers: Object.fromEntries(retained) });
}
