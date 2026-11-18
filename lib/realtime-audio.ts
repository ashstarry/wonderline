import type { StreamingHandle, StreamingOptions, StreamingUpdate } from './audio';
import { speechEndpoint } from './speech-endpoint';

const messages: Record<string, string> = {
  configuration: '云端语音尚未开通，请稍后再试。之前的文字已经保留。',
  connection: '语音连接中断，之前的文字已经保留。请重新开始。',
  timeout: '语音回应等得有点久，之前的文字已经保留。请重新开始。',
  provider: '云端语音暂时忙碌，之前的文字已经保留。请稍后再试。',
  invalid: '这段声音没有完整送到，请重新开始。',
};

/** One duplex browser connection; the cloud owns recognition and buffering. */
export function realtimeTransport(options: StreamingOptions, stopInput: () => void) {
  const url = new URL(speechEndpoint('realtime', options.endpoint, options.language));
  const finishTimeout = ['/api/speech/chinese', '/api/speech/chinese-clean'].includes(url.pathname) ? 20000 : 12000;
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  let closed = false, stopped = false, ready = false, finishSent = false, sessionId = '', revision = 0, received = 0;
  let queue: ArrayBuffer[] = [], remainder = new Float32Array(0);
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveDone!: (update: StreamingUpdate) => void, rejectDone!: (error: Error) => void;
  const done = new Promise<StreamingUpdate>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  void done.catch(() => undefined);
  const seen = new Set<string>();
  const connectionTimer = setTimeout(() => fail(new Error(messages.connection)), 18000);
  const pumpTimer = setInterval(pump, 50);
  function release() {
    stopInput(); clearTimeout(connectionTimer); clearTimeout(stopTimer); clearInterval(pumpTimer);
    options.signal?.removeEventListener('abort', cancel);
    window.removeEventListener('pagehide', cancel);
    queue = []; remainder = new Float32Array(0);
    try { socket.close(); } catch { /* A connecting socket may already be closing. */ }
    options.onBacklog?.(false); options.onLevel?.(0);
  }
  function fail(error: Error, report = true) {
    if (closed) return;
    closed = stopped = true; release(); rejectDone(error);
    if (report) options.onError?.(error);
  }
  function cancel() { fail(new DOMException('这次录音已取消。', 'AbortError'), false); }
  function pcm(samples: Float32Array) {
    const buffer = new ArrayBuffer(samples.length * 2), view = new DataView(buffer);
    for (let i = 0; i < samples.length; i++) {
      const x = Math.max(-1, Math.min(1, samples[i] || 0));
      view.setInt16(i * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true);
    }
    return buffer;
  }
  function pump() {
    if (closed || !ready || socket.readyState !== WebSocket.OPEN) return;
    try {
      while (queue.length && socket.bufferedAmount < 128000) socket.send(queue.shift()!);
      options.onBacklog?.(queue.length > 10);
      if (stopped && !queue.length && !finishSent) {
        finishSent = true; socket.send('{"type":"finish"}');
        stopTimer = setTimeout(() => fail(new Error(messages.timeout)), finishTimeout);
      }
    } catch { fail(new Error(messages.connection)); }
  }
  function stop() {
    if (!closed && !stopped) {
      stopped = true; stopInput(); options.onCaptureStopped?.();
      if (remainder.length) { queue.push(pcm(remainder)); remainder = new Float32Array(0); }
      pump();
    }
    return done;
  }
  function feed(samples: Float32Array) {
    if (stopped || closed || !samples.length) return;
    const part = samples.subarray(0, Math.max(0, 300 * 16000 - received)); received += part.length;
    const combined = new Float32Array(remainder.length + part.length);
    combined.set(remainder); combined.set(part, remainder.length);
    let offset = 0;
    while (offset + 3200 <= combined.length) { queue.push(pcm(combined.subarray(offset, offset + 3200))); offset += 3200; }
    remainder = combined.slice(offset); pump();
    if (queue.length > 50) fail(new Error(messages.connection));
    else if (received >= 300 * 16000) void stop();
  }
  socket.addEventListener('message', event => {
    if (closed || typeof event.data !== 'string' || event.data.length > 100000) return;
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'error') { fail(new Error(messages[data.code] || messages.provider)); return; }
      if (data.type === 'ready' && typeof data.sessionId === 'string') {
        sessionId = data.sessionId; ready = true; clearTimeout(connectionTimer); pump(); return;
      }
      if (data.type === 'stopping') {
        stopped = finishSent = true; stopInput(); options.onCaptureStopped?.();
        queue = []; remainder = new Float32Array(0);
        stopTimer ??= setTimeout(() => fail(new Error(messages.timeout)), finishTimeout); return;
      }
      const u = data.update as StreamingUpdate;
      if (data.type !== 'update' || !u || u.sessionId !== sessionId || !['qwen-realtime', 'openrouter-rolling'].includes(u.mode) || !Number.isInteger(u.revision) || u.revision <= revision || typeof u.done !== 'boolean' || typeof u.partial !== 'string' || typeof u.stableText !== 'string' || !Array.isArray(u.segments) || u.segments.some(s => typeof s.id !== 'string' || typeof s.text !== 'string')) return;
      revision = u.revision;
      const update = { ...u, segments: u.segments.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; }) };
      options.onUpdate(update);
      if (u.done) { closed = stopped = true; release(); resolveDone(update); }
    } catch { fail(new Error(messages.connection)); }
  });
  socket.addEventListener('error', () => fail(new Error(messages.connection)));
  socket.addEventListener('close', () => { if (!closed) fail(new Error(messages.connection)); });
  options.signal?.addEventListener('abort', cancel, { once: true });
  window.addEventListener('pagehide', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  return { handle: { stop, cancel, done } as StreamingHandle, feed, fail, get closed() { return closed; } };
}
