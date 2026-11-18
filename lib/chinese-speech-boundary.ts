/**
 * Chinese-only, local clause boundaries for rolling ASR hypotheses.
 *
 * This does not recognise speech, rewrite words, infer a scene, or schedule work.
 * The caller keeps `pending` across audio-window boundaries and uses its existing
 * committed-prefix alignment/segment IDs to avoid replaying an earlier clause.
 */
export type ChineseBoundaryOptions = {
  /** Acoustic pause; an obviously unfinished relation still stays pending. */
  paused?: boolean;
  /** Explicit microphone stop/provider final flush: never discard a tail. */
  final?: boolean;
  /** Optional provider-guaranteed stable prefix, not its whole draft. */
  settledText?: string;
};

export type ChineseBoundary = {
  committed: string;
  pending: string;
  /** Exact slices, including original punctuation and whitespace. */
  clauses: string[];
  reason: 'final' | 'pause' | 'stable-boundary' | 'pending';
};

const separator = /[\s，。！？；、,.!?;:：]/u;
const word = /[\p{L}\p{N}]/u;
const punctuation = /[，。！？；,.!?;]/u;
const strongPunctuation = /[。！？；.!?;]/u;
const correction = /^(?:不对|不對|不是|不，|不,|错了|錯了|我是说|我是說|应该|應該|改成|换成|換成|而是)/u;
const connector = /^(?:然后|然後|接着|接著|接下来|接下來|另外|还有|還有|而且|并且|並且|但是|不过|不過|所以)/u;
const quantity = '[一二三四五六七八九十两兩几幾百零〇0-9]+';
const classifier = '[个個只隻条條座片颗顆朵辆輛棵间間件双雙对對群本张張些点點块塊位匹头頭栋棟艘架盏盞轮輪扇顶頂支根枚瓶杯滴束团團道排串堆袋盆篮籃碗套节節]';
const bareQuantity = new RegExp(`(?:${quantity}${classifier}|(?:画|畫|有|加|添)${quantity})$`, 'u');
const unfinishedDescription = new RegExp(`${quantity}${classifier}(?:很|非常|特别|特別)?(?:大|小|长|長|短|高|矮|红|紅|蓝|藍|绿|綠|黄|黃|白|黑|紫|粉|橙)(?:色)?$`, 'u');
const directGift = new RegExp(`^(?:给|給).+${quantity}${classifier}.+`, 'u');
const locationPredicate = /(?:画|畫|放|加|添|移|挪|搬|转|轉|站|坐|飞|飛|游|跑|走|有|种|種|建|贴|貼|摆|擺|挂|掛|长|長|住|躺|飘|飄|爬|停)/u;
const locationEnding = /(?:上面|下面|前面|后面|後面|左边|左邊|右边|右邊|旁边|旁邊|里面|裡面|中间|中間|附近|前|后|後|旁|里|裡|内|內|外)$/u;

function withoutConnectors(text: string) {
  let value = text;
  while (connector.test(value)) value = value.replace(connector, '').replace(/^[\s，,]+/u, '');
  return value.replace(/^再(?=在|从|從|往|向)/u, '');
}

function checkText(text: string): string {
  // Ignore hesitation only for the boundary check. The returned transcript is
  // never cleaned or guessed here, so source coordinates remain reliable.
  return text.trim().replace(/[\s，。！？；、,.!?;:：]+$/gu, '')
    .replace(/(?:[，,\s]*(?:嗯+|呃+|额+|額+|唔+|啊+))+$/u, '')
    .replace(/[\s，。！？；、,.!?;:：]+$/gu, '').trim();
}

