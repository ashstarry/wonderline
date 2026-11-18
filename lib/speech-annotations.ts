// These are ASR sound-event labels, not words to remove from spoken sentences.
// Keep the allowlist finite: an unfamiliar annotation is safer to leave intact.
const SOUND_EVENTS = new Set([
  'music', 'background music', 'intro music', 'outro music', 'intro jingle', 'outro jingle',
  'jingle', 'instrumental', 'instrumental music', 'soft music', 'music playing', 'background music playing', 'on hold music', 'hold music',
  'applause', 'clapping', 'laughter', 'laugh', 'laughs', 'laughing',
  'cough', 'coughs', 'coughing', 'sneeze', 'sneezes', 'sneezing',
  'throat clear', 'throat clearing', 'clears throat', 'clearing throat',
  'footsteps', 'breathing', 'inhales', 'exhales', 'sigh', 'sighs', 'sighing',
  'smacks lips', 'lip smack', 'lip smacking', 'lips smacking',
  'silence', 'noise', 'background noise', 'static', 'rustling', 'humming', 'whistling',
  '音乐', '背景音乐', '片头音乐', '片尾音乐', '片头曲', '片尾曲', '器乐',
  '掌声', '鼓掌', '笑声', '大笑', '咳嗽', '咳嗽声', '打喷嚏', '喷嚏声',
  '清嗓', '清嗓子', '清嗓声', '脚步声', '呼吸声', '吸气', '呼气', '叹气', '叹息',
  '咂嘴', '咂嘴声', '杂音', '噪声', '背景噪声', '背景杂音', '沙沙声', '哼唱', '口哨声',
]);
const MAX_LABEL_LENGTH = 80;
const CLOSERS: Record<string, string> = { '[': ']', '(': ')', '【': '】', '（': '）' };
const QUOTES: Record<string, string> = { '"': '"', "'": "'", '`': '`', '“': '”', '‘': '’', '「': '」', '『': '』' };
const asciiWord = (character: string) => /[A-Za-z0-9_]/.test(character);
const chinese = (character: string) => /\p{Script=Han}/u.test(character);
const normalizeLabel = (label: string) => label.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
const LABEL_PREFIXES = new Set<string>();
for (const label of SOUND_EVENTS) {
  // One or two Latin letters are too ambiguous to hide while a hypothesis grows.
  for (let length = chinese(label[0]) ? 2 : 3; length <= label.length; length++) LABEL_PREFIXES.add(label.slice(0, length));
}

function isLiteralContext(text: string, start: number) {
  // Explicit requests to write/quote a label must survive, even without quotes.
  // Only inspect a bounded fragment of this clause; do not infer drawing intent.
  const prefix = text.slice(Math.max(0, start - 120), start).split(/[.!?。！？;；\n]/).at(-1) ?? '';
  return /\b(?:write|writing|spell|spelling|type|typing|label|labelled|labeled|word|words|text|quote|quoted|bracket|brackets|literal|literally|named|called)\b/i.test(prefix)
    || /(?:写上|写出|写着|写下|写个|写一个|文字|字样|标注|叫做|名字|括号|引号|字母)/.test(prefix);
}

/** Strip explicit sound labels before rolling hypotheses establish transcript offsets. */
export function stripAsrSoundEvents(text: string): string {
  const removals: { start: number; end: number }[] = [];
  let quote = '', escaped = false;
  let bracket: { start: number; stack: string[]; nested: boolean; literal: boolean } | undefined;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (bracket) {
      if (CLOSERS[character]) { bracket.nested = true; bracket.stack.push(CLOSERS[character]); }
      else if (character === bracket.stack.at(-1)) {
        bracket.stack.pop();
        if (!bracket.stack.length) {
          if (!bracket.nested && !bracket.literal && index - bracket.start - 1 <= MAX_LABEL_LENGTH
            && SOUND_EVENTS.has(normalizeLabel(text.slice(bracket.start + 1, index)))) {
            removals.push({ start: bracket.start, end: index + 1 });
          }
          bracket = undefined;
        }
      }
      continue;
    }
    if (quote) {
      if (character === quote && !escaped) quote = '';
      escaped = character === '\\' && !escaped;
      continue;
    }
    if (QUOTES[character] && !((character === "'" || character === '‘') && /[\p{L}\p{N}]/u.test(text[index - 1] ?? ''))) {
      quote = QUOTES[character]; escaped = false; continue;
    }
    if (CLOSERS[character]) bracket = { start: index, stack: [CLOSERS[character]], nested: false, literal: isLiteralContext(text, index) };
  }
  // Rolling ASR replaces this hypothesis on its next response. Suppress only a
  // recognizable unfinished label now; never wait for more audio or another call.
  if (bracket && !bracket.nested && !bracket.literal && text.length - bracket.start - 1 <= MAX_LABEL_LENGTH
    && LABEL_PREFIXES.has(normalizeLabel(text.slice(bracket.start + 1)))) {
    removals.push({ start: bracket.start, end: text.length });
  }
  if (!removals.length) return text;

  const spans: { start: number; end: number; spaced: boolean }[] = [];
  for (const removal of removals) {
    let { start, end } = removal;
    while (start > 0 && /\s/.test(text[start - 1])) start--;
    while (end < text.length && /\s/.test(text[end])) end++;
    const spaced = start !== removal.start || end !== removal.end;
    const previous = spans.at(-1);
    if (previous && start <= previous.end) { previous.end = Math.max(previous.end, end); previous.spaced ||= spaced; }
    else spans.push({ start, end, spaced });
  }
  const chunks: string[] = []; let from = 0;
  for (const { start, end, spaced } of spans) {
    chunks.push(text.slice(from, start));
    const before = text[start - 1] ?? '', after = text[end] ?? '';
    if (before && after && (asciiWord(before) && asciiWord(after)
      || spaced && !chinese(before) && !chinese(after) && !/[,.;:!?，。；：！？)\]】）]/.test(after) && !/[(\[【（]/.test(before))) chunks.push(' ');
    from = end;
  }
  chunks.push(text.slice(from));
  const cleaned = chunks.join('');
  return /^[\s.,!?;:，。！？；：…\-–—]*$/.test(cleaned) ? '' : cleaned;
}
