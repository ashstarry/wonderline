import { isPagesBuild, studioApi } from './studio-endpoint';
/** Audio always goes to this website. There is no localhost ASR fallback. */
export function speechEndpoint(kind: 'health' | 'stream' | 'realtime', override?: string, language: 'en' | 'zh' = 'en') {
  const origin = typeof window !== 'undefined' ? window.location?.origin : undefined;
  const chinese = language === 'zh';
  const path = `/api/speech/${kind === 'realtime' ? (chinese ? (isPagesBuild() ? 'chinese-clean' : 'chinese') : 'english') : chinese && kind === 'health' ? 'health-chinese' : kind}`;
  const target = studioApi(path);
  if (!origin) {
    if (override && override !== path) throw new Error('Invalid speech endpoint');
    return path;
  }
  const expected = new URL(target, origin);
  const url = new URL(override ?? target, origin);
  if (url.origin !== expected.origin || url.pathname !== path || url.username || url.password || url.search || url.hash) throw new Error('Invalid speech endpoint');
  return url.href;
}
