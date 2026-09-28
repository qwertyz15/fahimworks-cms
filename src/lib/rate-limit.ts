import "server-only";

/**
 * Token-bucket rate limiter. The default store is in-process memory, which is
 * correct for a single instance. For multi-instance deployments implement
 * `RateLimitStore` on top of Redis (e.g. with a Lua script) and call
 * `setRateLimitStore()` at startup.
 */

export interface RateLimitRule {
  /** Bucket capacity (max burst). */
  limit: number;
  /** Window in ms over which `limit` tokens are refilled. */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitStore {
  consume(key: string, rule: RateLimitRule): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

type Bucket = { tokens: number; updatedAt: number };

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  async consume(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);
    const refillPerMs = rule.limit / rule.windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: rule.limit, updatedAt: now };
    bucket.tokens = Math.min(rule.limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      return { success: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    this.buckets.set(key, bucket);
    return { success: false, remaining: 0, retryAfterMs: Math.ceil((1 - bucket.tokens) / refillPerMs) };
  }

  async reset(key: string) {
    this.buckets.delete(key);
  }

  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, b] of this.buckets) if (now - b.updatedAt > 3_600_000) this.buckets.delete(key);
  }
}

const globalStore = globalThis as unknown as { __rateLimitStore?: RateLimitStore };
let store: RateLimitStore = globalStore.__rateLimitStore ?? (globalStore.__rateLimitStore = new MemoryStore());

export function setRateLimitStore(next: RateLimitStore) {
  store = next;
  globalStore.__rateLimitStore = next;
}

export const RATE_LIMITS = {
  login: { limit: 5, windowMs: 15 * 60_000 },
  loginGlobalEmail: { limit: 10, windowMs: 60 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  fetch: { limit: 30, windowMs: 10 * 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
  publicApi: { limit: 120, windowMs: 60_000 },
} satisfies Record<string, RateLimitRule>;

export function rateLimit(key: string, rule: RateLimitRule) {
  return store.consume(key, rule);
}

export function resetRateLimit(key: string) {
  return store.reset(key);
}

export class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Too many requests. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} minute(s).`);
    this.name = "RateLimitError";
  }
}

export async function enforceRateLimit(key: string, rule: RateLimitRule) {
  const res = await rateLimit(key, rule);
  if (!res.success) throw new RateLimitError(res.retryAfterMs);
  return res;
}
