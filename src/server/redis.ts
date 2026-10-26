/**
 * Redis connection for the rate limits and the response cache (REDIS_URL). Redis is never required:
 * when it is down or slow, the callers fall back (rate limits count in memory, the cache is bypassed)
 * and do not try Redis again for RETRY_AFTER_MS, so that a dead Redis does not slow every request.
 *
 * One ioredis client for each purpose, kept on globalThis (all route bundles share it):
 * - "rate": 100 ms command timeout (a rate-limit check must stay fast).
 * - "cache": 250 ms command timeout.
 * enableOfflineQueue is false: a command fails at once when the connection is not ready, and is not queued.
 * ioredis reconnects in the background.
 * A first connection that is in progress ("connecting", for example right after the server starts) is not a
 * failure: the caller waits for "ready", at most CONNECT_WAIT_MS (QA-4). src/instrumentation.ts also opens the
 * connections at startup (warmUpRedis), before the first request.
 *
 * REDIS_URL forms (decision Q7, 18-10-2026: the client's DevOps team provides Redis; TLS is not decided yet):
 * - redis://[[user]:password@]host[:port][/db]   plain TCP (local container, or a private network only)
 * - rediss://[[user]:password@]host[:port][/db]  TLS (recommended when Redis is not on a private network)
 * ioredis reads the user name, the password and the db number from the URL, and turns TLS on only for a
 * lower-case "rediss://". normalizeRedisUrl makes the scheme lower case, so that "REDISS://" also uses TLS.
 * Special characters in the password must be percent-encoded (for example "@" as %40).
 * The URL is never written to a log: redisErrorText and redactRedisUrl hide the password.
 */
import { Redis } from "ioredis";
import { normalizeRedisUrl } from "@/server/redis-url";

export { normalizeRedisUrl, parseRedisUrl, redactRedisUrl, type RedisUrlInfo } from "@/server/redis-url";

export const RETRY_AFTER_MS = 30_000;
export const TIMEOUT_MS = { rate: 100, cache: 250 } as const;
export type RedisPurpose = keyof typeof TIMEOUT_MS;

/** The few Redis commands this app uses. Tests give a fake that has the same shape. */
export interface RedisPipelineLike {
  incr(key: string): RedisPipelineLike;
  expire(key: string, seconds: number): RedisPipelineLike;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  pipeline(): RedisPipelineLike;
}

/** Gives a ready client, or throws (not configured, not connected, or connect timeout). */
export type RedisProvider = () => Promise<RedisLike>;

interface Entry {
  url: string;
  client: Redis;
  /** The wait for "ready" that all callers share while a connection is in progress. */
  ready?: Promise<void>;
}
const g = globalThis as unknown as { __schemeRedis?: Partial<Record<RedisPurpose, Entry>> };

/** The ioredis client for a URL (lazy: it does not connect until the first use). Exported for tests. */
export function newRedisClient(url: string, timeoutMs: number): Redis {
  return newClient(url, timeoutMs);
}

