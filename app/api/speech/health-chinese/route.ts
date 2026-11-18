import { chineseSpeechConfig, CHINESE_SPEECH_BUDGET } from '../../../../lib/chinese-router-speech';
import { speechBudgetAvailable } from '../../../../lib/speech-budget';
import type { SpeechEnv } from '../../../../lib/cloud-speech';
import { isPagesRequest, isStudioRequest } from '../../../../lib/studio-origin';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const denied = () => Response.json({ error: 'Open the studio to use Chinese.' }, { status: 403 });
  if (!isStudioRequest(request, false) && !isPagesRequest(request)) return denied();
  try {
    const env = (await import('cloudflare:workers')).env as unknown as SpeechEnv;
    if (!isStudioRequest(request, env.PUBLIC_ACCESS_ENABLED === 'true')) return denied();
    const config = chineseSpeechConfig(env);
    const ready = config.ready && !!env.DB && await speechBudgetAvailable(env.DB, CHINESE_SPEECH_BUDGET);
    return Response.json({ ready, startupError: false, model: config.model, language: 'zh', offline: false, transport: 'cloud', streaming: { mode: 'openrouter-rolling' } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ ready: false, error: '中文语音暂时无法连接，请稍后再试。' }, { status: 503 }); }
}
