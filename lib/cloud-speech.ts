import { isStudioRequest } from './studio-origin';
import { QWEN_REALTIME_MODEL, QWEN_SESSION, QwenTranscript } from './qwen-events';
import { reserveSpeech, settleSpeech, SPEECH_MAX_SECONDS } from './speech-budget';

export type SpeechEnv = Record<string, unknown> & { DB?: D1Database };
export function cloudSpeechConfig(env: SpeechEnv) {
  const key = String(env.DASHSCOPE_API_KEY ?? '').trim();
  const endpoint = String(env.DASHSCOPE_REALTIME_URL ?? '').trim();
  let url: URL | undefined;
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol === 'wss:' && /^ws-[a-z0-9]+\.ap-southeast-1\.maas\.aliyuncs\.com$/.test(parsed.hostname) && parsed.pathname === '/api-ws/v1/realtime' && !parsed.username && !parsed.password && !parsed.port && !parsed.search && !parsed.hash) {
      parsed.searchParams.set('model', QWEN_REALTIME_MODEL); url = parsed;
    }
  } catch { /* Invalid configuration never becomes an arbitrary upstream. */ }
  return { key, url, ready: !!key && !!url && !!env.DB && env.CLOUD_ASR_ENABLED === 'true' };
}
export async function speechVisitor(request: Request, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(request.headers.get('cf-connecting-ip') || 'shared-guest'));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}

