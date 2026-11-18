import { cloudSpeechConfig, type SpeechEnv } from '../../../../lib/cloud-speech';
import { routerSpeechConfig } from '../../../../lib/router-speech';
import { ROUTER_BUDGET, QWEN_BUDGET, speechBudgetAvailable } from '../../../../lib/speech-budget';
import { QWEN_REALTIME_MODEL } from '../../../../lib/qwen-events';
import { jsonResponse } from '../../../../lib/openrouter';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const env = (await import('cloudflare:workers')).env as unknown as SpeechEnv;
    const router = env.ASR_PROVIDER === 'openrouter';
    const config = router ? routerSpeechConfig(env) : cloudSpeechConfig(env);
    const available = config.ready && !!env.DB && await speechBudgetAvailable(env.DB, router ? ROUTER_BUDGET : QWEN_BUDGET);
    return jsonResponse({ ready: available, startupError: false, model: router ? routerSpeechConfig(env).model : QWEN_REALTIME_MODEL, offline: false,
      streaming: { mode: router ? 'openrouter-rolling' : 'qwen-realtime' }, transport: 'cloud',
      ...(!available ? { error: '云端语音尚未开通，请稍后再试。之前的文字已经保留。' } : {}) });
  } catch { return jsonResponse({ ready: false, error: '语音服务暂时离线，请稍后再试。' }, 503); }
}
