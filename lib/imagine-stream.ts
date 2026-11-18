import type { DrawingTrace } from './diagnostics';
import type { Scene } from './scene';
import { ScenePreviewBuilder } from './scene-stream';
import { drawingFailureKind, drawingFailureDiagnostic, type DrawingFailureKind } from './drawing-failure';

export function imagineStreamResponse(
  scene: Scene,
  source: (signal: AbortSignal) => AsyncIterable<string>,
  options: { trace?: DrawingTrace; allowText?: boolean; signal?: AbortSignal; errorMessage?: (error: unknown) => string; errorKind?: (error: unknown) => DrawingFailureKind; onFailure?: (diagnostic: {stage: string; previews: number; reason: string; issueCount: number}) => void } = {},
): Response {
  const lifetime = new AbortController();
  const abort = () => lifetime.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const encoder = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (!closed && !lifetime.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      void (async () => {
        let stage = 'stream', previews = 0;
        try {
          if (lifetime.signal.aborted) return;
          const preview = new ScenePreviewBuilder(scene,{allowText:options.allowText});
          for await (const delta of source(lifetime.signal)) {
            if (lifetime.signal.aborted) return;
            options.trace?.firstContent();
            const next = preview.push(delta);
            // Coalesce previews when the client is slow; never buffer hundreds
            // of full scenes. The final complete/error event is never dropped.
            if (next && (controller.desiredSize ?? 0) > 0) { send({ type: 'preview', scene: next, layout: preview.layout() }); previews++; options.trace?.firstPreview(next); }
          }
          stage = 'final_validation';
          if (!lifetime.signal.aborted) { const result = preview.finish(); send({ type: 'complete', result }); options.trace?.complete(result, previews); }
        } catch (error) {
          if (!lifetime.signal.aborted) {
            options.trace?.failure(error, stage, previews);
            try { options.onFailure?.({stage,previews,...drawingFailureDiagnostic(error)}); } catch { /* Diagnostics cannot break the error frame. */ }
          }
          send({ type: 'error', error: options.errorMessage?.(error) ?? '这一笔没接上，已有画面保留了，可以接着说。', failureKind: options.errorKind?.(error) ?? drawingFailureKind(error) });
        } finally {
          if (lifetime.signal.aborted) options.trace?.cancel();
          options.signal?.removeEventListener('abort', abort);
          if (!closed) { closed = true; controller.close(); }
        }
      })();
    },
    cancel() {
      closed = true; lifetime.abort(); options.trace?.cancel();
      options.signal?.removeEventListener('abort', abort);
    },
  });
  return new Response(body, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no',
  } });
}
