import { inspectText } from './content-filter';

export type CompanionNameRef = { id: string; name: string };
export type CompanionSaveIntent = { kind: 'save'; name: string; target?: string };
export type CompanionRecallIntent = { companionId: string; pure: boolean };

// These are complete local commands, not an interpretation of ordinary storytelling.
// In particular, an unrecognised suffix must keep the whole utterance on its usual path.
const normalize = (text: string) => text.normalize('NFKC').replace(/[’‘]/gu, "'").replace(/\s+/gu, ' ').trim();
const statement = (text: string) => normalize(text).replace(/[.!?。！？]+$/u, '').trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const WORD = /[\p{L}\p{N}_]/u;
const HAN = /\p{Script=Han}/u;
const PRONOUN = /^(?:he|she|it|they|him|her|them|this|that|this one|that one|他|她|它|他们|她们|它们|这个|那个|这一个|那一个)$/iu;
const NAME_COMMAND = /(?:\b(?:and|or|but|not|no|then|draw|paint|add|bring|make|put|move|save|remember|call|name|is|are|was|with|beside|behind|near|please|actually|instead|it|her|him|them|who|which|that|lives|goes|swims|wears|has|wants)\b|然后|接着|再画|再加|不对|不是|不要|改成|改叫|应该|但是|可是|以及|并且|旁边|后面|前面|里面|上面|下面|画一|画个|记住|保存|叫作|叫做|起名|名字|好吗|好不好|喜欢|穿着|戴着|住在|去了|想要|它在|他在|她在)/iu;

