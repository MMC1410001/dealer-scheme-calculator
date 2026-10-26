/**
 * Rate limit and response cache against a real Redis. Skipped unless TEST_REDIS_URL is set, for example:
 *   TEST_REDIS_URL=redis://localhost:6380/15 npx vitest run src/server/ratelimit.redis.test.ts
 * Use a separate database number (15): the test deletes the scheme:* keys of that database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";
import { FixedWindowLimiter } from "./ratelimit";
import { ResponseCache, VERSION_KEY, bumpDataVersion } from "./cache";
import { closeSharedRedis, redisProvider, warmUpRedis } from "./redis";

const URL_ = process.env.TEST_REDIS_URL ?? "";

async function clean(): Promise<void> {
  const r = new Redis(URL_, { lazyConnect: true });
  await r.connect();
  const keys = await r.keys("scheme:*");
  if (keys.length) await r.del(...keys);
  r.disconnect();
}

describe.skipIf(!URL_)("real Redis (TEST_REDIS_URL)", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await closeSharedRedis();
  });

  it("counts in Redis across limiter instances (like two processes) with a TTL", async () => {
    const t = Date.now();
    const a = new FixedWindowLimiter({ name: "itest", limit: 3, windowSec: 60, redis: redisProvider("rate", URL_), now: () => t });
    const b = new FixedWindowLimiter({ name: "itest", limit: 3, windowSec: 60, redis: redisProvider("rate", URL_), now: () => t });
    const results = [await a.take("k"), await b.take("k"), await a.take("k"), await b.take("k")];
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    const r = new Redis(URL_);
    const key = a.redisKey("k", Math.floor(t / 1000 / 60));
    expect(await r.get(key)).toBe("4");
    const ttl = await r.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(61);
    r.disconnect();
  });

  it("caches, then a data version bump gives MISS", async () => {
    const c = new ResponseCache({ redis: redisProvider("cache", URL_)!, ttlSeconds: 900, versionCheckMs: 0 });
    const build = vi.fn(() => Promise.resolve({ entry: { status: 200, code: null, body: '{"x":1}' }, cacheable: true }));
    expect((await c.getOrBuild("itest", build)).state).toBe("MISS");
    expect((await c.getOrBuild("itest", build)).state).toBe("HIT");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const v = await bumpDataVersion({ CACHE_ENABLED: "true", REDIS_URL: URL_ });
    log.mockRestore();
    expect(v).toBeGreaterThanOrEqual(1);
    expect((await c.getOrBuild("itest", build)).state).toBe("MISS");
    expect(build).toHaveBeenCalledTimes(2);
    const r = new Redis(URL_);
    expect(Number(await r.get(VERSION_KEY))).toBe(v);
    r.disconnect();
  });

  it("QA-4/QA-5: a burst on a new connection waits for 'connecting' and counts in Redis, with no warning", async () => {
    await closeSharedRedis(); // like a new server process: the shared client starts in "wait"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = Date.now();
    const l = new FixedWindowLimiter({ name: "burst", limit: 1000, windowSec: 60, redis: redisProvider("rate", URL_), now: () => t });
    const counts = (await Promise.all(Array.from({ length: 60 }, () => l.take("k")))).map((r) => r.count);
    expect(warn).not.toHaveBeenCalled();
    expect(l.backoff.isDown(t)).toBe(false);
    expect([...counts].sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1)); // all from Redis INCR
    const r = new Redis(URL_);
    expect(await r.get(l.redisKey("k", Math.floor(t / 1000 / 60)))).toBe("60");
    r.disconnect();
    warn.mockRestore();
  });

  it("warmUpRedis opens the shared connections before the first request", async () => {
    await closeSharedRedis();
    expect(await warmUpRedis(URL_, ["rate", "cache"])).toEqual(["rate", "cache"]);
    expect(await warmUpRedis("redis://127.0.0.1:1/0", ["rate"])).toEqual([]);
    expect(await warmUpRedis(null, ["rate"])).toEqual([]);
  });

  it("a Redis that cannot be reached falls back at once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const l = new FixedWindowLimiter({ limit: 1, windowSec: 1, redis: redisProvider("rate", "redis://127.0.0.1:1/0"), now: () => 0 });
    const t0 = performance.now();
    expect((await l.take("x")).allowed).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect((await l.take("x")).allowed).toBe(false);
    warn.mockRestore();
  });
});