/** Conservative grammar guard, deliberately not a vocabulary of drawable nouns. */
export function isIncompleteChineseSpeech(text: string): boolean {
  let value = checkText(text);
  if (!word.test(value)) return true;
  value = value.replace(/^(?:(?:嗯+|呃+|额+|額+|唔+|啊+)[，,\s]*)+/u, '');
  if (!word.test(value)) return true;
  const clause = withoutConnectors(value);
  if (/(?:的|得|把|被|让|讓|给|給|向|往|跟|和|与|與|及|在|到|是|有|要|想|用|会|會|能|能够|能夠|可以|喜欢|喜歡|准备|準備|好像|就像|应该像|應該像|看起来像|看起來像|或者|或是|然后|然後|接着|接著|接下来|接下來|而且|并且|並且|但是|因为|因為|所以|还有|還有|另外|拿着|拿著|抱着|抱著|骑着|騎著|戴着|戴著|穿着|穿著|放在|画成|畫成|变成|變成|改成|换成|換成|涂成|塗成|移到|挪到|搬到)$/u.test(value)) return true;
  if (bareQuantity.test(value) || unfinishedDescription.test(value)) return true;
  if (/^(?:(?:我)?(?:想要|想|要)|请|請|帮我|幫我|给我|給我|再|然后|然後|接着|接著)*(?:画|畫|画画|畫畫|画个|畫個|加|添|增加|添加|加上|画上|畫上)$/u.test(value)) return true;
  if (/^(?:然后|然後|接着|接著|再)?(?:把|给|給|让|讓).{1,24}$/u.test(value) && !/(?:画|畫|涂|塗|放|移|挪|搬|变|變|改|换|換|加|添|删|刪|擦|转|轉|缩|縮|站|坐|举|舉|飞|飛|游|跑|走|戴|穿|拿|抱|骑|騎)/u.test(value) && !directGift.test(value)) return true;
  // A connective does not make an unfinished location a separate instruction:
  // "然后在房子" + "旁边画…" must stay one clause. Check grammar after the
  // connective, while retaining every original character in the result.
  if (/^(?:在|从|從|往|向)/u.test(clause)) {
    if (!locationPredicate.test(clause.slice(1))) return true;
    // Verbs can also be characters inside a place/name. The final locative
    // still needs a predicate; an earlier location+predicate permits nesting.
    if (locationEnding.test(clause) && !/(?:上|下|前|后|後|左|右|旁|里|裡|内|內|外|中)(?:边|邊|面|侧|側|间|間)?(?:再)?(?:画|畫|放|加|添|站|坐|飞|飛|游|跑|走|有)/u.test(clause)) return true;
    if (/(?:画|畫|加|添|放|种|種|建|贴|貼|摆|擺|挂|掛)$/u.test(clause)) return true;
  }
  // A noun's locative suffix belongs to that noun, not a fresh component.
  // Subject+在+place is a complete description and remains permitted.
  if (locationEnding.test(clause) && !locationPredicate.test(clause) && !/^[^在]+在/u.test(clause)) return true;
  if (/(?:不|不对|不對|错了|錯了|我是说|我是說)$/u.test(value)) return true;
  // A negative self-repair needs its replacement, unless the caller explicitly
  // finishes; final flush goes through the app's existing clarification path.
  const lastPhrase = value.split(/[，。！？；,.!?;]/u).at(-1)?.trim() ?? value;
  if (/^不是/u.test(lastPhrase) && !/(?:而是|应该|應該|改成|换成|換成)/u.test(lastPhrase)) return true;
  return false;
}

function significant(text: string) {
  const chars: string[] = [], ends: number[] = [];
  let end = 0;
  for (const character of text) {
    end += character.length;
    if (word.test(character)) { chars.push(character.toLowerCase()); ends.push(end); }
  }
  return { chars, ends };
}

function stableEnd(previous: string, current: string, settledText?: string): number {
  const source = significant(current), prior = significant(previous);
  let count = 0;
  while (count < source.chars.length && count < prior.chars.length && source.chars[count] === prior.chars[count]) count++;
  if (settledText) {
    const settled = significant(settledText);
    // A mismatched provider prefix is not a licence to commit different words.
    if (settled.chars.every((character, i) => source.chars[i] === character)) count = Math.max(count, settled.chars.length);
  }
  return source.ends[count - 1] ?? 0;
}

function nextContent(text: string) { return text.replace(/^[\s，。！？；、,.!?;:：]+/u, ''); }