function newClient(url: string, timeoutMs: number): Redis {
  const client = new Redis(normalizeRedisUrl(url), {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: Math.max(timeoutMs, 100),
    commandTimeout: timeoutMs,
    // Reconnect in the background, at most every 2 s.
    retryStrategy: (times: number) => Math.min(times * 100, 2000),
  });
  // Errors are reported by the callers (one warning for each fallback). Without a listener, ioredis prints each one.
  client.on("error", () => undefined);
  return client;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Redis connect timeout (${ms} ms)`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** The longest wait for a first connection (connect or "connecting" to "ready"). */
export function connectWaitMs(purpose: RedisPurpose): number {
  return Math.max(TIMEOUT_MS[purpose] * 4, 500);
}

/** Waits until the client is "ready". Rejects on a connection error, a close, or after ms. */
function waitReady(c: Redis, ms: number): Promise<void> {
  if (c.status === "ready") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const done = (err?: Error): void => {
      clearTimeout(t);
      c.off("ready", onReady);
      c.off("error", onError);
      c.off("close", onClose);
      if (err) reject(err);
      else resolve();
    };
    const onReady = (): void => done();
    const onError = (err: unknown): void => done(err instanceof Error ? err : new Error(String(err)));
    const onClose = (): void => done(new Error("Redis connection closed"));
    const t = setTimeout(() => done(new Error(`Redis connect timeout (${ms} ms)`)), ms);
    c.once("ready", onReady);
    c.once("error", onError);
    c.once("close", onClose);
  });
}

/**
 * The shared client for this purpose and URL, connected. Throws when Redis is not ready.
 * A connection that is in progress ("wait" -> connect, "connecting", "connect") is awaited up to connectWaitMs,
 * so that the requests of the first moment after a start do not count as Redis failures. Every request in that
 * moment waits for the same connection. "reconnecting" (Redis was lost) fails at once.
 */
export async function sharedRedis(purpose: RedisPurpose, url: string): Promise<RedisLike> {
  const all = (g.__schemeRedis ??= {});
  let e = all[purpose];
  if (!e || e.url !== url || e.client.status === "end") {
    if (e) e.client.disconnect();
    e = { url, client: newClient(url, TIMEOUT_MS[purpose]) };
    all[purpose] = e;
  }
  const c = e.client;
  if (c.status === "wait" || c.status === "connecting" || c.status === "connect") {
    const entry = e;
    if (!entry.ready) {
      const ready = waitReady(c, connectWaitMs(purpose));
      // The result comes through waitReady; this only stops an unhandled rejection.
      if (c.status === "wait") c.connect().catch(() => undefined);
      entry.ready = ready.finally(() => {
        entry.ready = undefined;
      });
    }
    await entry.ready;
  }
  if (c.status !== "ready") throw new Error(`Redis is not ready (${c.status})`);
  return c as unknown as RedisLike;
}

/**
 * Opens the shared connections at server start (src/instrumentation.ts), so that the first requests find Redis
 * ready. Never throws: when Redis is down, the first request falls back as usual. Returns the purposes that are ready.
 */
export async function warmUpRedis(url: string | null, purposes: ReadonlyArray<RedisPurpose>): Promise<RedisPurpose[]> {
  if (!url) return [];
  const results = await Promise.all(
    purposes.map((p) =>
      sharedRedis(p, url).then(
        () => p,
        () => null,
      ),
    ),
  );
  return results.filter((p): p is RedisPurpose => p !== null);
}

/** Provider for a purpose, or null when REDIS_URL is not set. */
export function redisProvider(purpose: RedisPurpose, url: string | null): RedisProvider | null {
  return url ? () => sharedRedis(purpose, url) : null;
}

/** Short text of an error for a log line (no URL, no user name, no password). */
export function redisErrorText(err: unknown): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return msg.replace(/(rediss?):\/\/\S+/gi, (_m, scheme: string) => `${scheme.toLowerCase()}://…`).slice(0, 200);
}

/**
 * "Down" state of one Redis user. After a failure, Redis is skipped for RETRY_AFTER_MS.
 * The warning is written only on the change from up to down (QA-5). Requests that were already in flight when
 * Redis went down also fail, but they do not write a line and do not extend the back-off. So each user writes at
 * most one line every 30 s.
 */
export class RedisBackoff {
  private downUntil = 0;
  constructor(private readonly what: string, private readonly fallback: string) {}

  isDown(nowMs: number = Date.now()): boolean {
    return nowMs < this.downUntil;
  }

  /** For tests. */
  get downUntilMs(): number {
    return this.downUntil;
  }

  fail(err: unknown, nowMs: number = Date.now()): void {
    if (this.isDown(nowMs)) return;
    this.downUntil = nowMs + RETRY_AFTER_MS;
    console.warn(
      JSON.stringify({
        evt: "redis_unavailable",
        user: this.what,
        error: redisErrorText(err),
        fallback: this.fallback,
        retry_after_s: RETRY_AFTER_MS / 1000,
      }),
    );
  }
}

/** Closes the shared clients (scripts and tests). */
export async function closeSharedRedis(): Promise<void> {
  const all = g.__schemeRedis ?? {};
  for (const k of Object.keys(all) as RedisPurpose[]) {
    all[k]?.client.disconnect();
    delete all[k];
  }
}

/** A one-off client for scripts (connect, run, quit). */
export async function withRedis<T>(url: string, fn: (r: RedisLike) => Promise<T>, timeoutMs = 2000): Promise<T> {
  const client = newClient(url, timeoutMs);
  try {
    await withTimeout(client.connect(), timeoutMs);
    return await fn(client as unknown as RedisLike);
  } finally {
    client.disconnect();
  }
}
