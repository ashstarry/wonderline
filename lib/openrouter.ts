import type { DrawingTrace } from './diagnostics';
import { isStudioRequest } from './studio-origin';
import { hostingConfig, visitorKey } from './speech-host';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { requestLimiter, type RequestBucket } from './request-rate-limit';
import { DEFAULT_DRAWING_MODEL } from './drawing-model';
import { ModelStreamError, readOpenRouterStream } from './openrouter-stream';
import { DrawingFailure, drawingFailureKind, httpDrawingFailureKind, type DrawingFailureKind } from './drawing-failure';

export const DEFAULT_MODEL = DEFAULT_DRAWING_MODEL;
export class ApiError extends DrawingFailure {
  constructor(public status: number, message: string, kind: DrawingFailureKind = httpDrawingFailureKind(status)) { super(message, kind); }
}

export async function getOpenRouterConfig() {
  // Runtime Worker bindings are authoritative. process.env supports local Node tooling.
  let bindings: Record<string, unknown> = {};
  try { bindings = (await import('cloudflare:workers')).env as unknown as Record<string, unknown>; } catch { /* Non-Worker local tools. */ }
  const key = String(bindings.OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY ?? '').trim();
  const model = String(bindings.OPENROUTER_MODEL ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL).trim();
  return { key, model: model || DEFAULT_MODEL };
}

export async function authorizeRequest(request: Request, bucket: RequestBucket = 'transcribe') {
  const user = await getChatGPTUser();
  const hosted = await hostingConfig();
  if (!user && !hosted.publicAccess) throw new ApiError(401, '请先登录，再把心里的风景说给我听。');
  if (!isStudioRequest(request, hosted.publicAccess)) throw new ApiError(403, '请从画室页面发起请求。');
  // During testing, drawing requests have no app-imposed count quota, including
  // speculative pipeline work. Provider spending limits remain independent.
  // Keep authentication and same-origin checks above for every request.
  if (bucket !== 'imagine' && !requestLimiter.allow(user?.userId || await visitorKey(request), bucket)) throw new ApiError(429, '画笔有点忙，稍等片刻再试。');
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, '请使用画室里的输入框或录音按钮。');
  if (Number(request.headers.get('content-length')) > maxBytes) throw new ApiError(413, '这次内容有点长，请缩短后再试。');
  if (!request.body) throw new ApiError(400, '还没有收到内容。');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new ApiError(413, '这次内容有点长，请缩短后再试。'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, '这次内容没有完整送到，请再试一次。');
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function errorResponse(error: unknown) {
  return error instanceof ApiError
    ? jsonResponse({ error: error.message, failureKind: error.kind }, error.status)
    : jsonResponse({ error: '画笔暂时停了一下，画面已经保留，请稍后重试。', failureKind: drawingFailureKind(error) }, 502);
}

async function* openRouterParts(body: Record<string, unknown>, requestSignal: AbortSignal | undefined, streaming: boolean, modelOverride?: string, observation?: DrawingTrace): AsyncGenerator<string> {
  if (requestSignal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const { key, model: configuredModel } = await getOpenRouterConfig();
  const model = modelOverride ?? configuredModel;
  if (!key) throw new ApiError(503, '画室的 AI 还没有接通。请先配置 OpenRouter，再来试试。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  const cancel = () => controller.abort();
  requestSignal?.addEventListener('abort', cancel, { once: true });
  if (requestSignal?.aborted) cancel();
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: streaming ? 'text/event-stream' : 'application/json', 'X-Title': 'Wonderline' },
      body: JSON.stringify({ temperature: 0.2, provider: { require_parameters: true }, ...body, model, stream: streaming }),
    });
    observation?.upstream(response);
    if (!response.ok) {
      // Log only bounded transport metadata, never response bodies, prompts,
      // scene content or credentials. Provider errors can echo request data.
      const trace = response.headers.get('x-request-id') ?? response.headers.get('x-openrouter-request-id') ?? response.headers.get('cf-ray');
      const requestId = trace && /^[A-Za-z0-9_.:-]{1,128}$/.test(trace) && !/^sk-/i.test(trace) ? trace : undefined;
      console.warn('OpenRouter request failed', { status: response.status, ...(requestId ? { requestId } : {}) });
      if (response.status === 429) throw new ApiError(429, 'AI 现在有些忙，请稍等一会儿再试。');
      if (response.status === 402) throw new ApiError(503, 'OpenRouter 余额不足，补充后就可以继续画。');
      if ([401, 403].includes(response.status)) throw new ApiError(503, 'OpenRouter 连接配置需要检查，画面已保留。');
      throw new ApiError(502, 'AI 暂时没有回应，画面已保留，请稍后再试。');
    }
    if (streaming) {
      if (!response.body) throw new ModelStreamError('incomplete');
      yield* readOpenRouterStream(response.body, { signal: controller.signal });
    } else {
      const result = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] };
      const choice = result.choices?.[0];
      if (choice?.finish_reason === 'length') throw new ApiError(502, '这次画面变化有点多，试着分两句话说吧。', 'turn');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new ApiError(502, '这次画面没有完整生成，原画已经保留。', 'turn');
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.length > 120_000) throw new ApiError(502, '这次没有收到完整的回应，请再试一次。', 'turn');
      yield content.trim();
    }
  } catch (error) {
    observation?.upstreamError(error, controller.signal.aborted && !requestSignal?.aborted, !!requestSignal?.aborted);
    if (requestSignal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(504, '这一笔等得有点久。可以接着说新想法，这句话也替你留着。', 'turn');
    if (error instanceof ModelStreamError) {
      console.warn('OpenRouter stream failed', { kind: error.kind });
      throw new ApiError(502, error.kind === 'length'
        ? '这次画面变化有点多，试着分两句话说吧。'
        : '这次画面没有完整接好，原画已经保留，请再试一次。', error.kind === 'upstream' ? 'service' : 'turn');
    }
    if (error instanceof SyntaxError) throw new ApiError(502, '这次画面没有完整接好，原画已经保留，请再试一次。', 'turn');
    throw new ApiError(502, '暂时连不上 AI，画面已经保留，请稍后再试。');
  } finally {
    clearTimeout(timer);
    requestSignal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}

export async function openRouterCompletion(body: Record<string, unknown>, requestSignal?: AbortSignal, modelOverride?: string, observation?: DrawingTrace): Promise<string> {
  let content = '';
  for await (const part of openRouterParts(body, requestSignal, false, modelOverride, observation)) content += part;
  return content;
}

export function openRouterStreamingCompletion(body: Record<string, unknown>, requestSignal?: AbortSignal, modelOverride?: string, observation?: DrawingTrace): AsyncGenerator<string> {
  return openRouterParts(body, requestSignal, true, modelOverride, observation);
}
