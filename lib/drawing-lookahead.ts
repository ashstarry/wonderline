import type { Scene, ImagineResult } from './scene';
import type { DrawingLayout } from './imagine-stream-client';
import { sceneSchema } from './scene-validation';
import { DrawingFailure } from './drawing-failure';

export type LookaheadContext = { scene: Scene; layout: DrawingLayout; instruction: string; recent: string[] };
type Preview = { scene: Scene; layout?: DrawingLayout };
type Generate = (phrase: string, context: LookaheadContext, signal: AbortSignal, preview: (scene: Scene, layout?: DrawingLayout) => void) => Promise<ImagineResult>;
type Outcome = { result: ImagineResult } | { error: unknown };
type Job = { phrase: string; context: LookaheadContext; controller: AbortController; done: Promise<Outcome>; latest?: Preview; planning?: (value: Preview) => void };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** This only selects a latency optimization. Every other instruction still goes
 * through the normal model path, using the complete, latest geometry. */
export function canLookAhead(phrase: string) {
  const text = phrase.trim();
  // Speculative tasks can append only. Edits, references and layer placement
  // must see the committed scene, even if the sentence also says “draw”.
  const dependsOnScene = /\b(?:move|shift|relocate|drag|rotate|resize|scale|larger|smaller|recolor|recolour|turn|make|instead|actually|not|no|this|that|it|its|his|her|their|them|hold(?:s|ing)?|carry|carries|carrying|wear(?:s|ing)?|change|replace|remove|erase|undo|behind|underneath|between)\b|\b(?:on top|in front|(?:left|right) of(?!\s+(?:the\s+)?(?:page|paper|canvas)\b))\b/i;
  const chineseEditOrRelation = /不是|不[对對]|[应應][该該]|改[成为為]|[换換][成为為]|[颜顏]色|移[到去動动]|挪|搬到|拖到|放大|[缩縮]小|[删刪]除|擦掉|去掉|撤[销銷]|拿[着著]|抱[着著]|[牵牽][着著]|手[上里中]|戴[着著上]|[骑騎][在着著]|坐在|站在|靠[着著]|[它他她]的|[前后後]面|身[后後]/u;
  if (dependsOnScene.test(text) || chineseEditOrRelation.test(text)) return false;

  if (/(?:[画畫]|有|[来來]|出[现現]|[飞飛]|游)|\b(?:add|draw|flies|swims)\b|\bthere(?:['’]s|\s+(?:is|are))\b/i.test(text)) return true;

  // Indefinite subjects with a page position are common spoken additions.
  const englishSubject = /^(?:and\s+)?(?:a|an|another|one|two|three|some|\d+)\s+[a-z][a-z'’ -]*?\s+(?:(?:on|at|in)\s+(?:the\s+)?(?:left|right|top|bottom|middle|cent(?:er|re)))(?:\s+(?:corner|side))?(?:\s+of\s+(?:the\s+)?(?:page|paper|canvas))?[.!?\s]*$/i;
  const chineseSubject = /^(?:再|在)?(?:左[边邊侧側]|右[边邊侧側]|[上下]方|中[间間]|[左右][上下]角|天上|地上)[，,\s]*(?:再)?[一二三四五六七八九十两兩几幾\d]+[个個只隻条條匹棵朵颗顆座辆輛位艘架].+/u;
  return englishSubject.test(text) || chineseSubject.test(text);
}

/** Ahead work may ONLY append new objects. The previous request can finish
 * growing its objects after the captured preview; none of that work is replaced.
 * Global edits, reorders, collisions, dropped objects and oversized merges are
 * rejected and then planned once against the complete current scene. */
export function rebaseAdditions(base: Scene, candidate: Scene, current: Scene): Scene | null {
  // A descriptive title is not a geometry conflict. Keep the committed title
  // rather than rejecting otherwise safe additions when the model renames it.
  for (const key of ['sky', 'ground', 'weather', 'paper', 'erasures'] as const) {
    if (!same(base[key], candidate[key])) return null;
  }
  if (!same(base.paper, current.paper)) return null;
  if (candidate.objects.length <= base.objects.length) return null;
  if (base.objects.some((object, index) => !same(object, candidate.objects[index]) || !current.objects.some(item => item.id === object.id))) return null;
  const additions = candidate.objects.slice(base.objects.length);
  const existing = new Set(current.objects.map(object => object.id));
  if (additions.some(object => existing.has(object.id))) return null;
  const parsed = sceneSchema.safeParse({ ...current, objects: [...current.objects, ...additions] });
  return parsed.success ? parsed.data : null;
}

/** One bounded lookahead request. Together with the current request this makes
 * at most two model calls in flight; visual painter count is independent.
 * It never displays or commits ahead of its predecessor's model commit. Once
 * that geometry is locked, safe append-only strokes can paint while it animates. */
export class DrawingLookahead {
  private waiting: Job | null = null;
  private consuming: Job | null = null;
  get occupied() { return this.waiting !== null; }

  start(phrase: string, context: LookaheadContext, generate: Generate): boolean {
    if (this.waiting || !context.layout.length || !canLookAhead(phrase)) return false;
    const controller = new AbortController();
    const job: Job = { phrase, context, controller, done: Promise.resolve({ error: new Error('Not started') }) };
    this.waiting = job;
    // Attach a rejection handler immediately, even if the predecessor is slow.
    job.done = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return generate(phrase, context, controller.signal, (scene, layout) => {
        if (controller.signal.aborted) return;
        job.latest = { scene, layout };
        job.planning?.(job.latest);
      });
    }).then(result => ({ result }), error => ({ error }));
    return true;
  }

  async take(phrase: string, current: Scene, signal: AbortSignal, preview: (scene: Scene, layout?: DrawingLayout) => void, planning?: (scene: Scene, layout?: DrawingLayout) => void): Promise<ImagineResult | null> {
    const job = this.waiting;
    if (!job) return null;
    this.waiting = null;
    if (job.phrase !== phrase || signal.aborted) { job.controller.abort(); return null; }
    this.consuming = job;
    const abort = () => job.controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    let exposed = false;
    let lastPreview = '';
    const accept = (value: Preview) => {
      if (signal.aborted || job.controller.signal.aborted) return;
      const merged = rebaseAdditions(job.context.scene, value.scene, current);
      if (merged) {
        const key = JSON.stringify(merged);
        if (key !== lastPreview) { lastPreview = key; exposed = true; preview(merged, value.layout); }
      }
    };
    // The predecessor is committed, even if its painter is still busy. Relay
    // validated additions immediately; retain the existing planning pipeline.
    job.planning = value => {
      accept(value);
      if (!planning || signal.aborted || job.controller.signal.aborted || !value.layout?.length) return;
      const merged = rebaseAdditions(job.context.scene, value.scene, current);
      if (merged) planning(merged, value.layout);
    };
    const discardDescendant = () => { this.waiting?.controller.abort(); this.waiting = null; };
    let accepted = false;
    const cannotMerge = () => {
      // A late conflict goes through the normal per-turn rollback path,
      // including its transcript. Never launch a duplicate paid request.
      if (exposed) throw new DrawingFailure('这一笔没接上，已有画面保留了，可以接着说。', 'turn');
      return null;
    };
    try {
      if (job.latest) job.planning(job.latest);
      const outcome = await job.done;
      if (signal.aborted || job.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if ('error' in outcome) throw outcome.error; // Never retry a network failure.
      const result = outcome.result;
      if (result.action && result.action !== 'update') return cannotMerge();
      const scene = rebaseAdditions(job.context.scene, result.scene, current);
      if (!scene) return cannotMerge();
      accept({ scene: result.scene, layout: job.latest?.layout });
      accepted = true;
      return { ...result, scene };
    } finally {
      job.planning = undefined;
      if (!accepted) discardDescendant();
      signal.removeEventListener('abort', abort);
      if (this.consuming === job) this.consuming = null;
    }
  }

  cancel() {
    this.waiting?.controller.abort(); this.consuming?.controller.abort();
    this.waiting = null; this.consuming = null;
  }
}
