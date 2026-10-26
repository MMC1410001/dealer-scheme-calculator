/**
 * Optional Redis cache of dealer status responses: on only when CACHE_ENABLED=true and REDIS_URL is set.
 *
 * The results change only after a data load (engine run). So each answer is kept in Redis, keyed by
 * endpoint and request, and served from there until the next engine run.
 *
 * Fresh data: every key has a data version (Redis key scheme:data-version, missing = 0). runEngine and
 * db:seed increase it (bumpDataVersion) after their commit. Old keys are then never read again and expire
 * after CACHE_TTL_SECONDS. Each process reads the version again at most every 5 s.
 *
 * Redis is never required: if it is down, slow or the version is not a number, the request is answered
 * from PostgreSQL (X-Cache: BYPASS) and Redis is not tried again for 30 s.
 *
 * A saved reward choice also increases the version (src/server/reward-choice-store.ts), because the response has it.
 *
 * Key: scheme:v2:<data version>:<key>. Bump KEY_PREFIX when the response shape changes (v2: reward_choice, 22-10-2026).
 */
import { RedisBackoff, redisErrorText, redisProvider, withRedis, type RedisProvider } from "@/server/redis";
import type { ApiConfig, Env } from "@/server/config";

export const KEY_PREFIX = "scheme:v2";
export const VERSION_KEY = "scheme:data-version";
export const VERSION_CHECK_MS = 5_000;

export type CacheState = "HIT" | "MISS" | "BYPASS";

/** What is stored: the HTTP status, the error code (for the log line) and the JSON body text. */
export interface CacheEntry {
  status: number;
  code: string | null;
  body: string;
}

export interface BuildResult {
  entry: CacheEntry;
  /** False for answers that must not be cached. */
  cacheable: boolean;
}

export interface CacheOptions {
  redis: RedisProvider;
  ttlSeconds: number;
  versionCheckMs?: number;
  now?: () => number;
}

export class ResponseCache {
  readonly backoff = new RedisBackoff("response-cache", "answer from the database");
  private version: number | null = null;
  private versionReadAt = 0;

  constructor(readonly opts: CacheOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async dataVersion(redis: Awaited<ReturnType<RedisProvider>>): Promise<number> {
    const now = this.now();
    const every = this.opts.versionCheckMs ?? VERSION_CHECK_MS;
    if (this.version === null || now - this.versionReadAt >= every) {
      const raw = await redis.get(VERSION_KEY);
      const text = raw === null ? "" : raw.trim();
      if (text !== "" && !/^\d+$/.test(text)) throw new Error("The cache data version is not a number");
      this.version = text === "" ? 0 : Number(text);
      this.versionReadAt = now;
    }
    return this.version;
  }

  /** The cached answer for key, or build() and cache it when it is cacheable. */
  async getOrBuild(key: string, build: () => Promise<BuildResult>): Promise<{ entry: CacheEntry; state: CacheState }> {
    if (this.backoff.isDown(this.now())) return { entry: (await build()).entry, state: "BYPASS" };
    let fullKey: string;
    let redis: Awaited<ReturnType<RedisProvider>>;
    try {
      redis = await this.opts.redis();
      fullKey = `${KEY_PREFIX}:${await this.dataVersion(redis)}:${key}`;
      const cached = await redis.get(fullKey);
      const entry = cached === null ? null : parseEntry(cached);
      if (entry) return { entry, state: "HIT" };
    } catch (err) {
      this.backoff.fail(err, this.now());
      return { entry: (await build()).entry, state: "BYPASS" };
    }
    const built = await build();
    if (!built.cacheable) return { entry: built.entry, state: "MISS" };
    try {
      await redis.set(fullKey, JSON.stringify(built.entry), "EX", this.opts.ttlSeconds);
    } catch (err) {
      this.backoff.fail(err, this.now());
      return { entry: built.entry, state: "BYPASS" };
    }
    return { entry: built.entry, state: "MISS" };
  }
}

function parseEntry(text: string): CacheEntry | null {
  try {
    const v = JSON.parse(text) as Partial<CacheEntry>;
    if (typeof v.status === "number" && typeof v.body === "string" && (typeof v.code === "string" || v.code === null)) {
      return { status: v.status, code: v.code, body: v.body };
    }
  } catch {
    /* a value that is not ours: treat as a miss and overwrite */
  }
  return null;
}

export function cacheOn(cfg: Pick<ApiConfig, "cacheEnabled" | "redisUrl">): boolean {
  return cfg.cacheEnabled && !!cfg.redisUrl;
}

const g = globalThis as unknown as { __schemeResponseCache?: { sig: string; cache: ResponseCache } };

/** The shared cache (one for each process), or null when the cache is off. */
export function getResponseCache(cfg: ApiConfig): ResponseCache | null {
  if (!cacheOn(cfg)) return null;
  const sig = `${cfg.redisUrl}|${cfg.cacheTtlSeconds}`;
  if (!g.__schemeResponseCache || g.__schemeResponseCache.sig !== sig) {
    const redis = redisProvider("cache", cfg.redisUrl)!;
    g.__schemeResponseCache = { sig, cache: new ResponseCache({ redis, ttlSeconds: cfg.cacheTtlSeconds }) };
  }
  return g.__schemeResponseCache.cache;
}

/**
 * Called after new results are committed (runEngine, db:seed), so that cached answers are replaced.
 * No-op when the cache is off. A Redis failure only writes a warning: cached answers then expire within the TTL.
 */
export async function bumpDataVersion(env: Env = process.env): Promise<number | null> {
  const enabled = ["true", "1", "yes", "on"].includes((env.CACHE_ENABLED ?? "").trim().toLowerCase());
  const url = (env.REDIS_URL ?? "").trim();
  if (!enabled || !url) return null;
  try {
    const version = await withRedis(url, (r) => r.incr(VERSION_KEY));
    console.log(JSON.stringify({ evt: "cache_data_version", version }));
    return version;
  } catch (err) {
    console.warn(
      JSON.stringify({
        evt: "cache_data_version_failed",
        error: redisErrorText(err),
        note: "cached responses expire within CACHE_TTL_SECONDS",
      }),
    );
    return null;
  }
}