/** Runs entirely in the hosted Worker. Never connects to a computer or tunnel. */
export async function speechWebSocket(request: Request, env: SpeechEnv, ctx: ExecutionContext) {
  const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return error('WebSocket required', 426);
  if (!isStudioRequest(request, env.PUBLIC_ACCESS_ENABLED === 'true', true)) return error('Open the studio to record.', 403);
  const config = cloudSpeechConfig(env);
  if (env.PUBLIC_ACCESS_ENABLED !== 'true' || !env.VISITOR_HASH_KEY || !config.ready || !env.DB) return error('Voice is not available yet.', 503);
  const db = env.DB;
  const visitor = await speechVisitor(request, String(env.VISITOR_HASH_KEY));
  // Bound connection attempts as well as active sessions, including failed upstream handshakes.
  const minute = Math.floor(Date.now() / 60000);
  const admitted = await db.prepare('INSERT INTO demo_usage (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = count + 1 WHERE count < 12 RETURNING count')
    .bind(`speech:${visitor}:${minute}`, Date.now() + 120000).first();
  if (!admitted) return error('Please wait a moment before trying again.', 429);
  const reservation = await reserveSpeech(db, visitor);
  if ('error' in reservation) return error(reservation.error === 'budget' ? 'Voice allowance is resting.' : 'The studio is busy. Please try shortly.', 429);
  const leaseId = reservation.id!;
  const pair = new WebSocketPair(), client = pair[0], downstream = pair[1];
  downstream.binaryType = 'arraybuffer';
  downstream.accept();
  let upstream: WebSocket | undefined, bytes = 0, ready = false, finishing = false, closed = false;
  const started = Date.now(), transcript = new QwenTranscript(leaseId, started);
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let lifeTimer: ReturnType<typeof setTimeout> | undefined;
  const handshake = new AbortController();
  const handshakeTimer = setTimeout(() => handshake.abort(), 12000);
  const output = (value: unknown) => { if (!closed) try { downstream.send(JSON.stringify(value)); } catch { cleanup(); } };
  const send = (type: string, rest: Record<string, unknown> = {}) => upstream?.send(JSON.stringify({ type, event_id: crypto.randomUUID(), ...rest }));
  function cleanup() {
    if (closed) return;
    closed = true; handshake.abort();
    clearTimeout(handshakeTimer); clearTimeout(finishTimer); clearTimeout(idleTimer); clearTimeout(lifeTimer);
    try { upstream?.close(1000, 'Finished'); } catch { /* Already closed. */ }
    try { downstream.close(1000, 'Finished'); } catch { /* Already closed. */ }
    ctx.waitUntil(settleSpeech(db, leaseId, bytes).catch(() => { /* Keep full reservation on accounting failure. */ }));
  }
  function fail(code: string) { output({ type: 'error', code }); cleanup(); }
  function finish() {
    if (closed || finishing) return;
    finishing = true; output({ type: 'stopping' });
    if (!ready) { fail('connection'); return; }
    try { send('session.finish'); } catch { fail('connection'); return; }
    finishTimer = setTimeout(() => fail('timeout'), 10000);
  }
  downstream.addEventListener('close', cleanup);
  downstream.addEventListener('error', cleanup);
  downstream.addEventListener('message', event => {
    if (closed || finishing) return;
    if (typeof event.data === 'string') {
      if (event.data === '{"type":"finish"}') finish();
      else fail('invalid');
      return;
    }
    if (!ready || !(event.data instanceof ArrayBuffer) || !event.data.byteLength || event.data.byteLength > 16000 || event.data.byteLength % 2) { fail('invalid'); return; }
    const size = event.data.byteLength;
    if (bytes + size > SPEECH_MAX_SECONDS * 32000 || bytes + size > ((Date.now() - started) / 1000 + 5) * 32000) { finish(); return; }
    clearTimeout(idleTimer); idleTimer = setTimeout(finish, 15000);
    const samples = new Uint8Array(event.data);
    const audio = btoa(Array.from(samples, byte => String.fromCharCode(byte)).join(''));
    // Account before sending: even an ambiguous send remains covered by the reservation.
    bytes += size;
    try { send('input_audio_buffer.append', { audio }); } catch { fail('connection'); }
  });
  ctx.waitUntil((async () => {
    let phase = 'upgrade';
    try {
      const url = new URL(config.url!); url.protocol = 'https:';
      const response = await fetch(url, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${config.key}` }, redirect: 'manual', signal: handshake.signal });
      clearTimeout(handshakeTimer);
      upstream = response.webSocket ?? undefined;
      if (!upstream || response.status !== 101) {
        console.warn('cloud_speech_transport', { phase, status: response.status });
        fail([401,403].includes(response.status) ? 'configuration' : 'connection'); return;
      }
      phase = 'session';
      upstream.accept();
      if (closed) { upstream.close(); return; }
      upstream.addEventListener('message', event => {
        if (closed || typeof event.data !== 'string' || event.data.length > 64000) return;
        let e: Record<string, unknown>;
        try { e = JSON.parse(event.data); } catch { fail('connection'); return; }
        if (e.type === 'error' || e.code || e.type === 'conversation.item.input_audio_transcription.failed') {
          const code = String(e.code ?? (e.error as { code?: string })?.code ?? 'provider');
          console.warn('cloud_speech_error', { code: /^[\w.-]{1,80}$/.test(code) ? code : 'provider' });
          fail(/AccessDenied|InvalidApiKey|Unpurchased/i.test(code) ? 'configuration' : 'provider'); return;
        }
        if (e.type === 'session.updated') {
          ready = true; output({ type: 'ready', sessionId: leaseId });
          lifeTimer = setTimeout(finish, SPEECH_MAX_SECONDS * 1000);
          idleTimer = setTimeout(finish, 15000);
        }
        const update = transcript.consume(e, bytes);
        if (update) output({ type: 'update', update });
        if (e.type === 'session.finished') cleanup();
      });
      upstream.addEventListener('close', () => { if (!closed) fail('connection'); });
      upstream.addEventListener('error', () => fail('connection'));
      send('session.update', { session: QWEN_SESSION });
      finishTimer = setTimeout(() => { if (!ready) fail('timeout'); }, 10000);
    } catch (error) {
      // Never log provider bodies, request objects, URLs, or arbitrary error messages.
      console.warn('cloud_speech_transport', { phase, reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network' });
      if (!closed) fail('connection');
    }
  })());
  return new Response(null, { status: 101, webSocket: client });
}
