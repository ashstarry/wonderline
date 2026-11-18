import type { ChineseAcousticActivity } from './chinese-neural-activity';
import { speechSessionTrace, speechAdmissionFailure, type SpeechAttempt } from './diagnostics';
import { ChineseRollingSpeech } from './chinese-rolling-speech';
import { pcmWav } from './rolling-speech';
import { ROUTER_BUDGET, reserveSpeech, settleSpeech, SPEECH_MAX_SECONDS } from './speech-budget';
import { speechVisitor, type SpeechEnv } from './cloud-speech';
import { stripAsrSoundEvents } from './speech-annotations';
import { cleanExperimentalSpeech } from './speech-hesitations';
import { isPagesRequest } from './studio-origin';

// Isolated from the English release. Neither URL parameters nor browser settings
// can select an upstream, supply a credential, or change this language hint.
export const CHINESE_ASR_MODELS = ['fish-audio/transcribe-1', 'qwen/qwen3-asr-1.7b'] as const;
export const CHINESE_ASR_TIMEOUT_MS = 3500;
export const CHINESE_MAX_BILLED_SECONDS = 12000;
export const CHINESE_ROUTER_BUDGET = { ...ROUTER_BUDGET, reserve: CHINESE_MAX_BILLED_SECONDS * 120,
  charge: (billedSeconds: number) => Math.ceil(billedSeconds * 120) };
