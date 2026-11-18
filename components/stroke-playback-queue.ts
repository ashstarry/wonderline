export type StrokePhase = 'erase' | 'outline' | 'color';

export interface StrokeEntry<T> { key: string; target: T; owner?: string }
export interface StrokeTask<T> {
  readonly hasColor: boolean;
  readonly fillOnly?: boolean;
  retarget(target: T): void;
  assignPainter?(index: number): void;
  play(phase: StrokePhase, complete: () => void, yielded?: () => void): void;
  requestYield?(): void;
  dispose(): void;
}

export type StrokeRecordState = 'outline' | 'color' | 'active' | 'done';
export type ErasureEntry<T> = StrokeEntry<T> & { task?: StrokeTask<T>; state: StrokeRecordState };
type RecordState = StrokeRecordState;
type StrokeRecord<T> = { target: T; owner?: string; state: RecordState; priority: number; task?: StrokeTask<T> };

/** Only inversions between already-present subjects change their overlap.
 * Adding a subject between two old ones does not redraw either old subject. */
export function reorderedStrokeOwners(previous: readonly string[], next: readonly string[]): Set<string> {
  const before = [...new Set(previous)], after = new Map([...new Set(next)].map((owner, index) => [owner, index]));
  const common = before.filter(owner => after.has(owner));
  const changed = new Set<string>();
  for (let a = 0; a < common.length; a++) for (let b = a + 1; b < common.length; b++) {
    if (after.get(common[a])! > after.get(common[b])!) { changed.add(common[a]); changed.add(common[b]); }
  }
  return changed;
}

export const PAINTER_COUNT = 3;
type ActiveStroke = { key: string; phase: 'outline' | 'color'; token: number };
type Painter = { owner: string | null; active: ActiveStroke | null };

/** Three artists own different subjects; each finishes its contour before coloring. */
export class StrokePlaybackQueue<T> {
  private records = new Map<string, StrokeRecord<T>>();
  private outlines: string[] = [];
  private colors: string[] = [];
  private erasures: Array<{ key: string; task: StrokeTask<T> }> = [];
  private activeErasure: { key: string; task: StrokeTask<T>; token: number } | null = null;
  private painters: Painter[] = Array.from({ length: PAINTER_COUNT }, () => ({ owner: null, active: null }));
  private serial = 0;
  private initialized = false;
  private pumping = false;
  private disposed = false;
  private drawing = false;
  private ownerOrder: string[] = [];
  private markOrder = new Map<string, string[]>();

  constructor(
    private createTask: (entry: StrokeEntry<T>) => StrokeTask<T>,
    private onDrawingChange: (drawing: boolean) => void = () => {},
    // A validated scene has at most 40 objects/450 custom marks. This also leaves
    // room for the individual strokes of every built-in brush without growth
    // across a long conversation.
    private capacity = 2048,
    private createErasure?: (entries: ErasureEntry<T>[]) => StrokeTask<T> | null,
    private onSubjectFinished: (owner: string) => void = () => {},
    private canStartSubject: (owner: string, index: number, busyOwners: string[]) => boolean = (_owner,index) => index < 2,
  ) {}

