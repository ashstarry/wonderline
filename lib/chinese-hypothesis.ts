/** Chinese experiment only: align transcript revisions without guessing words. */
const letter = /[\p{L}\p{N}]/u;
const trimBoundary = (text: string) => text.replace(/^[\s，。！？；,.!?;]+/u, '');
function significant(text: string) {
  let at = 0;
  const chars: string[] = [], starts: number[] = [], ends: number[] = [];
  for (const character of text) {
    if (letter.test(character)) { chars.push(character.toLowerCase()); starts.push(at); ends.push(at + character.length); }
    at += character.length;
  }
  return { chars: chars.join(''), starts, ends };
}

/** Unlike fuzzy edit alignment, this cannot turn a new 小狗 instruction into 狗. */
export function stripChineseCommitted(text: string, committed: string): string | undefined {
  const prefix = significant(committed).chars, current = significant(text);
  if (!prefix) return trimBoundary(text);
  if (!current.chars.startsWith(prefix)) return undefined;
  return trimBoundary(text.slice(current.ends[prefix.length - 1]));
}

export type ChineseHypothesisBranch = 'initial' | 'empty-retained' | 'cumulative' | 'known-suffix' | 'committed-retained' | 'confirmed-prefix-only' | 'revision';
export function reconcileChineseHypothesis(previous: string, incoming: string, committed: string) {
  const answer = (text: string, branch: ChineseHypothesisBranch) => ({ text, branch });
  if (!incoming.trim()) return answer(previous, 'empty-retained');
  if (!previous) return answer(incoming, 'initial');
  const before = significant(previous), next = significant(incoming), frozen = significant(committed);
  if ((frozen.chars && next.chars.startsWith(frozen.chars)) || next.chars.startsWith(before.chars)) return answer(incoming, 'cumulative');
  // A retained suffix can identify a truncated re-decode. Reuse only exact
  // characters already seen, never a semantic similarity or an entity list.
  // Four characters avoids treating incidental short noun endings as evidence.
  for (let length = Math.min(before.chars.length, next.chars.length, 160); length >= 4; length--) {
    if (!before.chars.endsWith(next.chars.slice(0, length))) continue;
    const combined = previous.slice(0, before.starts[before.chars.length - length]) + incoming;
    if (!frozen.chars || stripChineseCommitted(combined, committed) !== undefined) return answer(combined, 'known-suffix');
  }
  if (frozen.chars) {
    // A recognizer may briefly return only an earlier confirmed prefix. That
    // does not erase the later draft or duplicate the confirmed instruction.
    if (frozen.chars.startsWith(next.chars)) return answer(previous, 'confirmed-prefix-only');
    // Frozen speech is immutable. An unmatched candidate stays WHOLE in the
    // provisional suffix and still needs the ordinary stability/pause rules.
    return answer(committed + incoming, 'committed-retained');
  }
  // With no acoustic boundary or confirmed prefix, A -> B could be a genuine
  // ASR correction. Do not invent certainty by blindly appending every draft.
  return answer(incoming, 'revision');
}
