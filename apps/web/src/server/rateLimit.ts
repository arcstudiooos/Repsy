export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until a token is available again; 0 when allowed. */
  retryAfterMs: number;
}

/** Swap for a shared store (Redis/Postgres) when the app runs on more than one instance. */
export interface RateLimiter {
  consume(key: string): RateLimitResult | Promise<RateLimitResult>;
}

export interface TokenBucketOptions {
  capacity: number;
  refillPerSecond: number;
  now?: () => number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MAX_BUCKETS = 10_000;

/** Single-instance pilot limiter: per-process token bucket. */
export class InMemoryRateLimiter implements RateLimiter {
  // Anonymous (ip:) buckets live apart from user buckets so IP floods cannot evict users.
  private readonly userBuckets = new Map<string, Bucket>();
  private readonly ipBuckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(private readonly options: TokenBucketOptions) {
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitResult {
    const { capacity, refillPerSecond } = this.options;
    const now = this.now();
    const buckets = key.startsWith('ip:') ? this.ipBuckets : this.userBuckets;
    const prev = buckets.get(key);
    const tokens = prev
      ? Math.min(capacity, prev.tokens + ((now - prev.updatedAt) / 1000) * refillPerSecond)
      : capacity;
    buckets.delete(key); // re-insert so Map order tracks recency
    if (tokens >= 1) {
      buckets.set(key, { tokens: tokens - 1, updatedAt: now });
      this.evict(buckets);
      return { allowed: true, retryAfterMs: 0 };
    }
    buckets.set(key, { tokens, updatedAt: now });
    this.evict(buckets);
    return { allowed: false, retryAfterMs: Math.ceil(((1 - tokens) / refillPerSecond) * 1000) };
  }

  private evict(buckets: Map<string, Bucket>): void {
    while (buckets.size > MAX_BUCKETS) {
      const oldest = buckets.keys().next();
      if (oldest.done) return;
      buckets.delete(oldest.value);
    }
  }
}

/** 120 requests burst, 2/s sustained, per user (or per IP when anonymous). */
export const defaultLimiter: RateLimiter = new InMemoryRateLimiter({
  capacity: 120,
  refillPerSecond: 2,
});