  reconcile(entries: StrokeEntry<T>[], reset = false, turn = 0, retainedOwners: ReadonlySet<string> = new Set()) {
    if (this.disposed) return;
    const current = new Map(entries.slice(0, this.capacity).map(entry => [entry.key, entry]));
    const order = [...new Set([...current.values()].flatMap(entry => entry.owner ? [entry.owner] : []))];
    // Explicit pose/depth controls move existing pigment, including the overlap
    // with neighbours. Only unrelated ordering edits still use the eraser.
    const reordered = reorderedStrokeOwners(this.ownerOrder.filter(owner => !retainedOwners.has(owner)), order.filter(owner => !retainedOwners.has(owner)));
    this.ownerOrder = order;
    const marks = new Map<string, string[]>();
    for (const { key, owner } of current.values()) if (owner) {
      const keys = marks.get(owner) ?? []; keys.push(key); marks.set(owner, keys);
    }
    const restacked = new Set<string>();
    for (const [owner, keys] of marks) for (const key of reorderedStrokeOwners(this.markOrder.get(owner) ?? [], keys)) restacked.add(key);
    this.markOrder = marks;
    if (!this.initialized || reset) {
      this.clearTasks();
      this.records = new Map(Array.from(current, ([key, entry]) => [key, { target: entry.target, owner: entry.owner, state: 'done', priority: turn }]));
      this.initialized = true;
      this.report();
      return;
    }
    const removed: ErasureEntry<T>[] = [];
    for (const [key, record] of this.records) {
      if (current.has(key) && !restacked.has(key) && !(record.owner && reordered.has(record.owner))) continue;
      for (const painter of this.painters) if (painter.active?.key === key) painter.active = null;
      removed.push({ key, ...record });
    }
    // Capture the whole visible change before disposing any live drawing task.
    // One eraser must cut through overlapping pigment together, not peel one
    // mark away at a time and expose another mark waiting in the erase queue.
    const visible = removed.filter(entry => entry.state !== 'outline');
    if (visible.length && this.createErasure) {
      try {
        const erasure = this.createErasure(visible);
        if (erasure) {
          if (this.erasures.length >= this.capacity) this.erasures.shift()?.task.dispose();
          this.erasures.push({ key: `erase-${++this.serial}`, task: erasure });
        }
      } catch { /* Removed unsupported geometry must not stall new drawing. */ }
    }
    for (const record of removed) {
      record.task?.dispose();
      this.records.delete(record.key);
    }
    // Prune removed pending work. Matching queued/active records retain their
    // original order and progress even if React replaced their DOM element.
    this.outlines = this.outlines.filter(key => this.records.get(key)?.state === 'outline');
    this.colors = this.colors.filter(key => this.records.get(key)?.state === 'color');
    for (const [key, entry] of current) {
      const record = this.records.get(key);
      if (record) {
        if (record.target !== entry.target) {
          record.target = entry.target;
          record.task?.retarget(entry.target);
        }
        continue;
      }
      try {
        const task = this.createTask(entry);
        const state = task.fillOnly ? 'color' : 'outline';
        this.records.set(key, { target: entry.target, owner: entry.owner, state, priority: turn, task });
        (state === 'color' ? this.colors : this.outlines).push(key);
      } catch {
        // Unsupported SVG geometry remains visible; it must never block the pen.
        this.records.set(key, { target: entry.target, owner: entry.owner, state: 'done', priority: turn });
      }
    }
    for (const painter of this.painters) {
      if (painter.active?.phase === 'color' && (this.erasures.length || this.outlines.some(key => this.ownerOf(key) === painter.owner))) {
        this.records.get(painter.active.key)?.task?.requestYield?.();
      }
    }
    this.pump();
  }

  private ownerOf(key: string) { return this.records.get(key)?.owner ?? key; }

  private nextKey(painter: Painter, index: number) {
    const busyOwners=[...new Set([...this.records].filter(([,record])=>record.state!=='done').map(([key])=>this.ownerOf(key)))];
    const allowed=(owner:string)=>this.canStartSubject(owner,index,busyOwners.filter(other=>other!==owner));
    if(painter.owner&&!allowed(painter.owner))painter.owner=null;
    // A painter stays with its subject through contour, details and color. An
    // idle colleague can immediately take a newly streamed subject elsewhere.
    if (painter.owner) {
      const next = this.outlines.find(key => this.ownerOf(key) === painter.owner)
        ?? this.colors.find(key => this.ownerOf(key) === painter.owner);
      if (next) return next;
      painter.owner = null;
    }
    const reserved = new Set(this.painters.flatMap(other => other.owner ? [other.owner] : []));
    const candidates = [...this.outlines, ...this.colors].filter(key => !reserved.has(this.ownerOf(key)) && allowed(this.ownerOf(key)));
    return candidates.reduce<string | undefined>((best, key) => best === undefined || (this.records.get(key)?.priority ?? 0) > (this.records.get(best)?.priority ?? 0) ? key : best, undefined);
  }

