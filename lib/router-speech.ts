import { speechSessionTrace, speechAdmissionFailure, type SpeechAttempt } from './diagnostics';
import { isStudioRequest } from './studio-origin';
import { RollingSpeech, pcmWav } from './rolling-speech';
import { ExperimentalRollingSpeech } from './experimental-rolling-speech';
import { ROUTER_BUDGET, reserveSpeech, settleSpeech, SPEECH_MAX_SECONDS } from './speech-budget';
import { speechVisitor, type SpeechEnv } from './cloud-speech';
import { cleanExperimentalSpeech } from './speech-hesitations';
import type { ChineseAcousticActivity as AcousticActivity } from './chinese-neural-activity';

export const ROUTER_ASR_MODELS = ['microsoft/mai-transcribe-2', 'qwen/qwen3-asr-1.7b', 'elevenlabs/scribe-v2'] as const;
export function selectSpeechModel(preferred: string, samples: number, _previous: string, failed: ReadonlySet<string> = new Set()) {
  // This release listens in English. A misrecognized fragment must not switch
  // languages or providers; fallbacks remain reserved for actual route failures.
  let selected = preferred;
  if (samples < 48000 && preferred === 'qwen/qwen3-asr-1.7b') selected = 'microsoft/mai-transcribe-2';
  return [selected, 'elevenlabs/scribe-v2', 'microsoft/mai-transcribe-2'].find(model => !failed.has(model));
}
export function routerSpeechConfig(env: SpeechEnv) {
  const model = String(env.OPENROUTER_ASR_MODEL || ROUTER_ASR_MODELS[0]);
  const key = String(env.OPENROUTER_API_KEY || '').trim();
  return { model, key, ready: !!key && !!env.DB && ROUTER_ASR_MODELS.some(m => m === model) && env.CLOUD_ASR_ENABLED === 'true' };
}
function base64(bytes: Uint8Array) {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
/** Keys and PCM never enter logs. Experimental-origin text is recorded separately for research. */
type SpeechDiagnostic = { model: string; stage: string; status: number; reason: string; timeout: boolean; cancelled: boolean };
export async function transcribeRouter(key: string, model: string, pcm: Int16Array, signal: AbortSignal, diagnostic?: (value: SpeechDiagnostic) => void, speechOnly = false, observer?: SpeechAttempt) {
  let stage = 'prepare', status = 0; let deadline: AbortSignal | undefined;
  try {
  observer?.start(model === 'qwen/qwen3-asr-1.7b' ? 1500 : 2500);
  const timeout = AbortSignal.timeout(model === 'qwen/qwen3-asr-1.7b' ? 1500 : 2500); deadline = timeout;
  const combined = AbortSignal.any([signal, timeout]);
  const body = JSON.stringify({ model, language: 'en', input_audio: { data: base64(pcmWav(pcm)), format: 'wav' },
    ...(speechOnly && model === 'elevenlabs/scribe-v2' ? { provider: { options: { elevenlabs: { tag_audio_events: false } } } } : {}) });
  stage = 'fetch';
  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST', redirect: 'manual', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body, signal: combined,
  });
  status = response.status; stage = 'response'; observer?.headers(response);
  if (!response.ok) { await response.body?.cancel(); throw new Error('ASR request failed'); }
  observer?.phase('decode');
    const result = await response.json() as { text?: unknown };
    observer?.phase('validate');
  if (typeof result.text !== 'string' || result.text.length > 12000) throw new Error('Invalid ASR response');
  // Sanitize before rolling alignment, so captions and drawing share the same
  // text coordinates. The public Pages route keeps its original raw response.
  const text = speechOnly ? cleanExperimentalSpeech(result.text) : result.text; observer?.success(result.text, text); return text;
  } catch (error) {
    observer?.failure(error, status, !!deadline?.aborted && !signal.aborted, signal.aborted);
    // Operational diagnostics never include audio, transcripts, credentials or raw upstream errors.
    const e = error instanceof Error ? error : new Error();
    const reason = /I\/O|context/i.test(e.message) ? 'io-context' : /not a function/i.test(e.message) ? 'unsupported-api' : /redirect/i.test(e.message) ? 'redirect' : /network|fetch/i.test(e.message) ? 'network' : 'other';
    const detail = { model, stage, status, reason, timeout: e.name === 'TimeoutError', cancelled: signal.aborted };
    console.warn('speech-upstream', detail); diagnostic?.(detail);
    throw error;
  }
}

