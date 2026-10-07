/**
 * In-memory rate limiter (sliding window) + helpers.
 * Keyed by ip/route/user — adequate for a single-node deployment.
 */
const buckets = new Map<string, number[]>();

export interface RateInfo {
  ok: boolean;
  /** ms until the oldest attempt leaves the window (0 when ok) */
  retryAfterMs: number;
  /** attempts left in the current window */
  remaining: number;
}

/** Rich variant — lets API responses tell clients exactly when to retry. */
export function rateLimitInfo(key: string, limit: number, windowMs: number): RateInfo {
  const now = Date.now();
  let arr = buckets.get(key);
  if (!arr) { arr = []; buckets.set(key, arr); }
  while (arr.length && arr[0] <= now - windowMs) arr.shift();
  if (arr.length >= limit) {
    return { ok: false, retryAfterMs: Math.max(1000, arr[0] + windowMs - now), remaining: 0 };
  }
  arr.push(now);
  return { ok: true, retryAfterMs: 0, remaining: limit - arr.length };
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  return rateLimitInfo(key, limit, windowMs).ok;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'local';
}

// periodic cleanup to avoid unbounded growth
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of buckets) {
      const alive = arr.filter((t) => t > now - 3600_000);
      if (alive.length === 0) buckets.delete(k); else buckets.set(k, alive);
    }
  }, 10 * 60_000);
  (timer as unknown as { unref?: () => void }).unref?.();
}
