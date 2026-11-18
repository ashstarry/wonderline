import type { SceneObject } from './scene';

const CHARACTER_KINDS = new Set(['person', 'cat']);

// The child decides what can be a friend: a moon or a house is as valid as a
// bear. This UI hint excludes only recognizable environmental regions, not a
// fixed list of character species. Unknown free drawings remain available.
const EN_SCENERY = /\b(?:background|backdrop|landscape|scenery|sky|skies|ocean(?:\s+waves)?|sea(?:\s+waves)?|water|lake|river|pond|grass|meadow|ground|soil|dirt|mud|field|forest|woods|mountain[-\s]+range|mountains|shore|beach|terrain|horizon|road|path|desert|sand|coast)s?$/i;
const ZH_SCENERY = /(?:背景|风景|景色|远景|天空|夜空|星空|海洋|大海|海面|湖泊|湖面|河流|水面|草地|草坪|地面|泥土|土壤|泥地|泥巴|淤泥|土地|田野|森林|树林|群山|山脉|湖岸|河岸|岸边|海滩|沙滩|地形|地平线|道路|小路|沙漠|沙地|海岸)$/u;
const EXPLICIT_BACKGROUND = /^(?:(?:a|an|the)\s+)?(?:background|backdrop|scenery)\b|^(?:背景|底景|远景)(?:[:：\s-]|$)/iu;

function descriptor(object: SceneObject): string {
  const label = typeof object.label === 'string' ? object.label : '';
  const separator = label.indexOf(' · ');
  return (separator < 0 ? label : label.slice(separator + 3)).normalize('NFKC').trim();
}

function subjectPhrase(label: string): string {
  // Look at the named subject, not scenery mentioned after it: “a bear beside a
  // forest” and “森林里的小熊” must remain eligible. Chinese locative prefixes
  // naturally stay intact; the noun at their end is the subject.
  return label.split(/[,;.!?，。；！？([（【]|\s+(?:beside|behind|above|below|under|underneath|beneath|near|around|among|next\s+to|in\s+front\s+of|in|on|at|inside|outside|surrounded\s+by|with|full\s+of|named|called)\b|(?:站在|坐在|躺在|住在|在|旁边有|后面有|前面有|身边有)/iu)[0].trim();
}

function withoutRenderingSuffix(subject: string): string {
  // “Sky wash” and “bear outline” describe how a subject was rendered, not a
  // different kind of subject. Strip only trailing generic paint terminology.
  let previous: string;
  do {
    previous = subject;
    subject = subject.replace(/(?:\s+|[-_:])(?:wash|fill|layer|surface|gradient|band|outline|texture|shading|region|area|patch)s?$|(?:色块|底色|轮廓|图层|区域|渐变|纹理)$/iu, '').trim();
  } while (subject !== previous);
  return subject;
}

function hasCharacterDescription(label: string, subject: string): boolean {
  // Explicitly personified scenery is a character too. Do not treat a forest
  // merely “with a smiling bear” as though the forest itself had a face.
  return /^(?:(?:a|the)\s+)?(?:princess|prince|queen|king|captain)\b/i.test(subject)
    || /\b(?:smiling|laughing|talking|walking|dancing|friendly|character|anthropomorphic|personified)\b/i.test(subject)
    || /(?:会说话|会走路|会跳舞|微笑|笑脸|拟人|小精灵|角色)/u.test(subject)
    || /\b(?:has\s+(?:a\s+)?face|with\s+(?:a\s+)?(?:(?:smiling|happy|friendly)\s+)?face)\b/i.test(label)
    || /(?:长着|有着|带着|带有|有)(?:一张)?(?:笑脸|脸庞|脸蛋|脸)/u.test(label);
}

/** UI-only eligibility for choosing a saved story companion. Does not alter
 * scene data, voice naming/recall, drawing generation, or existing companions. */
export function isCompanionCandidate(object: SceneObject): boolean {
  if (!object || typeof object.id !== 'string' || object.id.startsWith('hand-')) return false;
  if (object.kind === 'drawing' && (!Array.isArray(object.marks) || !object.marks.length)) return false;
  if (CHARACTER_KINDS.has(object.kind)) return true;

  const label = descriptor(object);
  // The legacy unlabeled bird is only a tiny V-shaped scenery mark. An
  // explicitly described bird, or any free-drawn bird, can still be a friend.
  if (object.kind === 'bird') return Boolean(label);
  const subject = withoutRenderingSuffix(subjectPhrase(label));
  if (hasCharacterDescription(label, subject)) return true;
  // Quoted names are intentional names, not environmental labels. A saved
  // name followed by “ · ” still uses its descriptor above.
  if (/^(?:["“「『].+["”」』]|'.+')$/u.test(subject)) return true;
  if (!subject) return true;
  return !EXPLICIT_BACKGROUND.test(subject) && !EN_SCENERY.test(subject) && !ZH_SCENERY.test(subject);
}