function nameValue(raw: string, strict = false): string | null {
  let name = normalize(raw);
  const paired = /^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|「([^」]+)」|『([^』]+)』)$/u.exec(name);
  if (paired) name = paired.slice(1).find(Boolean)!.trim();
  if (!name || name.length > 24 || name.split(' ').length > 3) return null;
  // Unquoted multiword English names must look like names, not an unfinished clause.
  if (strict && !paired && name.includes(' ') && !name.split(' ').every(word => /^\p{Lu}/u.test(word))) return null;
  if (!/^[\p{L}\p{M}\p{N}]+(?:[ '\-][\p{L}\p{M}\p{N}]+)*$/u.test(name)) return null;
  if (!/\p{L}/u.test(name) || PRONOUN.test(name) || NAME_COMMAND.test(name) || inspectText(name).blocked) return null;
  return name;
}

// Supplied names already belong to a saved companion. They need the library's
// lexical safety checks, not the stricter grammar used to extract a new name.
function storedNameValue(raw: string): string | null {
  const name = normalize(raw);
  if (!name || name.length > 24 || !/^[\p{L}\p{N}\p{M} .'\-]+$/u.test(name) || !/[\p{L}\p{N}]/u.test(name) || inspectText(name).blocked) return null;
  return name;
}

function targetValue(raw?: string): string | undefined {
  if (!raw) return undefined;
  const normalized = normalize(raw);
  if (PRONOUN.test(normalized)) return undefined;
  const target = normalized.replace(/^(?:(?:the|a|an|this|that|my|our)\s+)/iu, '')
    .replace(/^(?:(?:这|那)(?:一)?(?:只|个|位|条)|(?:我的|我们的))/u, '').trim();
  return PRONOUN.test(target) ? undefined : target || undefined;
}

function save(name: string, target?: string): CompanionSaveIntent | null {
  const value = nameValue(name, true);
  if (!value) return null;
  if (target && /^(?:the|a|an|my|our)$/iu.test(normalize(target))) return null;
  const subject = targetValue(target);
  if (subject && (subject.length > 48 || /[,.!?。！？;；]/u.test(subject) || NAME_COMMAND.test(subject) || inspectText(subject).blocked)) return null;
  return subject ? { kind: 'save', name: value, target: subject } : { kind: 'save', name: value };
}

/** Explicit naming/saving only. Never consumes `draw a bear named Coco` or a story suffix. */
export function parseCompanionSave(text: string): CompanionSaveIntent | null {
  if (text.length > 256 || inspectText(text).blocked) return null;
  let input = statement(text).replace(/^please\s+/iu, '').replace(/^请/u, '');
  input = input.replace(/(?:[,.]\s*|\s+and\s+)(?:remember|save)\s+(?:him|her|it|them|this(?: one)?)$/iu, '').trim();
  input = input.replace(/[，,。]\s*(?:把(?:它|他|她|这个)(?:记住|保存下来|存起来)|记住(?:它|他|她)|保存(?:它|他|她))$/u, '').trim();

  let match = /^(?:his|her|its|their) name is (.+)$/iu.exec(input);
  if (match) return save(match[1]);
  match = /^(?:remember|save) (.+?) as (.+)$/iu.exec(input);
  if (match) return save(match[2], match[1]);
  match = /^(.+?)'s name is (.+)$/iu.exec(input);
  if (match) return save(match[2], match[1]);
  match = /^(.+?) is called (.+)$/iu.exec(input);
  if (match) return save(match[2], match[1]);
  // The single last token is the name; quoted multiword names make the split explicit.
  match = /^(?:name|call) (.+?) ("[^"]+"|'[^']+'|“[^”]+”|[^\s]+)$/iu.exec(input);
  if (match) return save(match[2], match[1]);

  match = /^(?:把|给)?(.+?)(?:起名(?:叫|为)?|命名为|叫作|叫做|的名字(?:叫|是)|叫)(.+)$/u.exec(input);
  if (match) return save(match[2], match[1]);
  match = /^把(.+?)(?:保存为|记作)(.+)$/u.exec(input);
  if (match) return save(match[2], match[1]);
  return null;
}

function mentionOffsets(text: string, name: string): number[] {
  const haystack = normalize(text).toLocaleLowerCase('en-US');
  const needle = normalize(name).toLocaleLowerCase('en-US');
  if (!needle || !storedNameValue(name)) return [];
  const offsets: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const before = [...haystack.slice(0, at)].at(-1) || '';
    const after = [...haystack.slice(at + needle.length)][0] || '';
    if (!HAN.test(needle)) {
      // Chinese clauses do not put spaces around a child's English name.
      // Other letter/number neighbours still protect Ann from Anna or planet.
      if ((!WORD.test(before) || HAN.test(before)) && (!WORD.test(after) || HAN.test(after))) offsets.push(at);
    } else if ((!WORD.test(before) || HAN.test(before)) && (!WORD.test(after) || HAN.test(after))) {
      // Chinese has no spaces. Multi-character names can be found in connected speech;
      // one-character names need a complete command, to avoid matching everyday words.
      if ([...needle].length > 1 || isPureRecall(haystack, needle)) offsets.push(at);
    }
    from = at + needle.length;
  }
  return offsets;
}

/** Mentions are hints only: callers must keep the complete original story sentence. */
export function findCompanionMentions(text: string, companions: readonly CompanionNameRef[]): CompanionNameRef[] {
  if (text.length > 12000) return [];
  const seen = new Set<string>();
  let coverStart = -1, coverEnd = -1;
  return companions.filter(companion => !!companion.id)
    .flatMap(companion => mentionOffsets(text, companion.name).map(at => ({ companion, at, end: at + normalize(companion.name).length })))
    .sort((a, b) => a.at - b.at || b.end - a.end)
    // A saved Luna-Rose must not also summon Luna. Exact duplicate names remain
    // ambiguous; a separate later mention of Luna is still included.
    .filter(({ at, end }) => {
      if (at >= coverStart && end <= coverEnd && (at > coverStart || end < coverEnd)) return false;
      if (end > coverEnd) { coverStart = at; coverEnd = end; }
      return true;
    })
    .filter(({ companion }) => !seen.has(companion.id) && !!seen.add(companion.id))
    .map(({ companion }) => ({ id: companion.id, name: companion.name }));
}

function isPureRecall(text: string, name: string): boolean {
  const input = statement(text);
  const escaped = escape(normalize(name));
  return new RegExp(`^(?:please\\s+)?(?:draw|bring|add|show|invite)\\s+${escaped}(?:\\s+(?:here|back|please|on the page|onto the page|to (?:the|this) (?:page|picture)))?$`, 'iu').test(input)
    || new RegExp(`^(?:please\\s+)?bring back ${escaped}$`, 'iu').test(input)
    || new RegExp(`^(?:please\\s+)?let ${escaped} come(?: here)?$`, 'iu').test(input)
    || new RegExp(`^${escaped},? come here(?: please)?$`, 'iu').test(input)
    || new RegExp(`^(?:请)?(?:画(?:出|上)?|带上|带来|召唤|加上)${escaped}(?:吧)?$`, 'iu').test(input)
    || new RegExp(`^(?:请)?(?:让|叫|请)${escaped}(?:来|过来|出来|回来|来这里|到这里|来到这里|来画里|来画上|来这张纸上|出现)(?:吧)?$`, 'iu').test(input);
}

/** Only one unambiguous saved companion can be inserted locally. */
export function parseCompanionRecall(text: string, companions: readonly CompanionNameRef[]): CompanionRecallIntent | null {
  if (inspectText(text).blocked) return null;
  if (/(?:\b(?:don't|do not|never|without|remove|delete|erase|hide|forget|no longer)\b|不要|别画|不用|不想|没有|删除|删掉|擦掉|移除|藏起|忘记|去掉|消失)/iu.test(normalize(text))) return null;
  const mentions = findCompanionMentions(text, companions);
  if (mentions.length !== 1) return null;
  return { companionId: mentions[0].id, pure: isPureRecall(text, mentions[0].name) };
}

/** A local inspiration card request, never a trigger inside an ordinary story. */
export function parseCompanionIdeaRequest(text: string): boolean {
  const input = statement(text);
  return /^(?:please )?(?:give me|show me|suggest) (?:a|an|another) (?:story idea|idea for a story|story starter)(?: please)?$/iu.test(input)
    || /^(?:please )?(?:another idea|one more idea)(?: please)?$/iu.test(input)
    || /^(?:请)?(?:给我|来|再来)(?:一|另一个|一个新的)?(?:个)?(?:故事灵感|灵感|故事点子)(?:吧)?$/u.test(input);
}

/** A following ASR clause may contain only the second half of a naming request. */
export function parseCompanionRemember(text: string): boolean {
  const input = statement(text);
  return /^(?:please )?(?:remember|save) (?:him|her|it|them|this(?: one)?|that(?: one)?)(?: please)?$/iu.test(input)
    || /^(?:请)?(?:(?:记住|保存)(?:它|他|她|这个)|把(?:它|他|她|这个)(?:记住|保存下来|存起来))(?:吧)?$/u.test(input);
}
