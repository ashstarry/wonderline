import { stripAsrSoundEvents } from './speech-annotations';

const hesitation = /^(?:[嗯呃啊]+|(?:u+m+|u+h+|e+r+m*|h+m+)(?:\s+(?:u+m+|u+h+|e+r+m*|h+m+))*)$/iu;
/** Only whole hesitation clauses. Never guess intent or edit a real word.
 * Run before rolling alignment so captions and drawing use the same offsets. */
export function stripStandaloneHesitations(text: string): string {
  // Literal lettering/names/quoted speech take priority over cleanup.
  if (/["“”「」『』`]/u.test(text) || /(?:^|[\s([{])['‘]/u.test(text) || /\b(?:write|spell|text|word|words|label|named|called|says|saying)\b/iu.test(text)
    || /(?:写|寫|名字|叫做|叫作|字样|字樣|说道|說道|喊着|喊著)/u.test(text)) return text;
  let changed = false;
  const cleaned = text.replace(/([^,.;!?，。；！？…\n]+)([,.;!?，。；！？…\n]*)/gu, (whole, clause: string) => {
    if (!hesitation.test(clause.trim())) return whole;
    changed = true; return '';
  });
  return changed ? cleaned.trim() : text;
}
export function cleanExperimentalSpeech(text: string): string {
  return stripStandaloneHesitations(stripAsrSoundEvents(text));
}