/** Possible structural boundaries. No fixed-length splitting inside a thought. */
function boundaries(text: string): { end: number; strong: boolean; explicit: boolean }[] {
  const candidates = new Map<number, { end: number; strong: boolean; explicit: boolean }>();
  const protectedAt = new Set<number>();
  const closes: string[] = [];
  const pairs: Record<string, string> = { '“': '”', '「': '」', '『': '』', '（': '）', '(': ')', '[': ']', '【': '】', '"': '"' };
  for (let i = 0; i < text.length; i++) {
    if (closes.length) protectedAt.add(i);
    if (text[i] === closes.at(-1)) { closes.pop(); continue; }
    if (pairs[text[i]]) { closes.push(pairs[text[i]]); protectedAt.add(i); continue; }
  }
  for (let i = 0; i < text.length; i++) {
    if (protectedAt.has(i)) continue;
    if (!punctuation.test(text[i])) continue;
    // A decimal/thousands separator is not a sentence boundary.
    if (/[.,，]/u.test(text[i]) && /[0-9]/u.test(text[i - 1] ?? '') && /[0-9]/u.test(text[i + 1] ?? '')) continue;
    let end = i + 1;
    while (end < text.length && separator.test(text[end])) end++;
    candidates.set(end, { end, strong: strongPunctuation.test(text[i]), explicit: false });
    i = end - 1;
  }
  // These are clause starters, not noun guesses. A second imperative can
  // release an earlier object even when the recognizer emits no punctuation.
  const starts = /然后|然後|接着|接著|接下来|接下來|另外|还有|還有|再(?:画|畫|加|添)|(?:请|請|帮我|幫我|给我|給我)?(?:画|畫)(?=[一二三四五六七八九十两兩几幾个個只隻条條座片颗顆朵辆輛棵])|(?:天上|地上|远处|遠處|近处|近處)(?:再)?(?:有|画|畫|加|放)/gu;
  for (const match of text.matchAll(starts)) {
    const at = match.index!;
    if (at > 0 && !protectedAt.has(at)) candidates.set(at, { end: at, strong: false, explicit: true });
  }
  return [...candidates.values()].sort((a, b) => a.end - b.end);
}

function candidateEnds(text: string): number[] {
  const accepted: number[] = [];
  let start = 0;
  for (const candidate of boundaries(text)) {
    const fragment = text.slice(start, candidate.end), tail = nextContent(text.slice(candidate.end));
    if (isIncompleteChineseSpeech(fragment)) continue;
    // Do not split before a predicate attached to a noun's location. This
    // avoids treating "房子旁边" as the object to draw, without a noun list.
    if (candidate.explicit && locationEnding.test(checkText(fragment)) && /^(?:画|畫|加|放)/u.test(tail)) continue;
    // A comma followed by a description of the newly introduced subject
    // is part of the same drawing instruction. Keep strong stops independent.
    if (/[，,]\s*$/u.test(fragment) && /^(?:他|她|它)(?:们|們)?(?:$|[。！？.!?]|是|在|正|会|會|穿|戴|拿|抱|站|坐|跑|走|跳|飞|飛|游|挥|揮|踢)/u.test(tail)) continue;
    // Keep a correction with the phrase it repairs, including ASR commas.
    if (correction.test(tail)) continue;
    // A weak comma at the very end is not evidence of a completed thought.
    if (!candidate.strong && !candidate.explicit && !tail) continue;
    // Do not detach a conjunction from the words it introduces.
    if (connector.test(checkText(fragment)) && !checkText(fragment).replace(connector, '').trim()) continue;
    accepted.push(candidate.end); start = candidate.end;
  }
  return accepted;
}

/** Split already committed text without changing or discarding any characters. */
export function splitChineseSpeechClauses(text: string): string[] {
  const result: string[] = [];
  let start = 0;
  for (const end of candidateEnds(text)) { result.push(text.slice(start, end)); start = end; }
  if (start < text.length) result.push(text.slice(start));
  return result;
}

export function selectChineseSpeechBoundary(previous: string, current: string, options: ChineseBoundaryOptions = {}): ChineseBoundary {
  const answer = (end: number, reason: ChineseBoundary['reason']): ChineseBoundary => {
    const committed = current.slice(0, end);
    return { committed, pending: current.slice(end), clauses: splitChineseSpeechClauses(committed), reason };
  };
  if (options.final) return answer(current.length, 'final');
  if (options.paused && !isIncompleteChineseSpeech(current)) return answer(current.length, 'pause');
  const stable = stableEnd(previous, current, options.settledText);
  const ends = significant(current).ends;
  let selected = 0, token = 0;
  for (const end of candidateEnds(current)) {
    while (token < ends.length && ends[token] <= end) token++;
    const contentEnd = ends[token - 1] ?? 0;
    if (!contentEnd || contentEnd > stable) break;
    const tail = nextContent(current.slice(end));
    // A new terminal full stop invented in one hypothesis is not stable yet.
    // An internal boundary has subsequent speech as additional evidence.
    if (!tail && !options.paused && !options.settledText && !/[。！？；.!?;]\s*$/u.test(previous)) continue;
    selected = end;
  }
  return answer(selected, selected ? 'stable-boundary' : 'pending');
}
