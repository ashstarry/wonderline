import { routerSpeechWebSocket } from './router-speech';
import type { SpeechEnv } from './cloud-speech';
import type { ChineseAcousticActivity as AcousticActivity } from './chinese-neural-activity';
import {isPagesRequest} from './studio-origin';

/** Clean speech for current frontends. Legacy /realtime keeps its old behavior. */
export async function speechOnlyEnglishWebSocket(request: Request, env: SpeechEnv, ctx: ExecutionContext, activityFactory?: () => Promise<AcousticActivity>) {
  const url = new URL(request.url);
  const sameOrigin = request.headers.get('origin') === url.origin && request.headers.get('sec-fetch-site') !== 'cross-site';
  if (url.pathname !== '/api/speech/english' || url.protocol !== 'https:' || url.search ||
    !(sameOrigin || (env.PUBLIC_ACCESS_ENABLED === 'true' && isPagesRequest(request))) ||
    url.origin === 'https://ashstarry.github.io') return Response.json({ error: 'Open the cloud studio to record.' }, { status: 403 });
  if (env.ASR_PROVIDER !== 'openrouter') return Response.json({ error: 'Voice is not available yet.' }, { status: 503 });
  return routerSpeechWebSocket(request, env, ctx, true, activityFactory);
}
