import type { Scene } from './scene';
import { omitVoiceRanges, type ConversationEntry, type TranscriptTarget } from './conversation';

export const ROLLED_BACK_DRAWING_MESSAGE = '这一句已撤回，可以接着说新想法。';

/** Restore the committed scene, not a snapshot of provisional pixels. Unchanged
 * strokes keep playing; the renderer erases only the discarded turn's changes.
 * Call only while the request still owns the preview and validate source ranges
 * first. Use the latest transcript so newer speech is never rolled back. */
export function rollbackDrawingTurn(committed: Scene, conversation: ConversationEntry[], targets: readonly TranscriptTarget[], typedEntryId?: string) {
  return {
    scene: committed,
    conversation: typedEntryId
      ? conversation.filter(entry => entry.kind !== 'text' || entry.id !== typedEntryId)
      : omitVoiceRanges(conversation, targets),
  };
}
