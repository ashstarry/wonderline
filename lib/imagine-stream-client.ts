import { drawingExperimentEnabled, studioApi } from './studio-endpoint';
import type { ImagineResult, Scene } from './scene';
import { sceneSchema, layoutSchema } from './scene-validation';
import { DrawingFailure, drawingFailureKind, httpDrawingFailureKind, type DrawingFailureKind } from './drawing-failure';

export type DrawingLayout = {id:string;bounds:{x:number;y:number;width:number;height:number};anchors:{name:string;x:number;y:number}[]}[];
type ReadOptions = { signal?: AbortSignal; onPreview: (scene: Scene, layout?: DrawingLayout) => void; expectedScene?: Scene };
const MAX_FRAME = 600_000;
const incomplete = '画面最后结果没有收到，原画已经保留，请再试一次。';
const invalid = '这次画面没有完整接好，原画已经保留，请再试一次。';
const disconnected = '暂时连不上画室，画面已经保留，请检查网络后再试。';

function transmittedKind(value: unknown, fallback: DrawingFailureKind): DrawingFailureKind {
  return value === 'turn' || value === 'service' ? value : fallback;
}

function errorMessage(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 2000 ? value : undefined;
}

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已取消这一笔。', 'AbortError');
}

function validatedResult(value: unknown, expectedScene?: Scene): ImagineResult {
  if (!value || typeof value !== 'object') throw new DrawingFailure(invalid, 'turn');
  const result = value as Record<string, unknown>;
  const scene = sceneSchema.safeParse(result.scene);
  if (!scene.success || typeof result.message !== 'string' || !result.message.length || result.message.length > 2000 ||
    (result.action !== undefined && (typeof result.action !== 'string' || !['update', 'undo', 'clarify', 'ignore'].includes(result.action)))) throw new DrawingFailure(invalid, 'turn');
  if (result.action === 'ignore' && expectedScene && JSON.stringify(scene.data) !== JSON.stringify(sceneSchema.parse(expectedScene))) throw new DrawingFailure(invalid, 'turn');
  return { scene: scene.data, message: result.message, ...(result.action ? { action: result.action as ImagineResult['action'] } : {}) };
}

/** Return only a final result. Previews are provisional and must never enter history. */
export async function readImagineResponse(response: Response, { signal, onPreview, expectedScene }: ReadOptions): Promise<ImagineResult> {
  assertActive(signal);
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/x-ndjson')) {
    let value: unknown;
    try { value = await response.json(); } catch (cause) {
      assertActive(signal);
      const kind = !response.ok ? httpDrawingFailureKind(response.status) : drawingFailureKind(cause);
      throw new DrawingFailure(kind === 'service' ? disconnected : invalid, kind);
    }
    assertActive(signal);
    if (!response.ok) {
      const payload = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const kind = transmittedKind(payload.failureKind, httpDrawingFailureKind(response.status));
      throw new DrawingFailure(errorMessage(payload.error) ?? (kind === 'service' ? disconnected : invalid), kind);
    }
    return validatedResult(value, expectedScene);
  }
  if (!response.body) throw new DrawingFailure(incomplete, 'turn');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let sawPreview = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const consume = (line: string): ImagineResult | undefined => {
    assertActive(signal);
    if (!line.trim()) return;
    if (line.length > MAX_FRAME) throw new DrawingFailure(invalid, 'turn');
    let value: Record<string, unknown>;
    try { value = JSON.parse(line); } catch { throw new DrawingFailure(invalid, 'turn'); }
    if (!value || typeof value !== 'object') throw new DrawingFailure(invalid, 'turn');
    if (value.type === 'complete') {
      const result = validatedResult(value.result, expectedScene);
      // A genuine ignore has no drawing intent and therefore never has a
      // provisional drawing. Do not delete speech after a contradictory stream.
      if (result.action === 'ignore' && sawPreview) throw new DrawingFailure(invalid, 'turn');
      return result;
    }
    if (value.type === 'error') throw new DrawingFailure(errorMessage(value.error) ?? invalid, transmittedKind(value.failureKind, 'turn'));
    if (value.type !== 'preview') throw new DrawingFailure(invalid, 'turn');
    const scene = sceneSchema.safeParse(value.scene);
    if (!scene.success) throw new DrawingFailure(invalid, 'turn');
    sawPreview = true;
    const layout = layoutSchema.safeParse(value.layout);
    onPreview(scene.data, layout.success ? layout.data : undefined);
    assertActive(signal);
  };
  try {
    while (true) {
      assertActive(signal);
      const { value, done } = await reader.read();
      assertActive(signal);
      // Invalid UTF-8 is bad response data, unlike a failed network reader.
      try { buffer += decoder.decode(value, { stream: !done }); } catch { throw new DrawingFailure(invalid, 'turn'); }
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const result = consume(line);
        if (result) return result;
      }
      if (buffer.length > MAX_FRAME) throw new DrawingFailure(invalid, 'turn');
      if (done) {
        const result = consume(buffer);
        if (result) return result;
        throw new DrawingFailure(incomplete, 'turn');
      }
    }
  } catch (cause) {
    assertActive(signal);
    if (cause instanceof DrawingFailure || (cause instanceof Error && cause.name === 'AbortError')) throw cause;
    const kind = drawingFailureKind(cause);
    throw new DrawingFailure(kind === 'service' ? disconnected : invalid, kind);
  } finally {
    signal?.removeEventListener('abort', abort);
    // Cancellation is cleanup, never a prerequisite for committing a complete
    // result. A broken transport can keep its cancellation promise pending.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}


/** One request, with progress-based deadlines. Never retry it automatically:
 * release the conversational queue so the next distinct idea can proceed. */
export async function requestImagine(input: unknown, options: ReadOptions, limits: { firstPreviewMs?: number; idleMs?: number; totalMs?: number } = {}): Promise<ImagineResult> {
  const controller = new AbortController();
  const timeout = () => controller.abort(new DrawingFailure('这一笔等得有点久。可以接着说新想法，这句话也替你留着。', 'turn'));
  let progressTimer: ReturnType<typeof setTimeout>;
  const totalTimer = setTimeout(timeout, limits.totalMs ?? 95_000);
  const arm = (delay: number) => { clearTimeout(progressTimer); progressTimer = setTimeout(timeout, delay); };
  arm(limits.firstPreviewMs ?? 25_000);
  const cancel = () => controller.abort(new DOMException('已取消这一笔。', 'AbortError'));
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener('abort', onAbort, { once: true });
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try {
    const work = (async () => {
      assertActive(controller.signal);
      const response = await fetch(studioApi(`/api/imagine${drawingExperimentEnabled() ? '?draw-lab=mercury3' : ''}`), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(input), signal: controller.signal });
      return readImagineResponse(response, { ...options, signal: controller.signal, onPreview: (scene, layout) => {
        assertActive(controller.signal); arm(limits.idleMs ?? 20_000); options.onPreview(scene, layout);
      } });
    })();
    return await Promise.race([work, interrupted]);
  } finally {
    clearTimeout(progressTimer!); clearTimeout(totalTimer);
    options.signal?.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
