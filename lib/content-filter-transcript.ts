import { inspectText, screenSegments } from './content-filter';
import { omitVoiceRanges, upsertVoiceEntry, type ConversationEntry, type VoiceConversationUpdate } from './conversation';
import type { StableSegment } from './live-painting';
import type { VoiceTranscriptIndex } from './transcript-omission';

/** Call after indexing the original ASR update; its offsets stay untouched. */
export function filterVoiceTranscript(
  entries: ConversationEntry[],
  update: VoiceConversationUpdate & { segments: readonly StableSegment[] },
  index: VoiceTranscriptIndex,
) {
  const { allowed, blocked } = screenSegments(update.segments);
  // Hide matching hypotheses from display, but only notify/block drawing once
  // ASR commits a stable segment. Do not change ASR or its segment boundaries.
  const partial = inspectText(update.partial).blocked ? '' : update.partial;
  const conversation = omitVoiceRanges(
    upsertVoiceEntry(entries, { ...update, partial }),
    index.targets(blocked),
  );
  return { allowed, blocked, conversation, partial };
}
