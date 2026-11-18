/** Server-only public access and speech visitor identity. No local host is used. */
export async function hostingConfig() {
  let bindings: Record<string, unknown> = {};
  try { bindings = (await import('cloudflare:workers')).env as unknown as Record<string, unknown>; } catch { /* CLI tests */ }
  const value = (name: string) => String(bindings[name] ?? process.env[name] ?? '').trim();
  return { token: value('VISITOR_HASH_KEY'), publicAccess: value('PUBLIC_ACCESS_ENABLED') === 'true', db: bindings.DB as D1Database | undefined };
}
export async function visitorKey(request: Request) {
  const { token } = await hostingConfig();
  // CF supplies this header. Missing identity shares one bucket, never unlimited access.
  const address = request.headers.get('cf-connecting-ip') || 'shared-guest';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token || 'local'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(address));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}
