/**
 * REDIS_URL forms (decision Q7, 18-10-2026): the client's DevOps team provides Redis, TLS is not decided yet.
 * The app must accept redis:// and rediss:// (TLS) with a password in the URL, and never write the password to a log.
 * These tests do not need a Redis server: the ioredis clients are lazy and are never connected, except the
 * unreachable-port cases, which fail at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { bumpDataVersion } from "./cache";
import {
  RedisBackoff,
  closeSharedRedis,
  newRedisClient,
  normalizeRedisUrl,
  parseRedisUrl,
  redactRedisUrl,
  redisErrorText,
  sharedRedis,
  withRedis,
} from "./redis";

const PASSWORD = "Pa55:w0rd@x/y"; // has ":", "@" and "/": they must be percent-encoded in the URL
const ENCODED = encodeURIComponent(PASSWORD); // Pa55%3Aw0rd%40x%2Fy
const TLS_URL = `rediss://app-user:${ENCODED}@redis.example.internal:6380/3`;

afterEach(async () => {
  await closeSharedRedis();
  vi.restoreAllMocks();
});

describe("ioredis reads the URL (no connection)", () => {
  it("rediss:// with a user name and a password: TLS on, decoded password, host, port and db", () => {
    const c = newRedisClient(TLS_URL, 100);
    try {
      expect(c.status).toBe("wait"); // lazyConnect: nothing was sent
      expect(c.options.tls).toBeTruthy();
      expect(c.options.username).toBe("app-user");
      expect(c.options.password).toBe(PASSWORD);
      expect(c.options.host).toBe("redis.example.internal");
      expect(c.options.port).toBe(6380);
      expect(c.options.db).toBe(3);
    } finally {
      c.disconnect();
    }
  });

  it("rediss:// with a password only (no user name)", () => {
    const c = newRedisClient(`rediss://:${ENCODED}@10.1.2.3:6379`, 100);
    try {
      expect(c.options.tls).toBeTruthy();
      expect(c.options.password).toBe(PASSWORD);
      expect(c.options.username ?? "").toBe("");
      expect(c.options.db).toBe(0);
    } finally {
      c.disconnect();
    }
  });

  it("redis:// keeps TLS off; the password is still used", () => {
    const c = newRedisClient(`redis://:${ENCODED}@localhost:6380/0`, 100);
    try {
      expect(c.options.tls).toBeFalsy();
      expect(c.options.password).toBe(PASSWORD);
    } finally {
      c.disconnect();
    }
  });

  it("an upper-case REDISS:// also turns TLS on (ioredis alone checks only the lower-case scheme)", () => {
    expect(normalizeRedisUrl(` REDISS://:${ENCODED}@host:6380 `)).toBe(`rediss://:${ENCODED}@host:6380`);
    const c = newRedisClient(`REDISS://:${ENCODED}@host:6380`, 100);
    try {
      expect(c.options.tls).toBeTruthy();
      expect(c.options.password).toBe(PASSWORD);
    } finally {
      c.disconnect();
    }
  });
});

describe("parseRedisUrl", () => {
  it("gives the parts without the password", () => {
    const r = parseRedisUrl(TLS_URL);
    expect(r).toEqual({
      ok: true,
      info: { tls: true, host: "redis.example.internal", port: 6380, db: 3, username: "app-user", hasPassword: true },
    });
    expect(JSON.stringify(r)).not.toContain(ENCODED);
    expect(parseRedisUrl("redis://localhost")).toEqual({
      ok: true,
      info: { tls: false, host: "localhost", port: 6379, db: 0, username: null, hasPassword: false },
    });
  });

  it("refuses other schemes and broken URLs with a message that has no URL", () => {
    for (const url of ["http://srv9:6379", "rediss://", "rediss://:pw9@srv9/x", "rediss://:p#w9@srv9", "rediss://srv9 bad"]) {
      const r = parseRedisUrl(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.error).not.toMatch(/srv9|pw9|p#w9/);
    }
  });
});

describe("redaction of the password", () => {
  it("redactRedisUrl replaces the user name and the password", () => {
    expect(redactRedisUrl(TLS_URL)).toBe("rediss://***@redis.example.internal:6380/3");
    expect(redactRedisUrl(`redis://:${ENCODED}@localhost:6380/0`)).toBe("redis://***@localhost:6380/0");
    expect(redactRedisUrl("redis://localhost:6380/0")).toBe("redis://localhost:6380/0");
  });

  it("redisErrorText removes any redis:// or rediss:// URL from an error text and keeps the scheme", () => {
    for (const url of [TLS_URL, TLS_URL.toUpperCase(), `redis://:${ENCODED}@localhost:6380/0`, `rediss://:${PASSWORD}@host`]) {
      const text = redisErrorText(new Error(`Connection to ${url} failed`));
      expect(text).not.toContain(ENCODED);
      expect(text).not.toContain(ENCODED.toUpperCase());
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain("app-user");
      expect(text).not.toContain("APP-USER");
      expect(text).toMatch(/^Error: Connection to rediss?:\/\/… failed$/);
    }
    expect(redisErrorText(new Error(`x ${TLS_URL}`))).toBe("Error: x rediss://…");
  });

  it("the redis_unavailable line of RedisBackoff has no password", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    new RedisBackoff("rate-limit", "memory").fail(new Error(`ECONNREFUSED ${TLS_URL}`), 0);
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ evt: "redis_unavailable", error: "Error: ECONNREFUSED rediss://…" });
    expect(line).not.toContain(ENCODED);
    expect(line).not.toContain("app-user");
  });

  it("a rediss:// URL with a password that cannot connect: the error and the log line have no password", async () => {
    // Port 1 on this machine refuses the connection at once (no TLS handshake starts).
    const url = `rediss://app-user:${ENCODED}@127.0.0.1:1/0`;
    const err = await withRedis(url, (r) => r.incr("x"), 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const text = redisErrorText(err);
    expect(text).not.toContain(ENCODED);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain("app-user");

    await expect(sharedRedis("rate", url)).rejects.toThrow();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await bumpDataVersion({ CACHE_ENABLED: "true", REDIS_URL: url })).toBeNull();
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ evt: "cache_data_version_failed" });
    expect(line).not.toContain(ENCODED);
    expect(line).not.toContain("app-user");
  });
});
