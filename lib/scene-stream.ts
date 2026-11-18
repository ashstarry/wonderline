import { omitUnrequestedText } from './drawing-text';
import type { ImagineResult, Scene } from './scene';
import { applyScenePatch, layoutSchema, modelObjectSchema, scenePatchSchema, sceneSchema } from './scene-validation';

type ObjectFrame = { kind: 'object'; value: Record<string, unknown>; state: 'key-or-end' | 'key' | 'colon' | 'value' | 'comma-or-end'; key?: string; keys: Set<string> };
type ArrayFrame = { kind: 'array'; value: unknown[]; state: 'value-or-end' | 'value' | 'comma-or-end' };
type Frame = ObjectFrame | ArrayFrame;

/** Parses a JSON prefix without inventing missing values or closing delimiters. */
class JsonPrefix {
  value: unknown;
  revision = 0;
  private stack: Frame[] = [];
  private complete = new WeakSet<object>();
  private started = false;
  private ended = false;
  private size = 0;
  private token = '';
  private tokenKind: 'string' | 'primitive' | null = null;
  private stringKey = false;
  private escaped = false;
  isComplete(value: unknown): boolean { return !!value && typeof value === 'object' && this.complete.has(value); }
  private fail(): never { throw new Error('Invalid or incomplete model JSON'); }
  private accept(value: unknown) {
    const frame = this.stack.at(-1);
    if (!frame) {
      if (this.started) this.fail();
      this.started = true; this.value = value;
      return;
    }
    if (frame.kind === 'object') {
      if (frame.state !== 'value' || frame.key === undefined) this.fail();
      frame.value[frame.key] = value;
      frame.state = 'comma-or-end';
      if (this.stack.length === 1 && (value === null || typeof value !== 'object')) this.revision++;
    } else {
      if (frame.state !== 'value' && frame.state !== 'value-or-end') this.fail();
      frame.value.push(value); frame.state = 'comma-or-end';
    }
  }
  private primitive() {
    let value: unknown;
    try { value = JSON.parse(this.token); } catch { this.fail(); }
    if (value !== null && typeof value !== 'number' && typeof value !== 'boolean') this.fail();
    this.accept(value);
    this.token = ''; this.tokenKind = null;
    if (!this.stack.length) this.ended = true;
  }
  push(text: string) {
    this.size += text.length;
    if (this.size > 120_000) this.fail();
    for (const character of text) {
      if (this.tokenKind === 'string') {
        this.token += character;
        if (this.escaped) { this.escaped = false; continue; }
        if (character === '\\') { this.escaped = true; continue; }
        if (character !== '"') continue;
        let value: string;
        try { value = JSON.parse(this.token); } catch { this.fail(); }
        this.token = ''; this.tokenKind = null;
        if (this.stringKey) {
          const frame = this.stack.at(-1);
          if (!frame || frame.kind !== 'object' || frame.keys.has(value)) this.fail();
          frame.keys.add(value); frame.key = value; frame.state = 'colon';
        } else { this.accept(value); if (!this.stack.length) this.ended = true; }
        continue;
      }
      if (this.tokenKind === 'primitive') {
        if (!/[ \t\r\n,\]}]/.test(character)) { this.token += character; continue; }
        this.primitive();
      }
      if (/[ \t\r\n]/.test(character)) continue;
      if (this.ended) this.fail();
      const frame = this.stack.at(-1);
      if (frame?.kind === 'object' && (frame.state === 'key' || frame.state === 'key-or-end')) {
        if (character === '}' && frame.state === 'key-or-end') { this.close(frame); continue; }
        if (character !== '"') this.fail();
        this.tokenKind = 'string'; this.token = '"'; this.stringKey = true; continue;
      }
      if (frame?.kind === 'object' && frame.state === 'colon') {
        if (character !== ':') this.fail();
        frame.state = 'value'; continue;
      }
      if (frame?.state === 'comma-or-end') {
        if (character === ',') { frame.state = frame.kind === 'object' ? 'key' : 'value'; continue; }
        if (character === (frame.kind === 'object' ? '}' : ']')) { this.close(frame); continue; }
        this.fail();
      }
      if (frame?.kind === 'array' && frame.state === 'value-or-end' && character === ']') { this.close(frame); continue; }
      if (character === '{' || character === '[') {
        if (this.stack.length >= 24) this.fail();
        const next: Frame = character === '{'
          ? { kind: 'object', value: Object.create(null), state: 'key-or-end', keys: new Set() }
          : { kind: 'array', value: [], state: 'value-or-end' };
        this.accept(next.value); this.stack.push(next); continue;
      }
      if (character === '"') { this.tokenKind = 'string'; this.token = '"'; this.stringKey = false; continue; }
      if (/[-0-9tfn]/.test(character)) { this.tokenKind = 'primitive'; this.token = character; continue; }
      this.fail();
    }
  }
  private close(frame: Frame) {
    this.complete.add(frame.value); this.stack.pop(); this.revision++;
    if (!this.stack.length) this.ended = true;
  }
  finish() {
    if (this.tokenKind === 'primitive') this.primitive();
    if (!this.ended || this.stack.length || this.tokenKind) this.fail();
    return this.value;
  }
}

