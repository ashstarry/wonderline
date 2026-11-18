import type { ArtStyle, ErasureStroke, Scene } from './scene';
import { ERASURE_LIMITS, erasureStrokeSchema, sceneSchema } from './scene-validation';

export type DrawingHistoryEntry = { scene: Scene; phrase: string; message: string; paperId?: string; style?: ArtStyle };
export type DrawingHistory = { history: DrawingHistoryEntry[]; cursor: number; style: ArtStyle };

const MAX_HISTORY = 31;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const styles: readonly string[] = ['crayon', 'pencil', 'watercolor'];

function readEntry(value: unknown, sceneValue: unknown): DrawingHistoryEntry | null {
  if (!isRecord(value) || typeof value.phrase !== 'string' || typeof value.message !== 'string') return null;
  if (value.paperId !== undefined && (typeof value.paperId !== 'string' || !value.paperId.length || value.paperId.length > 200)) return null;
  if (value.style !== undefined && (typeof value.style !== 'string' || !styles.includes(value.style))) return null;
  const checked = sceneSchema.safeParse(sceneValue);
  if (!checked.success) return null;
  return { scene: checked.data, phrase: value.phrase, message: value.message, ...(value.paperId === undefined ? {} : { paperId: value.paperId as string }), ...(value.style === undefined ? {} : { style: value.style as ArtStyle }) };
}

function readValue(value: unknown): DrawingHistory | null {
  if (!isRecord(value) || !Array.isArray(value.history) || !value.history.length || value.history.length > MAX_HISTORY
    || typeof value.cursor !== 'number' || !Number.isFinite(value.cursor) || typeof value.style !== 'string' || !styles.includes(value.style)) return null;
  if (value.version !== undefined && value.version !== 2) return null;
  const pooled = value.version === 2;
  const pool = new Map<string, ErasureStroke>();
  if (pooled) {
    if (!isRecord(value.erasures) || Object.keys(value.erasures).length > MAX_HISTORY * ERASURE_LIMITS.gestures) return null;
    for (const [key, stroke] of Object.entries(value.erasures)) {
      if (!key.length || key.length > 200) return null;
      const checked = erasureStrokeSchema.safeParse(stroke);
      if (!checked.success) return null;
      pool.set(key, checked.data);
    }
  }
  const history: DrawingHistoryEntry[] = [];
  for (const candidate of value.history) {
    if (!isRecord(candidate) || !isRecord(candidate.scene)) return null;
    let scene: unknown = candidate.scene;
    if (pooled) {
      // A v2 entry may contain references or no erasures at all, never an
      // ambiguous mixture of embedded strokes and references.
      if (own(candidate.scene, 'erasures')) return null;
      const { erasureIds, ...geometry } = candidate.scene;
      if (own(candidate.scene, 'erasureIds')) {
        if (!Array.isArray(erasureIds) || erasureIds.length > ERASURE_LIMITS.gestures || erasureIds.some(key => typeof key !== 'string' || !pool.has(key))) return null;
        scene = { ...geometry, erasures: erasureIds.map(key => pool.get(key)!) };
      } else scene = geometry;
    }
    const entry = readEntry(candidate, scene);
    if (!entry) return null;
    history.push(entry);
  }
  return { history, cursor: Math.max(0, Math.min(history.length - 1, Math.trunc(value.cursor))), style: value.style as ArtStyle };
}

/** Accept the original history JSON and the deduplicated v2 format. */
export function readDrawingHistory(raw: string | null): DrawingHistory | null {
  if (!raw) return null;
  try { return readValue(JSON.parse(raw)); } catch { return null; }
}

function strokeSignature(stroke: ErasureStroke): string {
  return JSON.stringify({
    id: stroke.id, paths: stroke.paths, width: stroke.width, shape: stroke.shape,
    targets: stroke.targets.map(target => ({ key: target.key, x: target.x, y: target.y, scale: target.scale, rotation: target.rotation })),
  });
}

/** History entries share immutable erase snapshots instead of serializing them
 * up to 31 times. An AI edit can prune targets under the same gesture ID; those
 * distinct revisions receive distinct pool references without changing IDs. */
export function writeDrawingHistory(value: DrawingHistory): string {
  const checked = readValue(value);
  if (!checked) throw new Error('这张画暂时无法保存，请先下载保留。');
  const pool = new Map<string, ErasureStroke>();
  const signatures = new Map<string, string>();
  const history = checked.history.map(entry => {
    const { erasures, ...geometry } = entry.scene;
    if (erasures === undefined) return { ...entry, scene: geometry };
    const erasureIds = erasures.map(stroke => {
      const signature = strokeSignature(stroke);
      const existing = signatures.get(signature);
      if (existing !== undefined) return existing;
      let key = stroke.id, revision = 1;
      while (pool.has(key)) key = `${stroke.id}:${revision++}`;
      pool.set(key, stroke);
      signatures.set(signature, key);
      return key;
    });
    return { ...entry, scene: { ...geometry, erasureIds } };
  });
  // Object.fromEntries creates own data properties even for '__proto__'. Reads
  // always use Map, so no inherited property can impersonate an erase record.
  return JSON.stringify({ version: 2, history, cursor: checked.cursor, style: checked.style, erasures: Object.fromEntries(pool) });
}
