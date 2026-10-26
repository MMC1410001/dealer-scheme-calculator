/**
 * Fixed-window rate limits of the API: at most `limit` requests for each key in each window, then
 * 429 RATE_LIMITED with Retry-After.
 *
 * Three limiters (RATE_LIMIT_ENABLED=false turns all three off):
 * - ip: RATE_LIMIT_PER_SECOND for each client IP, on every /api/* path except the health probe. Runs first,
 *   before authentication and before the body is read.
 * - token: TOKEN_RATE_LIMIT_PER_MINUTE for each client IP, on POST /api/v1/auth/token only. A client needs one
 *   token an hour, so a burst there is a client that does not reuse its token.
 * - client: API_RATE_LIMIT_PER_MINUTE for each client_id, on the dealer status endpoint, after authentication.
 *
 * Counts live in Redis (REDIS_URL), so that the limit holds across processes and servers. Key:
 * scheme:rate[:<name>]:<key>:<window>, with INCR and EXPIRE window+1 in one pipeline. If REDIS_URL is not set,
 * or Redis fails, each process counts in memory (the limit then applies for each process) and Redis is tried
 * again after 30 s.
 *
 * The client IP comes from clientIpFromHeaders (TRUSTED_PROXY_HOPS). With 0 hops, all callers share one bucket.
 */
import { clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { RedisBackoff, redisProvider, type RedisProvider } from "@/server/redis";
import type { ApiConfig } from "@/server/config";

export const KEY_PREFIX = "scheme:rate";
/** Upper limit of in-memory keys in one window. More keys share one bucket, so that memory stays small. */
const MAX_MEMORY_KEYS = 10_000;
const OVERFLOW_KEY = "__overflow__";

export type TakeResult = { allowed: true; count: number } | { allowed: false; count: number; retryAfterSeconds: number };

export interface RateLimiterLike {
  take(key: string): Promise<TakeResult>;
}

export interface FixedWindowOptions {
  /** Keeps the Redis counts of this limiter apart. No name = the per-IP limiter. */
  name?: string;
  limit: number;
  windowSec: number;
  redis?: RedisProvider | null;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

export class FixedWindowLimiter implements RateLimiterLike {
  readonly backoff: RedisBackoff;
  private window = -1;
  private counts = new Map<string, number>();

  constructor(readonly opts: FixedWindowOptions) {
    this.backoff = new RedisBackoff(`rate-limit${opts.name ? `:${opts.name}` : ""}`, "count in memory for each process");
  }

  redisKey(key: string, window: number): string {
    return `${KEY_PREFIX}${this.opts.name ? `:${this.opts.name}` : ""}:${key}:${window}`;
  }

  async take(key: string): Promise<TakeResult> {
    const now = this.opts.now ? this.opts.now() : Date.now();
    const nowSec = now / 1000;
    const window = Math.floor(nowSec / this.opts.windowSec);
    const count = await this.count(key, window, now);
    if (count > this.opts.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((window + 1) * this.opts.windowSec - nowSec));
      return { allowed: false, count, retryAfterSeconds };
    }
    return { allowed: true, count };
  }

  /** This key's requests in the current window, this one included. */
  private async count(key: string, window: number, now: number): Promise<number> {
    const provider = this.opts.redis;
    if (provider && !this.backoff.isDown(now)) {
      try {
        const redis = await provider();
        const k = this.redisKey(key, window);
        const res = await redis.pipeline().incr(k).expire(k, this.opts.windowSec + 1).exec();
        if (!res || res.length < 1) throw new Error("Redis pipeline returned no result");
        const [err, value] = res[0];
        if (err) throw err;
        const n = Number(value);
        if (!Number.isFinite(n)) throw new Error("Redis INCR returned a value that is not a number");
        return n;
      } catch (err) {
        this.backoff.fail(err, now);
      }
    }
    if (window !== this.window) {
      this.window = window;
      this.counts = new Map();
    }
    const k = this.counts.has(key) || this.counts.size < MAX_MEMORY_KEYS ? key : OVERFLOW_KEY;
    const n = (this.counts.get(k) ?? 0) + 1;
    this.counts.set(k, n);
    return n;
  }
}

type LimiterName = "ip" | "token" | "client";

interface Registry {
  sig: Record<LimiterName, string>;
  limiters: Partial<Record<LimiterName, FixedWindowLimiter>>;
}
const g = globalThis as unknown as { __schemeRateLimiters?: Registry };

function limiterSpec(name: LimiterName, cfg: ApiConfig): FixedWindowOptions {
  const redis = redisProvider("rate", cfg.redisUrl);
  if (name === "ip") return { limit: cfg.rateLimitPerSecond, windowSec: 1, redis };
  if (name === "token") return { name: "token", limit: cfg.tokenRateLimitPerMinute, windowSec: 60, redis };
  return { name: "client", limit: cfg.apiRateLimitPerMinute, windowSec: 60, redis };
}

/**
 * The shared limiter (one for each process, on globalThis), or null when RATE_LIMIT_ENABLED=false.
 * A new limiter starts when its limit or REDIS_URL changes.
 */
export function getLimiter(name: LimiterName, cfg: ApiConfig): FixedWindowLimiter | null {
  if (!cfg.rateLimitEnabled) return null;
  const spec = limiterSpec(name, cfg);
  const sig = `${spec.limit}|${spec.windowSec}|${cfg.redisUrl ?? ""}`;
  const reg = (g.__schemeRateLimiters ??= { sig: { ip: "", token: "", client: "" }, limiters: {} });
  let l = reg.limiters[name];
  if (!l || reg.sig[name] !== sig) {
    l = new FixedWindowLimiter(spec);
    reg.limiters[name] = l;
    reg.sig[name] = sig;
  }
  return l;
}

/** For tests: forget all shared limiters (counts start from zero). */
export function resetLimitersForTests(): void {
  delete g.__schemeRateLimiters;
}

/** Client IP key for the ip and token limiters. */
export function clientIpKey(headers: Headers, cfg: ApiConfig): string {
  return clientIpFromHeaders(headers, cfg.trustedProxyHops);
}
