import { omitUnrequestedText } from '../drawing-text';
import type { ImagineResult, Scene } from '../scene';
import { applyScenePatch, layoutSchema, modelObjectSchema, scenePatchSchema, sceneSchema } from '../scene-validation';
import type{MercuryBounds}from './geometry';
import {JsonPrefix} from './json-prefix';
import {decodeAddition,decodePatch,mercuryOrder} from './codec';
import {enforceMercuryContract,type MercuryIntent} from './contract';
export class MercuryPreviewBuilder {
  private parser = new JsonPrefix();
  private original: Scene;
  private previous: string;
  constructor(scene: Scene, private options: {allowText?:boolean;intent?:MercuryIntent;language?:'en'|'zh';positions?:Record<string,MercuryBounds>} = {}) {
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
    if (this.options.intent === 'move' || this.options.intent === 'pose') return;
    const additions: unknown[] = [],placements:Record<string,unknown>[]=[];
    if (Array.isArray(patch.additions)) for (const object of patch.additions) {
      if (!object || typeof object !== 'object' || Array.isArray(object)) continue;
      const candidate = object as Record<string, unknown>;
      // Only complete marks are visible, even while their containing object and
      // marks array are still arriving. Metadata must already pass validation.
      if(!this.parser.isComplete(object)&&!('place_before' in candidate))return;
      const marks = Array.isArray(candidate.marks) ? candidate.marks.filter(mark => this.parser.isComplete(mark)) : candidate.marks;
      if (!this.parser.isComplete(object) && (candidate.kind !== 'drawing' || !Array.isArray(marks) || !marks.length)) continue;
      let decoded; try { decoded = decodeAddition(candidate, Array.isArray(marks) ? marks : []); } catch { return; }
      const checked = modelObjectSchema.safeParse(decoded);
      // Wait on invalid/incomplete metadata rather than withdrawing a previously
      // previewed addition. The complete patch must still pass finish().
      if (!checked.success) return;
      additions.push({ ...checked.data, label: checked.data.label ?? null });placements.push({id:checked.data.id,place_before:candidate.place_before??null});
    }
    // Existing-object edits commit atomically at finish; additions still stream by mark.
    const updates: unknown[] = [];
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
    let order: string[]|null;try {order=mercuryOrder(this.original,placements);}catch{return;}
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
    if(raw&&typeof raw==='object'&&!Array.isArray(raw))enforceMercuryContract(raw as Record<string,unknown>,this.options.intent??'normal');
    const result = applyScenePatch(this.original, decodePatch(raw,this.original,this.options.language==='zh'?'画面已更新。':'Your picture has been updated.',this.options.positions));
    return this.options.allowText === false ? { ...result, scene: omitUnrequestedText(this.original, result.scene) } : result;
  }
}