  private pump() {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      // Iterate synchronous empty tasks without recursion. Each live artist has
      // its own clock and cursor; a free artist never waits for another outline.
      while (true) {
        if (this.activeErasure) break;
        if (this.erasures.length) {
          for (const painter of this.painters) if (painter.active?.phase === 'color') this.records.get(painter.active.key)?.task?.requestYield?.();
          if (this.painters.some(painter => painter.active)) break;
          const erasure = this.erasures.shift()!, token = ++this.serial;
          this.activeErasure = { ...erasure, token };
          const done = () => {
            if (this.disposed || this.activeErasure?.token !== token) return;
            this.activeErasure.task.dispose(); this.activeErasure = null;
            this.pump();
          };
          try { erasure.task.play('erase', done); } catch { done(); }
          if (this.activeErasure) break;
          continue;
        }
        let started = false;
        for (const [index, painter] of this.painters.entries()) {
          if (painter.active) continue;
          const key = this.nextKey(painter,index);
          if (!key) continue;
          const record = this.records.get(key)!;
          const phase = record.state === 'color' ? 'color' : 'outline';
          painter.owner = this.ownerOf(key);
          this.start(key, phase, index); started = true;
        }
        if (!started) break;
      }
    } finally {
      this.pumping = false;
      this.report();
    }
  }

  private start(key: string, phase: 'outline' | 'color', index: number) {
    const pending = phase === 'outline' ? this.outlines : this.colors;
    pending.splice(pending.indexOf(key), 1);
    const record = this.records.get(key);
    if (!record?.task || record.state !== phase) return;
    const token = ++this.serial;
    this.painters[index].active = { key, phase, token };
    record.state = 'active';
    try {
      record.task.assignPainter?.(index);
      record.task.play(phase, () => this.complete(key, phase, token, index), phase === 'color' ? () => this.yieldColor(key, token, index) : undefined);
    } catch { this.complete(key, phase, token, index, true); }
  }

  private yieldColor(key: string, token: number, index: number) {
    const painter = this.painters[index];
    if (this.disposed || painter.active?.key !== key || painter.active.token !== token) return;
    painter.active = null;
    const record = this.records.get(key);
    if (record?.task) { record.state = 'color'; this.colors.unshift(key); }
    this.pump();
  }

  private complete(key: string, phase: 'outline' | 'color', token: number, index: number, failed = false) {
    const painter = this.painters[index];
    if (this.disposed || painter.active?.key !== key || painter.active.token !== token) return;
    painter.active = null;
    const record = this.records.get(key);
    if (record?.task) {
      if (!failed && phase === 'outline' && record.task.hasColor) {
        record.state = 'color'; this.colors.push(key);
      } else {
        record.task.dispose(); delete record.task; record.state = 'done';
        const owner = this.ownerOf(key);
        if (![...this.records].some(([otherKey, other]) => this.ownerOf(otherKey) === owner && other.state !== 'done')) this.onSubjectFinished(owner);
      }
    }
    this.pump();
  }

  private clearTasks() {
    for (const painter of this.painters) { painter.active = null; painter.owner = null; }
    this.serial++;
    this.activeErasure?.task.dispose(); this.activeErasure = null;
    this.erasures.forEach(erasure => erasure.task.dispose()); this.erasures = [];
    for (const record of this.records.values()) record.task?.dispose();
    this.outlines = []; this.colors = [];
  }

  private report() {
    const drawing = Boolean(this.activeErasure || this.painters.some(painter => painter.active) || this.erasures.length || this.outlines.length || this.colors.length);
    if (drawing === this.drawing) return;
    this.drawing = drawing; this.onDrawingChange(drawing);
  }

  bufferedCount() { return this.outlines.length + this.colors.length; }

  snapshot() {
    const painters = this.painters.flatMap((painter, id) => painter.active ? [{ id, owner: painter.owner, ...painter.active }] : []);
    const active = this.activeErasure ? { key: this.activeErasure.key, phase: 'erase' as const } : painters.find(painter => painter.phase === 'outline') ?? painters[0];
    return { activeKey: active?.key ?? null, phase: active?.phase ?? null, colorKey: painters.find(painter => painter.phase === 'color')?.key ?? null, painters, pending: this.erasures.length + this.outlines.length + this.colors.length, retained: this.records.size, drawing: this.drawing };
  }

  dispose() {
    this.clearTasks();
    this.records.clear();
    this.disposed = true;
    this.report();
  }
}
