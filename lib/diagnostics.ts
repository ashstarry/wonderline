import { researchTextEnabled } from './research-recording';
import { drawingFailureDiagnostic } from './drawing-failure';
import type { StreamingUpdate } from './audio';
import type { ImagineResult, Scene } from './scene';

const integer = (value: number, max = 10_000_000) => Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : 0;
const safeId = (value: string | null | undefined) => value && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) && !/^(sk-|bearer|token|secret)/i.test(value) ? value : null;
const safeModel = (value: string) => /^[a-z0-9/_:.-]{1,96}$/i.test(value) && !/^(sk-|bearer)/i.test(value) ? value : 'unknown';
function emit(event: string, data: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info') {
  try { console[level](event, { diagnosticVersion: 1, ...data }); } catch { /* Observability must not change the user's turn. */ }
}
function protectedText(text: string, secrets: readonly string[]) {
  let value = text;
  for (const secret of secrets) if (secret.length >= 8) value = value.split(secret).join('[REDACTED]');
  value = value.replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]').replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*/gi, 'Bearer [REDACTED]');
  return { text: value.slice(0, 12000), chars: text.length, truncated: value.length > 12000 };
}
export function diagnosticFailure(error: unknown, status = 0, timedOut = false, cancelled = false) {
  if (cancelled) return 'cancelled';
  if (timedOut || (error instanceof Error && error.name === 'TimeoutError')) return 'timeout';
  if (status >= 300) return 'http';
  if (error instanceof SyntaxError) return 'invalid_json';
  if (error instanceof Error && /Invalid ASR response/.test(error.message)) return 'invalid_response';
  if (error instanceof Error && /I\/O|context/i.test(error.message)) return 'io_context';
  if (error instanceof Error && /not a function/i.test(error.message)) return 'unsupported_api';
  if (error instanceof TypeError) return 'network';
  return 'unknown';
}
type AttemptSummary = { attempt: number; model: string; status: number; stage: string; elapsedMs: number; deadlineMs: number; audioMs: number; outcome: string; providerRequestId: string | null; rawChars?: number; textChars?: number; deadlineExpired?: boolean; cancelled?: boolean; errorName?: string };
export type SpeechAttempt = {
  start(deadlineMs: number): void;
  headers(response: Response): void;
  phase(value: 'decode' | 'validate'): void;
  success(raw: string, cleaned: string): void;
  failure(error: unknown, status: number, timedOut: boolean, cancelled: boolean): void;
};
export function speechSessionTrace(request: Request, session: string, profile: string, key: string) {
  const enabled = researchTextEnabled(request), start = Date.now(), recent: AttemptSummary[] = [];
  const base = { session: safeId(session), profile, requestId: safeId(request.headers.get('cf-ray')), researchText: enabled };
  let completed = 0, failed = 0, active = 0, ended = false, failureLogged = false, previousPartial = '', lastStable = '', lastPartial = '', lastRevision = -1, stableChars = 0, partialChars = 0, segments = 0;
  let detailBytes = 0, detailsSuppressed = 0;
  const encoder = new TextEncoder();
  // Reserve room for failure evidence/final text instead of flooding Worker logs
  // during a long session. Failure and termination records are never sampled.
  const write = (event: string, data: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info', terminal = false) => {
    try {
      if (level === 'info' && !terminal) {
        const size = encoder.encode(JSON.stringify(data)).length;
        if (detailBytes + size > 128000) { detailsSuppressed++; return; }
        detailBytes += size;
      }
      emit(event, data, level);
    } catch { /* Logging never changes a recognition outcome. */ }
  };
  const transcript = () => enabled ? { transcript: { stable: protectedText(lastStable, [key]), partial: protectedText(lastPartial, [key]) } } : {};
  write('speech_session_started', base);
  return {
    attempt(model: string, attempt: number, audioMs: number): SpeechAttempt {
      let begun = Date.now(), finished = false, status = 0, stage = 'prepare', deadlineMs = 0, requestId: string | null = null;
      const prefix = { ...base, attempt: integer(attempt), model: safeModel(model), audioMs: integer(audioMs) };
      const finish = (outcome: string, rawChars?: number, textChars?: number, failure?: { deadlineExpired: boolean; cancelled: boolean; errorName: string }) => {
        if (finished) return; finished = true; active = Math.max(0, active - 1); completed++;
        if (outcome !== 'ok' && outcome !== 'cancelled') failed++;
        const summary: AttemptSummary = { attempt: prefix.attempt, model: prefix.model, audioMs: prefix.audioMs, status, stage, elapsedMs: integer(Date.now() - begun), deadlineMs, outcome, providerRequestId: requestId, ...(rawChars === undefined ? {} : { rawChars, textChars }), ...failure };
        recent.push(summary); if (recent.length > 8) recent.shift();
        write('speech_attempt_finished', { ...base, ...summary }, outcome === 'ok' || outcome === 'cancelled' ? 'info' : 'warn');
      };
      return {
        start(ms) { begun = Date.now(); deadlineMs = integer(ms); active++; stage = 'fetch'; write('speech_attempt_started', { ...prefix, deadlineMs }); },
        headers(response) { status = response.status; stage = 'response'; requestId = safeId(response.headers.get('x-request-id') ?? response.headers.get('x-openrouter-request-id') ?? response.headers.get('cf-ray')); },
        phase(value) { stage = value; },
        success(raw, cleaned) {
          finish('ok', raw.length, cleaned.length);
          if (enabled) write('speech_recognition_text', { ...prefix, raw: protectedText(raw, [key]), ...(raw === cleaned ? {} : { cleaned: protectedText(cleaned, [key]) }) });
        },
        failure(error, code, timedOut, cancelled) { status = code; const name = error instanceof Error ? error.name : ''; finish(diagnosticFailure(error, code, timedOut, cancelled), undefined, undefined, { deadlineExpired: timedOut, cancelled, errorName: ['Error', 'TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(name) ? name : 'Error' }); },
      };
    },
    update(update: StreamingUpdate) {
      if (update.revision <= lastRevision) return;
      lastRevision = update.revision; stableChars = update.stableText.length; partialChars = update.partial.length; segments += update.segments.length;
      lastStable = update.stableText; lastPartial = update.partial;
      if (enabled && (update.partial !== previousPartial || update.segments.length || update.done)) write('speech_transcript_ready', {
        ...base, revision: update.revision, done: update.done,
        partial: protectedText(update.partial, [key]),
        segments: update.segments.map(segment => ({ id: safeId(segment.id), ...protectedText(segment.text, [key]) })),
        ...(update.done ? { stable: protectedText(update.stableText, [key]) } : {}),
      });
      previousPartial = update.partial;
    },
    fallback(from: string, next: string | undefined, disabled: ReadonlySet<string>) { write('speech_model_switched', { ...base, from: safeModel(from), next: next ? safeModel(next) : null, disabledModels: [...disabled].map(safeModel) }, 'warn'); },
    limit(attempts: number, billedSeconds: number) { write('speech_session_limit', { ...base, attempts: integer(attempts), billedSeconds: integer(billedSeconds) }, 'error'); },
    failure(code: string) { if (failureLogged) return; failureLogged = true; write('speech_session_failed', { ...base, code, elapsedMs: integer(Date.now() - start), activeAttempts: active, completedAttempts: completed, failedAttempts: failed, stableChars, partialChars, segments, detailsSuppressed, recentAttempts: recent.map(value => ({ ...value })), ...transcript() }, 'error'); },
    stopping(reason: string) { write('speech_session_stopping', { ...base, reason, elapsedMs: integer(Date.now() - start) }); },
    end(reason: string, receivedMs: number, billedSeconds: number, closeCode?: number) {
      if (ended) return; ended = true;
      write('speech_session_ended', { ...base, reason, ...(closeCode === undefined ? {} : { closeCode: integer(closeCode, 65535) }), elapsedMs: integer(Date.now() - start), receivedMs: integer(receivedMs), billedSeconds: integer(billedSeconds), activeAttempts: active, completedAttempts: completed, failedAttempts: failed, stableChars, partialChars, segments, detailsSuppressed, recentAttempts: recent.map(value => ({ ...value })), ...(failureLogged ? {} : transcript()) }, 'info', true);
    },
  };
}
export function speechAdmissionFailure(request: Request, profile: string, status: number, reason: string) {
  emit('speech_admission_failed', { requestId: safeId(request.headers.get('cf-ray')), profile, status, reason }, status >= 500 ? 'error' : 'warn');
}

export type DrawingTrace = ReturnType<typeof drawingTrace>;
export function drawingTrace(request: Request, meta: { model: string; language: string; mode: string; lookahead: boolean; objects: number; marks: number; text: string; scene?: Scene }, key: string) {
  const start = Date.now(), requestId = safeId(request.headers.get('cf-ray')) ?? crypto.randomUUID();
  const base = { requestId, model: safeModel(meta.model), language: meta.language, mode: meta.mode, lookahead: meta.lookahead };
  let firstContentMs: number | null = null, firstPreviewMs: number | null = null, firstDrawableMs: number | null = null, upstreamStatus = 0, streamErrorCode: number | null = null, providerRequestId: string | null = null, terminal = false, upstreamFailure: string | null = null;
  const geometry = (scene: Scene) => JSON.stringify([scene.sky, scene.ground, scene.weather, scene.objects.map(o => [o.id, o.kind, o.x, o.y, o.scale, o.rotation, o.stackRank, o.color, o.marks])]);
  const originalGeometry = meta.scene ? geometry(meta.scene) : null;
  emit('drawing_request_started', { ...base, inputChars: meta.text.length, objectsBefore: meta.objects, marksBefore: meta.marks });
  if (researchTextEnabled(request)) emit('drawing_input_text', { ...base, instruction: protectedText(meta.text, [key]) });
  const timing = () => ({ elapsedMs: integer(Date.now() - start), firstContentMs, firstPreviewMs, firstDrawableMs, upstreamStatus, streamErrorCode, providerRequestId, upstreamFailure });
  const drawable = (scene?: Scene) => {
    if (firstDrawableMs === null && originalGeometry !== null && scene && geometry(scene) !== originalGeometry) {
      firstDrawableMs = integer(Date.now() - start); emit('drawing_first_drawable', { ...base, ...timing() });
    }
  };
  return {
    upstream(response: Response) { upstreamStatus = response.status; providerRequestId = safeId(response.headers.get('x-request-id') ?? response.headers.get('x-openrouter-request-id') ?? response.headers.get('cf-ray')); emit('drawing_upstream_headers', { ...base, ...timing() }); },
    upstreamError(error: unknown, timeout: boolean, cancelled: boolean) {
      const streamKind = error && typeof error === 'object' && 'kind' in error && ['invalid', 'incomplete', 'length', 'content', 'upstream', 'size'].includes(String(error.kind)) ? String(error.kind) : null;
      if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode <= 599) streamErrorCode = error.statusCode;
      upstreamFailure = streamKind ?? diagnosticFailure(error, upstreamStatus, timeout, cancelled);
      emit('drawing_upstream_failed', { ...base, ...timing() }, cancelled ? 'info' : 'warn');
    },
    firstContent() { if (firstContentMs !== null) return; firstContentMs = integer(Date.now() - start); emit('drawing_first_content', { ...base, ...timing() }); },
    firstPreview(scene?: Scene) { if (firstPreviewMs === null) { firstPreviewMs = integer(Date.now() - start); emit('drawing_first_preview', { ...base, ...timing() }); } drawable(scene); },
    complete(result: ImagineResult, previews = 0) { if (terminal) return; drawable(result.scene); terminal = true; emit('drawing_request_completed', { ...base, ...timing(), action: result.action ?? 'update', previews, objectsAfter: result.scene.objects.length, marksAfter: result.scene.objects.reduce((n, object) => n + (object.marks?.length ?? 0), 0) }); },
    failure(error: unknown, stage: string, previews = 0) {
      if (terminal) return; terminal = true;
      const extra: Record<string, string> = { 'No drawing operation returned': 'empty_patch', 'Mercury edit contract mismatch': 'edit_contract', 'Overlapping or out-of-range edits': 'invalid_edit_range', 'Unknown background anchor': 'invalid_layer_anchor' };
      const diagnostic = drawingFailureDiagnostic(error);
      const allowed = new Set(['action','message','title','sky','weather','ground','layout','bounds','anchors','name','additions','updates','removals','object_order','mark_edits','layer_moves','start','deleteCount','before','place_before','id','kind','color','label','marks','type','d','x','y','w','h','x2','y2','fill','stroke','strokeWidth','opacity','text','scale','rotation','center_x','center_y']);
      const issues = error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues) ? error.issues.slice(0, 5).map(issue => ({
        code: ['invalid_type','invalid_string','too_big','too_small','unrecognized_keys','invalid_enum_value','custom'].includes(issue?.code) ? issue.code : 'validation',
        path: Array.isArray(issue?.path) ? issue.path.slice(0, 10).map((part: unknown) => typeof part === 'number' ? integer(part) : typeof part === 'string' && allowed.has(part) ? part : 'field') : [],
      })) : [];
      emit('drawing_request_failed', { ...base, ...timing(), stage, previews, ...diagnostic, issues, ...(error instanceof Error && extra[error.message] ? { reason: extra[error.message] } : {}) }, 'error');
    },
    cancel() { if (terminal) return; terminal = true; emit('drawing_request_cancelled', { ...base, ...timing() }); },
  };
}
