export type RequestBucket = 'imagine' | 'transcribe';
const LIMITS: Record<RequestBucket, number> = { imagine: 48, transcribe: 24 };
const WINDOW_MS = 60_000;

export function createRequestLimiter() {
  const recentRequests = new Map<string, number[]>();
  return {
    allow(userId: string, bucket: RequestBucket, now = Date.now()): boolean {
      if (!userId || !Object.hasOwn(LIMITS, bucket)) return false;
      const key = JSON.stringify([userId, bucket]);
      const entries = (recentRequests.get(key) ?? []).filter(time => now - time < WINDOW_MS);
      if (entries.length >= LIMITS[bucket]) return false;
      entries.push(now);
      recentRequests.set(key, entries);
      if (recentRequests.size > 1000) {
        for (const [oldKey, times] of recentRequests) if (!times.some(time => now - time < WINDOW_MS)) recentRequests.delete(oldKey);
      }
      return true;
    },
  };
}

export const requestLimiter = createRequestLimiter();
