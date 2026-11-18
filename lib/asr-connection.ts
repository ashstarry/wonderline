import { speechEndpoint } from './speech-endpoint';
/** Cloud configuration / budget check; never opens a microphone or runs inference. */
export const CLOUD_ASR_MODEL = 'qwen3-asr-flash-realtime';
const routerModels = ['qwen/qwen3-asr-1.7b', 'microsoft/mai-transcribe-2', 'elevenlabs/scribe-v2'];

const DEFAULT_TIMEOUT_MS = 8000;

export type AsrConnectionState = 'ready' | 'loading' | 'startup-error' | 'outdated' | 'unreachable';
export type AsrConnectionStatus = {
  state: AsrConnectionState;
  ready: boolean;
  message: string;
  model: string | null;
};
export type AsrConnectionOptions = {
  language?: 'en' | 'zh';
  signal?: AbortSignal;
  /** Only the same-origin website health endpoint is accepted. */
  endpoint?: string;
  timeoutMs?: number;
  /** Injectable for tests; production uses the browser's fetch. */
  fetchImpl?: typeof fetch;
};

const messages: Record<AsrConnectionState, string> = {
  ready: '语音已准备好。',
  loading: '语音服务正在准备，请稍等片刻。',
  'startup-error': '语音服务启动失败，请稍后再试。',
  outdated: '语音服务正在更新，请稍后再试。',
  unreachable: '语音服务暂时离线，请稍后再试。',
};

function result(state: AsrConnectionState, model: string | null = null): AsrConnectionStatus {
  return { state, ready: state === 'ready', message: messages[state], model };
}

function abortError() {
  return new DOMException('这次连接检查已取消。', 'AbortError');
}

/**
 * Resolve a visible connection status. Caller cancellation rejects with
 * AbortError; timeout/network/CORS failures resolve as unreachable, since the
 * browser cannot tell an inactive service from blocked local-network access.
 */
export async function checkAsrConnection(options: AsrConnectionOptions = {}): Promise<AsrConnectionStatus> {
  if (options.signal?.aborted) throw abortError();
  let endpoint: string;
  try { endpoint = speechEndpoint('health', options.endpoint, options.language); } catch { return result('unreachable'); }
  const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 10_000
    ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'GET', headers: { Accept: 'application/json' },
      mode: 'cors', credentials: endpoint.includes('/api/speech/') ? 'same-origin' : 'omit', cache: 'no-store', redirect: 'error',
      signal: controller.signal,
    });
    if (options.signal?.aborted) throw abortError();
    if (!response.ok) return result('unreachable');
    let health: unknown;
    try { health = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      return result('outdated');
    }
    if (options.signal?.aborted) throw abortError();
    if (!health || typeof health !== 'object' || Array.isArray(health)) return result('outdated');
    const data = health as Record<string, unknown>;
    const streaming = data.streaming as { mode?: unknown } | undefined;
    const chinese = endpoint.endsWith('/health-chinese');
    const supported = chinese
      ? data.language === 'zh' && ['fish-audio/transcribe-1','fish-audio/transcribe-1-pro','qwen/qwen3-asr-1.7b'].includes(String(data.model)) && streaming?.mode === 'openrouter-rolling'
      : (data.model === CLOUD_ASR_MODEL && streaming?.mode === 'qwen-realtime') || (routerModels.includes(String(data.model)) && streaming?.mode === 'openrouter-rolling');
    if (!supported || data.offline !== false ||
      typeof data.ready !== 'boolean' || typeof data.startupError !== 'boolean') return result('outdated');
    const model = String(data.model);
    if (data.startupError) return result('startup-error', model);
    return data.ready ? result('ready', model) : { ...result('loading', model), message: '云端语音尚未开通，请稍后再试。之前的文字已经保留。' };
  } catch {
    if (options.signal?.aborted) throw abortError();
    return result('unreachable');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