export async function routerSpeechWebSocket(request: Request, env: SpeechEnv, ctx: ExecutionContext, speechOnly = false, activityFactory?: () => Promise<AcousticActivity>) {
  const error = (message: string, status: number, reason = status === 503 ? 'configuration' : status === 403 ? 'origin' : 'request') => { speechAdmissionFailure(request, speechOnly ? 'en-speech-only' : 'en-rolling', status, reason); return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }); };
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error('WebSocket required', 426);
  if (!isStudioRequest(request, env.PUBLIC_ACCESS_ENABLED === 'true', true)) return error('Open the studio to record.', 403);
  const config = routerSpeechConfig(env), db = env.DB;
  if (env.PUBLIC_ACCESS_ENABLED !== 'true' || !env.VISITOR_HASH_KEY || !config.ready || !db) return error('Voice is not available yet.', 503);
  const visitor = await speechVisitor(request, String(env.VISITOR_HASH_KEY));
  const minute = Math.floor(Date.now() / 60000);
  const admitted = await db.prepare('INSERT INTO demo_usage (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < 12 RETURNING count')
    .bind(`speech:${visitor}:${minute}`, Date.now() + 120000).first();
  if (!admitted) return error('Please wait a moment before trying again.', 429, 'rate_limit');
  const reservation = await reserveSpeech(db, visitor, ROUTER_BUDGET);
  if ('error' in reservation) return error('The studio is busy. Please try shortly.', 429, reservation.error);
  const id = reservation.id!, pair = new WebSocketPair(), client = pair[0], socket = pair[1];
  socket.binaryType = 'arraybuffer';
  socket.accept();
  const trace = speechSessionTrace(request, id, speechOnly ? 'en-speech-only' : 'en-rolling', config.key);
  let activity: AcousticActivity | undefined;
  if (speechOnly && activityFactory) {
    const gateStart = Date.now();
    try {
      activity = await activityFactory();
      const observed = Date.now() - gateStart;
      console.info('speech_noise_gate_ready', { session: id, language: 'en', engine: 'silero-v6', initializationObservedMs: observed > 0 ? observed : null, moduleCold: activity.runtimeInfo?.moduleCold, modelReused: activity.runtimeInfo?.modelReused });
    } catch { console.error('speech_noise_gate_unavailable', { session: id, language: 'en', fallback: 'existing-energy-gate' }); }
  }
  const started = Date.now(); let closed = false, ending = false, bytes = 0, billedSeconds = 0, requests = 0, previousText = '';
  let diagnostic: SpeechDiagnostic | undefined;
  const failedModels = new Set<string>();
  let idle: ReturnType<typeof setTimeout>, life: ReturnType<typeof setTimeout>, drain: ReturnType<typeof setTimeout>;
  function output(value: unknown) { if (!closed) try { socket.send(JSON.stringify(value)); } catch { cleanup('send-failed'); } }
  function cleanup(reason = 'socket-close', closeCode?: number) {
    if (closed) return; closed = true; session.cancel(); clearTimeout(idle); clearTimeout(life); clearTimeout(drain);
    if (activity) console.info('speech_noise_gate_summary', { session: id, language: 'en', ...activity.summary() });
    trace.end(reason, bytes / 32, billedSeconds, closeCode);
    try { socket.close(1000, 'Finished'); } catch { /* Already closed. */ }
    ctx.waitUntil(settleSpeech(db!, id, billedSeconds, ROUTER_BUDGET).catch(() => { /* Keep reservation if accounting fails. */ }));
  }
  function fail(code: string) { trace.failure(code); output({ type: 'error', code, ...(code === 'provider' && diagnostic ? { diagnostic } : {}) }); cleanup(`error-${code}`); }
  async function infer(pcm: Int16Array, signal: AbortSignal) {
    const call = async (model: string) => {
      const duration = Math.ceil(pcm.length / 16000) + 1;
      if (++requests > 900 || billedSeconds + duration > 12000) { trace.limit(requests, billedSeconds); throw new Error('Session budget'); }
      billedSeconds += duration; // Reserve all attempts before network access, including ambiguous failures.
      return transcribeRouter(config.key, model, pcm, signal, value => { diagnostic = value; output({type:'diagnostic', ...value}); }, speechOnly, trace.attempt(model, requests, pcm.length / 16));
    };
    const selected = selectSpeechModel(config.model, pcm.length, previousText, failedModels);
    if (!selected) throw new Error('Speech unavailable');
    let text: string;
    try { text = await call(selected); }
    catch {
      if (signal.aborted) throw new Error('Cancelled');
      // A slow route must not stall every subsequent window in this recording.
      failedModels.add(selected);
      const fallback = selectSpeechModel(config.model, pcm.length, previousText, failedModels);
      trace.fallback(selected, fallback, failedModels);
      if (!fallback) throw new Error('Speech unavailable');
      try { text = await call(fallback); }
      catch (error) { failedModels.add(fallback); trace.fallback(fallback, undefined, failedModels); throw error; }
    }
    previousText = text; return text;
  }
  const Session = speechOnly ? ExperimentalRollingSpeech : RollingSpeech;
  const session = new Session(id, infer, update => {
    trace.update(update); output({ type: 'update', update }); if (update.done) cleanup('completed');
  }, () => fail('provider'), started, activity, stage => console.error('speech_noise_gate_failed', { session: id, language: 'en', stage }));
  function finish(reason = 'client-stop') {
    if (closed || ending) return; ending = true; trace.stopping(reason); output({ type: 'stopping' });
    // A cached final result may close the session synchronously and clear this timer.
    drain = setTimeout(() => fail('timeout'), 10000);
    session.finish();
  }
  socket.addEventListener('close', event => cleanup('socket-close', 'code' in event && typeof event.code === 'number' ? event.code : undefined)); socket.addEventListener('error', () => cleanup('socket-error'));
  socket.addEventListener('message', event => {
    if (closed || ending) return;
    if (typeof event.data === 'string') { if (event.data === '{"type":"finish"}') finish(); else fail('invalid'); return; }
    if (!(event.data instanceof ArrayBuffer) || !event.data.byteLength || event.data.byteLength > 16000 || event.data.byteLength % 2) { fail('invalid'); return; }
    if (bytes + event.data.byteLength > SPEECH_MAX_SECONDS * 32000 || bytes + event.data.byteLength > ((Date.now() - started) / 1000 + 5) * 32000) { finish('audio-limit'); return; }
    bytes += event.data.byteLength; clearTimeout(idle); idle = setTimeout(() => finish('idle'), 15000); session.feed(event.data);
  });
  life = setTimeout(() => finish('session-duration'), SPEECH_MAX_SECONDS * 1000); idle = setTimeout(() => finish('idle'), 15000);
  output({ type: 'ready', sessionId: id, mode: 'openrouter-rolling' });
  return new Response(null, { status: 101, webSocket: client });
}
