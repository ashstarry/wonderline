import { getOpenRouterConfig, jsonResponse } from '../../../lib/openrouter';

export const dynamic = 'force-dynamic';
export async function GET() {
  const { key, model } = await getOpenRouterConfig();
  const env = (await import('cloudflare:workers')).env as unknown as Record<string, unknown>;
  const asr = { provider: env.ASR_PROVIDER === 'openrouter' ? 'openrouter-rolling' : 'aliyun-qwen-realtime', model: env.ASR_PROVIDER === 'openrouter' ? String(env.OPENROUTER_ASR_MODEL || 'microsoft/mai-transcribe-2') : 'qwen3-asr-flash-realtime' };
  return jsonResponse({ app: 'softspoken', configured: Boolean(key), model, asr });
}
