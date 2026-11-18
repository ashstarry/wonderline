/** Exact public frontend addresses only; no wildcard origins or credentials. */
export const PAGES_ORIGIN = 'https://ashstarry.github.io';
export const PUBLIC_FRONTEND_ORIGINS = new Set([PAGES_ORIGIN, 'https://wonderline.fun', 'https://www.wonderline.fun']);
const publicPaths = new Set(['/api/status', '/api/imagine', '/api/speech/health', '/api/speech/realtime', '/api/speech/english', '/api/speech/health-chinese', '/api/speech/chinese', '/api/speech/chinese-clean']);
export function isPagesRequest(request: Request) {
 return PUBLIC_FRONTEND_ORIGINS.has(request.headers.get('origin') || '') && publicPaths.has(new URL(request.url).pathname);
}
export function isStudioRequest(request: Request, publicAccess: boolean, requireOrigin = false) {
 const origin = request.headers.get('origin');
 if (publicAccess && isPagesRequest(request)) return true;
 return request.headers.get('sec-fetch-site') !== 'cross-site' && (origin ? origin === new URL(request.url).origin : !requireOrigin);
}
export function pagesPreflight(request: Request, publicAccess: boolean): Response | undefined {
 if (request.method !== 'OPTIONS' || !new URL(request.url).pathname.startsWith('/api/')) return;
 const allowedHeaders = (request.headers.get('access-control-request-headers') || '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
 if (!publicAccess || !isPagesRequest(request) || !['GET','POST'].includes(request.headers.get('access-control-request-method') || '') || allowedHeaders.some(v=>!['content-type','accept'].includes(v))) return new Response(null,{status:403});
 return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':request.headers.get('origin')!,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Accept','Access-Control-Max-Age':'600',Vary:'Origin'}});
}
export function pagesResponse(request: Request, response: Response, publicAccess: boolean) {
 if (!publicAccess || !isPagesRequest(request) || response.status === 101) return response;
 const headers = new Headers(response.headers);
 headers.set('Access-Control-Allow-Origin',request.headers.get('origin')!);
 headers.append('Vary','Origin');
 // Keep the original stream: no buffering, cloning or parsing of drawing chunks.
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
