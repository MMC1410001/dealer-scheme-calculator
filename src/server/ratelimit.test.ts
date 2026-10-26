/** Rate limits (same cases as the reference API tests/test_ratelimit.py, adapted to TRUSTED_PROXY_HOPS). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNTRUSTED_CLIENT_KEY, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { readConfig } from "./config";
import { FixedWindowLimiter, clientIpKey, getLimiter, resetLimitersForTests } from "./ratelimit";
import { RETRY_AFTER_MS } from "./redis";
import { FakeRedis } from "./testing/fake-redis";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

async function statuses(l: FixedWindowLimiter, key: string, n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await l.take(key)).allowed ? 200 : 429);
  return out;
}

describe("FixedWindowLimiter (memory)", () => {
  it("requests over the limit get 429 with Retry-After", async () => {
    const l = new FixedWindowLimiter({ limit: 3, windowSec: 1, now: () => 1_000_500 });
    expect(await statuses(l, "10.0.0.1", 4)).toEqual([200, 200, 200, 429]);
    const r = await l.take("10.0.0.1");
    expect(r).toEqual({ allowed: false, count: 5, retryAfterSeconds: 1 });
  });

  it("the count starts again each second", async () => {
    let t = 1_000_000;
    const l = new FixedWindowLimiter({ limit: 1, windowSec: 1, now: () => t });
    expect(await statuses(l, "ip", 2)).toEqual([200, 429]);
    t = 1_001_000;
    expect(await statuses(l, "ip", 1)).toEqual([200]);
  });

  it("each key has its own limit", async () => {
    const l = new FixedWindowLimiter({ limit: 1, windowSec: 1, now: () => 0 });
    expect(await statuses(l, "10.0.0.1", 2)).toEqual([200, 429]);
    expect(await statuses(l, "10.0.0.2", 1)).toEqual([200]);
  });

  it("a per-minute limit gives Retry-After to the end of the minute", async () => {
    let t = 1_000_500; // 1,000.5 s: 19.5 s left in the minute that started at 960 s
    const l = new FixedWindowLimiter({ name: "token", limit: 2, windowSec: 60, now: () => t });
    expect(await statuses(l, "ip", 3)).toEqual([200, 200, 429]);
    const r = await l.take("ip");
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSeconds).toBe(20);
    t = 1_020_000;
    expect(await statuses(l, "ip", 1)).toEqual([200]);
  });
});

describe("FixedWindowLimiter (Redis)", () => {
  it("keeps the counts in Redis for each key and window, with EXPIRE", async () => {
    const fake = new FakeRedis();
    const l = new FixedWindowLimiter({ limit: 2, windowSec: 1, redis: () => Promise.resolve(fake), now: () => 1_000_500 });
    expect(await statuses(l, "10.0.0.1", 3)).toEqual([200, 200, 429]);
    expect(Object.fromEntries(fake.data)).toEqual({ "scheme:rate:10.0.0.1:1000": "3" });
    expect([...fake.expiring]).toEqual(["scheme:rate:10.0.0.1:1000"]);
  });

  it("named limiters keep their own keys", async () => {
    const fake = new FakeRedis();
    const l = new FixedWindowLimiter({ name: "token", limit: 5, windowSec: 60, redis: () => Promise.resolve(fake), now: () => 1_000_500 });
    await l.take("10.0.0.1");
    expect(Object.fromEntries(fake.data)).toEqual({ "scheme:rate:token:10.0.0.1:16": "1" });
  });

  it("Redis down: counts in memory, and does not try Redis again for 30 s", async () => {
    const fake = new FakeRedis();
    fake.broken = true;
    let t = 1_000_500;
    const provider = vi.fn(() => Promise.resolve(fake));
    const l = new FixedWindowLimiter({ limit: 2, windowSec: 1, redis: provider, now: () => t });
    expect(await statuses(l, "ip", 3)).toEqual([200, 200, 429]);
    expect(l.backoff.downUntilMs).toBe(1_000_500 + RETRY_AFTER_MS);
    expect(provider).toHaveBeenCalledTimes(1); // not retried on every request
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"evt":"redis_unavailable"');

    fake.broken = false;
    t += RETRY_AFTER_MS;
    await l.take("ip");
    expect(provider).toHaveBeenCalledTimes(2);
    expect(fake.data.size).toBe(1);
  });

  it("QA-5: requests in flight that fail together write one redis_unavailable line, then at most one every 30 s", async () => {
    let t = 5_000_000;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    // Every request is in flight when Redis fails (for example ioredis "connecting" or a command time-out).
    const provider = vi.fn(async () => {
      await gate;
      throw new Error("Redis is not ready (connecting)");
    });
    const l = new FixedWindowLimiter({ limit: 1000, windowSec: 1, redis: provider, now: () => t });
    const burst = Array.from({ length: 60 }, () => l.take("ip"));
    release();
    expect((await Promise.all(burst)).every((r) => r.allowed)).toBe(true);
    expect(provider).toHaveBeenCalledTimes(60);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(l.backoff.downUntilMs).toBe(5_000_000 + RETRY_AFTER_MS); // later failures do not extend the back-off

    t += RETRY_AFTER_MS - 1;
    await Promise.all(Array.from({ length: 10 }, () => l.take("ip")));
    expect(warn).toHaveBeenCalledTimes(1); // still down: Redis is not called and nothing is written
    t += 1;
    const again = Array.from({ length: 10 }, () => l.take("ip"));
    await Promise.all(again);
    expect(warn).toHaveBeenCalledTimes(2); // the next up -> down change, 30 s later
  });

  it("a provider that cannot connect also falls back", async () => {
    const l = new FixedWindowLimiter({ limit: 1, windowSec: 1, redis: () => Promise.reject(new Error("Redis is not ready (reconnecting)")), now: () => 0 });
    expect(await statuses(l, "ip", 2)).toEqual([200, 429]);
  });
});

describe("getLimiter", () => {
  beforeEach(() => resetLimitersForTests());

  it("is null when RATE_LIMIT_ENABLED=false", () => {
    expect(getLimiter("ip", readConfig({ RATE_LIMIT_ENABLED: "false" }))).toBeNull();
  });

  it("uses the configured limits and windows, and keeps one limiter for each process", () => {
    const cfg = readConfig({ RATE_LIMIT_PER_SECOND: "7", TOKEN_RATE_LIMIT_PER_MINUTE: "3", API_RATE_LIMIT_PER_MINUTE: "9" });
    expect(getLimiter("ip", cfg)!.opts).toMatchObject({ limit: 7, windowSec: 1, redis: null });
    expect(getLimiter("token", cfg)!.opts).toMatchObject({ name: "token", limit: 3, windowSec: 60 });
    expect(getLimiter("client", cfg)!.opts).toMatchObject({ name: "client", limit: 9, windowSec: 60 });
    expect(getLimiter("ip", cfg)).toBe(getLimiter("ip", cfg));
    expect(getLimiter("ip", readConfig({ RATE_LIMIT_PER_SECOND: "8" }))!.opts.limit).toBe(8);
    expect(getLimiter("ip", readConfig({ REDIS_URL: "redis://localhost:6380/0" }))!.opts.redis).not.toBeNull();
  });
});

describe("client IP (TRUSTED_PROXY_HOPS)", () => {
  const xff = (v: string) => new Headers({ "x-forwarded-for": v });
  it.each<[Headers, number, string]>([
    [xff("1.2.3.4"), 0, UNTRUSTED_CLIENT_KEY], // no trusted proxies: header ignored, one shared bucket
    [xff("198.51.100.7"), 1, "198.51.100.7"], // one proxy says who called it
    [xff("1.2.3.4, 198.51.100.7"), 1, "198.51.100.7"], // the caller's own entry is skipped
    [xff("198.51.100.7, 172.18.0.3"), 2, "198.51.100.7"], // through two trusted proxies
    [xff("198.51.100.7"), 2, UNTRUSTED_CLIENT_KEY], // fewer entries than hops
    [new Headers(), 1, UNTRUSTED_CLIENT_KEY], // no header
  ])("%#", (h, hops, expected) => {
    expect(clientIpFromHeaders(h, hops)).toBe(expected);
    expect(clientIpKey(h, readConfig({ TRUSTED_PROXY_HOPS: String(hops) }))).toBe(expected);
  });

  it("a spoofed X-Forwarded-For does not get a fresh limit", async () => {
    const l = new FixedWindowLimiter({ limit: 1, windowSec: 1, now: () => 0 });
    const cfg0 = readConfig({});
    expect((await l.take(clientIpKey(new Headers(), cfg0))).allowed).toBe(true);
    expect((await l.take(clientIpKey(xff("1.2.3.4"), cfg0))).allowed).toBe(false);
    expect((await l.take(clientIpKey(xff("5.6.7.8"), cfg0))).allowed).toBe(false);
  });

  it("callers behind a trusted proxy each get their own limit, and cannot escape with their own entry", async () => {
    const l = new FixedWindowLimiter({ limit: 1, windowSec: 1, now: () => 0 });
    const cfg = readConfig({ TRUSTED_PROXY_HOPS: "1" });
    expect((await l.take(clientIpKey(xff("198.51.100.7"), cfg))).allowed).toBe(true);
    expect((await l.take(clientIpKey(xff("198.51.100.7"), cfg))).allowed).toBe(false);
    expect((await l.take(clientIpKey(xff("198.51.100.8"), cfg))).allowed).toBe(true);
    expect((await l.take(clientIpKey(xff("9.9.9.9, 198.51.100.7"), cfg))).allowed).toBe(false);
  });
});
