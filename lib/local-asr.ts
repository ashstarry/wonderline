const DEFAULT_LOCAL_ASR_URL = 'http://127.0.0.1:8765';
export const DEFAULT_LOCAL_ASR_MODEL = 'mlx-community/Qwen3-ASR-1.7B-8bit';

export class LocalAsrError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type LocalOptions = { baseUrl?: string; fetchImpl?: typeof fetch };

export function validateLocalAsrUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new LocalAsrError(503, '本机语音服务地址需要检查。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new LocalAsrError(503, '语音识别只能连接这台电脑上的 Qwen3-ASR 服务。');
  }
  return url.origin;
}

async function localBaseUrl(override?: string): Promise<string> {
  if (override !== undefined) return validateLocalAsrUrl(override);
  let bindings: Record<string, unknown> = {};
  try { bindings = (await import('cloudflare:workers')).env as unknown as Record<string, unknown>; } catch { /* Local Node tooling. */ }
  const value = String(bindings.LOCAL_ASR_URL ?? process.env.LOCAL_ASR_URL ?? DEFAULT_LOCAL_ASR_URL).trim();
  return validateLocalAsrUrl(value);
}

async function requestLocal(path: '/health' | '/transcribe', init: RequestInit, timeoutMs: number, options: LocalOptions = {}, signal?: AbortSignal) {
  const baseUrl = await localBaseUrl(options.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancel, { once: true });
  try {
    // A local service must never redirect audio to an external URL.
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}${path}`, { ...init, redirect: 'manual', signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new LocalAsrError(503, '本机语音服务返回了跳转，已停止发送声音。请检查本机服务。');
    let body: unknown;
    if (response.ok) {
      try { body = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new LocalAsrError(504, '本机语音识别这次有点慢，可以重试或先打字。');
        throw new LocalAsrError(502, '本机语音识别没有返回完整内容，请再试一次。');
      }
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (error instanceof LocalAsrError) throw error;
    if (controller.signal.aborted) throw new LocalAsrError(504, '本机语音识别这次有点慢，可以重试或先打字。');
    throw new LocalAsrError(503, '还没连上本机 Qwen3-ASR。请先启动电脑上的语音服务，也可以直接打字。');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function getLocalAsrStatus(options: LocalOptions = {}) {
  const unavailable = { provider: 'local-qwen' as const, ready: false, model: DEFAULT_LOCAL_ASR_MODEL };
  try {
    const response = await requestLocal('/health', { method: 'GET', headers: { Accept: 'application/json' } }, 1000, options);
    if (!response.ok) return unavailable;
    const body = response.body as { ready?: unknown; model?: unknown };
    if (body?.ready !== true) return unavailable;
    const model = typeof body.model === 'string' && body.model.length > 0 && body.model.length <= 160 ? body.model : DEFAULT_LOCAL_ASR_MODEL;
    return { ...unavailable, ready: true, model };
  } catch { return unavailable; }
}

export async function transcribeLocally(audio: string, signal?: AbortSignal, options: LocalOptions = {}): Promise<string> {
  const response = await requestLocal('/transcribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ audio, format: 'wav' }),
  }, 60_000, options, signal);
  if (!response.ok) {
    if (response.status === 413) throw new LocalAsrError(400, '这段声音有点长，请录一段 30 秒以内的声音。');
    throw new LocalAsrError(503, '本机 Qwen3-ASR 暂时没准备好，请稍后再试，也可以直接打字。');
  }
  const body = response.body as { text?: unknown };
  if (typeof body?.text !== 'string' || body.text.length > 600) throw new LocalAsrError(502, '这次没有听清，试着再说一遍，或直接打字。');
  return body.text.trim();
}
