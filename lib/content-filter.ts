// Deliberately small English word/phrase rules, not a semantic classifier.
// Keep matching separate from ASR and drawing generation; no model calls.
const whole = (source: string) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`, 'iu');
const RULES: readonly [string, RegExp][] = [
  ['profanity', whole('fuck(?:ing|ed|er|ers|s)?|motherfuck(?:er|ers|ing)?|shit(?:s|ty|ting)?|bullshit|bitch(?:es|y)?|asshole(?:s)?|dickhead(?:s)?|bastard(?:s)?')],
  ['directed-abuse', whole("you(?:\\s+are|'re)\\s+(?:an?\\s+)?(?:idiot|moron|stupid|dumb|loser)|shut\\s+up|i\\s+hate\\s+you|kill\\s+yourself")],
  ['explicit-term', whole('porn(?:ography|ographic)?')],
];

export const CONTENT_BLOCKED_MESSAGE = 'This content was blocked as inappropriate.';

export function inspectText(text: string): { blocked: boolean; rule: string | null } {
  // Normalization affects matching only. Allowed words pass through unchanged.
  const normalized = text.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/gu, '').replace(/[’‘]/gu, "'");
  for (const [rule, pattern] of RULES) {
    if (pattern.test(normalized)) return { blocked: true, rule };
  }
  return { blocked: false, rule: null };
}

export function screenSegments<T extends { text: string }>(segments: readonly T[]) {
  const allowed: T[] = [], blocked: T[] = [];
  for (const segment of segments) (inspectText(segment.text).blocked ? blocked : allowed).push(segment);
  return { allowed, blocked };
}