export class ScenePreviewBuilder {
  private parser = new JsonPrefix();
  private original: Scene;
  private previous: string;
  constructor(scene: Scene, private options: {allowText?:boolean} = {}) {
    this.original = sceneSchema.parse(scene);
    this.previous = JSON.stringify(this.original);
  }
  push(delta: string): Scene | undefined {
    const revision = this.parser.revision;
    this.parser.push(delta);
    if (revision === this.parser.revision) return;
    const raw = this.parser.value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const patch = raw as Record<string, unknown>;
    if (patch.action !== 'update') return;
    const additions: unknown[] = [];
    if (Array.isArray(patch.additions)) for (const object of patch.additions) {
      if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
      const candidate = object as Record<string, unknown>;
      // Only complete marks are visible, even while their containing object and
      // marks array are still arriving. Metadata must already pass validation.
      const marks = Array.isArray(candidate.marks) ? candidate.marks.filter(mark => this.parser.isComplete(mark)) : candidate.marks;
      if (!this.parser.isComplete(object) && (candidate.kind !== 'drawing' || !Array.isArray(marks) || !marks.length)) continue;
      const checked = modelObjectSchema.safeParse({ ...candidate, ...(marks === undefined ? {} : { marks }) });
      // Wait on invalid/incomplete metadata rather than withdrawing a previously
      // previewed addition. The complete patch must still pass finish().
      if (!checked.success) return;
      additions.push({ ...checked.data, label: checked.data.label ?? null });
    }
    const updates = Array.isArray(patch.updates) ? patch.updates.filter(object => this.parser.isComplete(object)) : [];
    const previewPatch: Record<string, unknown> = {
      action: 'update', message: '画笔正在落下。', title: null, sky: null, weather: null, ground: null,
      additions, updates, removals: [], object_order: null,
    };
    for (const key of ['title', 'sky', 'weather', 'ground'] as const) {
      const checked = scenePatchSchema.shape[key].safeParse(patch[key]);
      if (checked.success) previewPatch[key] = checked.data;
    }
    // Depth is emitted before geometry. If a provider sends it late, keep new
    // additions off an existing page until it arrives rather than show them in
    // front, then erase/redraw unchanged characters when the order is corrected.
    const orderReady = patch.object_order === null || this.parser.isComplete(patch.object_order);
    if (additions.length && this.original.objects.length && !orderReady) return;
    const order = orderReady ? patch.object_order : null;
    let scene: Scene;
    try {
      scene = applyScenePatch(this.original, previewPatch).scene;
      if (order != null) {
        const checked = scenePatchSchema.shape.object_order.safeParse(order);
        if (!checked.success || !checked.data) return;
        const orderedIds = checked.data;
        const visibleIds = new Set(scene.objects.map(object => object.id));
        // Future additions may be named already. Project their declared order
        // onto complete visible geometry; never guess omitted old-object order.
        // Removals still wait until finish(), which validates the entire order.
        if (new Set(orderedIds).size !== orderedIds.length || [...visibleIds].some(id => !orderedIds.includes(id))) return;
        scene = applyScenePatch(this.original, { ...previewPatch, object_order: orderedIds.filter(id => visibleIds.has(id)) }).scene;
      }
    } catch { return; }
    if(this.options.allowText===false)scene=omitUnrequestedText(this.original,scene);
    const serialized = JSON.stringify(scene);
    if (serialized === this.previous) return;
    this.previous = serialized;
    return scene;
  }
  layout() {
    const raw = this.parser.value as Record<string, unknown> | undefined;
    if (!raw || !this.parser.isComplete(raw.layout)) return undefined;
    const checked = layoutSchema.safeParse(raw.layout);
    if (!checked.success) return undefined;
    const paper = this.original.paper ?? { x: 0, y: 0, width: 1000, height: 640 };
    const contains = (x: number, y: number) => x >= paper.x && y >= paper.y && x <= paper.x + paper.width && y <= paper.y + paper.height;
    if (checked.data.some(item => !contains(item.bounds.x, item.bounds.y) ||
      !contains(item.bounds.x + item.bounds.width, item.bounds.y + item.bounds.height) ||
      item.anchors.some(anchor => !contains(anchor.x, anchor.y)))) return undefined;
    return checked.data;
  }
  finish(): ImagineResult {
    const raw = this.parser.finish();
    // Reservations only schedule early lookahead; they never become artwork.
    // Once complete geometry arrives, a stale/invalid advisory plan must not
    // turn a valid drawing into a failure. JSON, geometry, IDs, order and all
    // non-update actions still undergo their full strict validation.
    const patch = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>).action === 'update'
      ? { ...raw, layout: [] } : raw;
    const result = applyScenePatch(this.original, patch);
    return this.options.allowText === false ? { ...result, scene: omitUnrequestedText(this.original, result.scene) } : result;
  }
}
