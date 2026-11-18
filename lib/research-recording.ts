/** Research text stays on the same-origin experimental Site, never the Pages gateway. */
export function researchTextEnabled(request: Request): boolean {
  try {
    const url = new URL(request.url), origin = request.headers.get('origin');
    return origin === url.origin && (url.hostname.endsWith('.chatgpt.site') || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
export function researchTextNoticeVisible(): boolean {
  return typeof window !== 'undefined' && (window.location.hostname.endsWith('.chatgpt.site') || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname));
}