export const CHINESE_SPEECH_BUDGET = CHINESE_ROUTER_BUDGET;
export function chineseRouterSpeechConfig(env: SpeechEnv) {
  const key = String(env.OPENROUTER_API_KEY || '').trim();
  return { key, model: CHINESE_ASR_MODELS[0], ready: !!key && !!env.DB && env.CLOUD_ASR_ENABLED === 'true' };
}
export const chineseSpeechConfig = chineseRouterSpeechConfig;
export function isChineseSpeechRequest(request: Request, publicAccess = false) {
  const url = new URL(request.url);
  const sameOrigin = request.headers.get('origin') === url.origin && request.headers.get('sec-fetch-site') !== 'cross-site';
  return ['/api/speech/chinese', '/api/speech/chinese-clean'].includes(url.pathname) && !url.search && url.protocol === 'https:' &&
    (sameOrigin || (publicAccess && isPagesRequest(request))) &&
    url.origin !== 'https://ashstarry.github.io';
}
function base64(bytes: Uint8Array) {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export type ChineseSpeechDiagnostic = { model: string; stage: string; status: number; timeout: boolean; cancelled: boolean };
export async function transcribeChineseRouter(key: string, model: string, pcm: Int16Array, signal: AbortSignal,
  diagnostic?: (value: ChineseSpeechDiagnostic) => void, observer?: SpeechAttempt, cleanHesitations = false) {
  if (!(CHINESE_ASR_MODELS as readonly string[]).includes(model)) throw new Error('Unsupported speech model');
  let stage = 'prepare', status = 0; let deadline: AbortSignal | undefined;
  try {
    observer?.start(CHINESE_ASR_TIMEOUT_MS);
    const timeout = AbortSignal.timeout(CHINESE_ASR_TIMEOUT_MS); deadline = timeout;
    const combined = AbortSignal.any([signal, timeout]);
    const body = JSON.stringify({ model, language: 'zh', input_audio: { data: base64(pcmWav(pcm)), format: 'wav' } });
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
    const text = cleanHesitations ? cleanExperimentalSpeech(result.text) : stripAsrSoundEvents(result.text); observer?.success(result.text, text); return text;
  } catch (error) {
    observer?.failure(error, status, !!deadline?.aborted && !signal.aborted, signal.aborted);
    // Failure metadata never includes raw provider bodies, audio, headers or keys.
    diagnostic?.({ model, stage, status, timeout: error instanceof Error && error.name === 'TimeoutError', cancelled: signal.aborted });
    throw error;
  }
}

/** All cloud recognition and accounting stays on the hosted server. */
export async function chineseRouterSpeechWebSocket(request: Request, env: SpeechEnv, ctx: ExecutionContext, activityFactory?: () => Promise<ChineseAcousticActivity>) {
  const error = (message: string, status: number, reason = status === 503 ? 'configuration' : status === 403 ? 'origin' : 'request') => { speechAdmissionFailure(request, 'zh-rolling', status, reason); return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } }); };
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error('WebSocket required', 426);
  if (!isChineseSpeechRequest(request, env.PUBLIC_ACCESS_ENABLED === 'true')) return error('Open the studio to record.', 403);
  const config = chineseRouterSpeechConfig(env), db = env.DB;
  if (env.PUBLIC_ACCESS_ENABLED !== 'true' || !env.VISITOR_HASH_KEY || !config.ready || !db) return error('Voice is not available yet.', 503);
  const visitor = await speechVisitor(request, String(env.VISITOR_HASH_KEY)), minute = Math.floor(Date.now() / 60000);
  const admitted = await db.prepare('INSERT INTO demo_usage (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < 12 RETURNING count')
    .bind(`speech:${visitor}:${minute}`, Date.now() + 120000).first();
  if (!admitted) return error('Please wait a moment before trying again.', 429, 'rate_limit');
  const reservation = await reserveSpeech(db, visitor, CHINESE_ROUTER_BUDGET);
  if ('error' in reservation) return error('The studio is busy. Please try shortly.', 429, reservation.error);
  const id = reservation.id!, pair = new WebSocketPair(), client = pair[0], socket = pair[1];
  socket.binaryType = 'arraybuffer'; socket.accept();
  const trace = speechSessionTrace(request, id, 'zh-rolling', config.key);
  let activity: ChineseAcousticActivity | undefined;
  if (activityFactory) {
    const gateStart = Date.now();
    try {
      activity = await activityFactory();
      // Worker clocks may not advance during CPU-only initialization. Zero is
      // therefore unavailable timing, not evidence of free initialization.
      const observed = Date.now() - gateStart;
      console.info('speech_noise_gate_ready', { session: id, engine: 'silero-v6', initializationObservedMs: observed > 0 ? observed : null, moduleCold: activity.runtimeInfo?.moduleCold, modelReused: activity.runtimeInfo?.modelReused });
    }
    catch { console.error('speech_noise_gate_unavailable', { session: id, fallback: 'existing-energy-gate' }); }
  }
  const started = Date.now(); let closed = false, ending = false, bytes = 0, billedSeconds = 0, requests = 0;
  let flowEvents = 0, reportedFlowEvents = 0;
  let diagnostic: ChineseSpeechDiagnostic | undefined;
  const failedModels = new Set<string>();
  let idle: ReturnType<typeof setTimeout>, life: ReturnType<typeof setTimeout>, drain: ReturnType<typeof setTimeout>;
  function output(value: unknown) { if (!closed) try { socket.send(JSON.stringify(value)); } catch { cleanup('send-failed'); } }
  function cleanup(reason = 'socket-close', closeCode?: number) {
    if (closed) return; closed = true; session.cancel(); clearTimeout(idle); clearTimeout(life); clearTimeout(drain);
    // Operational metadata only. Never retain recordings or recognised words.
    console.info('speech-zh-session', { session: id, receivedSeconds: bytes / 32000, requests, flowEvents });
    if (activity) console.info('speech_noise_gate_summary', { session: id, ...activity.summary() });
    trace.end(reason, bytes / 32, billedSeconds, closeCode);
    try { socket.close(1000, 'Finished'); } catch { /* Already closed. */ }
    ctx.waitUntil(settleSpeech(db!, id, billedSeconds, CHINESE_ROUTER_BUDGET).catch(() => { /* Keep the full reservation. */ }));
  }
  function fail(code: string) { trace.failure(code); output({ type: 'error', code, ...(code === 'provider' && diagnostic ? { diagnostic } : {}) }); cleanup(`error-${code}`); }
  async function infer(pcm: Int16Array, signal: AbortSignal) {
    for (const model of CHINESE_ASR_MODELS) {
      if (failedModels.has(model)) continue;
      if (signal.aborted) throw new Error('Cancelled');
      const duration = Math.ceil(pcm.length / 16000) + 1;
      if (++requests > 900 || billedSeconds + duration > CHINESE_MAX_BILLED_SECONDS) { trace.limit(requests, billedSeconds); throw new Error('Session budget'); }
      billedSeconds += duration;
      try { return await transcribeChineseRouter(config.key, model, pcm, signal, value => { diagnostic = value; }, trace.attempt(model, requests, pcm.length / 16), !isPagesRequest(request) || new URL(request.url).pathname === '/api/speech/chinese-clean'); }
      catch {
        if (signal.aborted) throw new Error('Cancelled');
        // Actual transport/provider failures only. Recognition wording, silence,
        // punctuation, or incomplete clauses never trigger another paid model.
        failedModels.add(model);
        trace.fallback(model, CHINESE_ASR_MODELS.find(candidate => !failedModels.has(candidate)), failedModels);
      }
    }
    throw new Error('Speech unavailable');
  }
  const session = new ChineseRollingSpeech(id, infer, update => { trace.update(update); output({ type: 'update', update }); if (update.done) cleanup('completed'); }, () => fail('provider'), started, value => {
    flowEvents++;
    const unusual = ['empty-retained', 'known-suffix', 'committed-retained'].includes(value.branch);
    if (reportedFlowEvents < 24 && (flowEvents <= 8 || unusual)) {
      reportedFlowEvents++;
      console.info('speech-zh-flow', { session: id, attempt: requests, sequence: flowEvents, ...value });
    }
  }, activity, stage => console.error('speech_noise_gate_failed', { session: id, stage }));
  function finish(reason = 'client-stop') {
    if (closed || ending) return; ending = true; trace.stopping(reason); output({ type: 'stopping' });
    // Existing inference and one trailing window may each need primary+fallback.
    drain = setTimeout(() => fail('timeout'), 18000); session.finish();
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
