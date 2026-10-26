/** Response cache (same cases as the reference API tests/test_cache.py, adapted to the dealer status endpoint). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DealerStatus } from "@/engine/types";
import { handleStatusRequest, type StatusRequestDeps } from "@/server/api/dealer-status";
import { readConfig } from "./config";
import { KEY_PREFIX, ResponseCache, VERSION_KEY, bumpDataVersion, cacheOn, getResponseCache } from "./cache";
import { FakeRedis } from "./testing/fake-redis";

const ACTIVE = ["FB-PAN", "FB-TNHPJK", "SP-Q3"];
let fake: FakeRedis;
let cache: ResponseCache;
let warn: ReturnType<typeof vi.spyOn>;
let now = 1_000_000;

function getDealerStatus(code: string, tags: string[]): Promise<DealerStatus | null> {
  if (code !== "D10001") return Promise.resolve(null);
  return Promise.resolve({
    dealer_code: "D10001",
    dealer_name: "Dealer",
    data_as_of: null,
    schemes: tags.map((t) => ({ scheme_tag: t, participation: "NOT_IN_SCOPE", reason_code: "NO_DATA", reason: "x" })),
  });
}

let deps: StatusRequestDeps & { getDealerStatus: ReturnType<typeof vi.fn>; listActiveTags: ReturnType<typeof vi.fn> };

function call(body: unknown, c: ResponseCache | null = cache) {
  return handleStatusRequest(
    { authorization: null, contentType: "application/json", readBody: () => Promise.resolve({ ok: true, text: JSON.stringify(body) }) },
    { ...deps, cache: c },
  );
}
const req = (dealer = "D10001", tags = ["FB-PAN", "SP-Q3"]) => ({ dealer_code: dealer, scheme_tags: tags });

beforeAll(() => undefined);
beforeEach(() => {
  fake = new FakeRedis();
  now = 1_000_000;
  cache = new ResponseCache({ redis: () => Promise.resolve(fake), ttlSeconds: 900, versionCheckMs: 0, now: () => now });
  deps = {
    authenticate: () => Promise.resolve({ ok: true, clientId: "ci" }),
    limiter: null,
    listActiveTags: vi.fn(() => Promise.resolve(ACTIVE)),
    getDealerStatus: vi.fn(getDealerStatus),
  };
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe("response cache in the dealer status handler", () => {
  it("off: no X-Cache header", async () => {
    const r = await call(req(), null);
    expect(r.status).toBe(200);
    expect(r.headers["X-Cache"]).toBeUndefined();
  });

  it("the second request is served from Redis and does not touch the database", async () => {
    const first = await call(req());
    const second = await call(req());
    expect([first.headers["X-Cache"], second.headers["X-Cache"]]).toEqual(["MISS", "HIT"]);
    expect(first.rawBody).toBe(second.rawBody);
    expect(deps.getDealerStatus).toHaveBeenCalledTimes(1);
    expect(deps.listActiveTags).toHaveBeenCalledTimes(1);
    expect(second.log).toEqual({ clientId: "ci", code: null, tagCount: 2, dealerCode: "D10001" });
  });

  it("the cached body is identical to the uncached one", async () => {
    const uncached = await call(req(), null);
    await call(req());
    const hit = await call(req());
    expect(JSON.parse(hit.rawBody!)).toEqual(uncached.body);
  });

  it("the key has the dealer and the tags in request order (the response keeps the order)", async () => {
    await call(req());
    expect((await call(req("D10001", ["SP-Q3", "FB-PAN"]))).headers["X-Cache"]).toBe("MISS");
    expect((await call(req("D10002", ["FB-PAN", "SP-Q3"]))).headers["X-Cache"]).toBe("MISS");
    expect((await call({ dealer_code: " D10001 ", scheme_tags: [" FB-PAN", "SP-Q3 "] })).headers["X-Cache"]).toBe("HIT"); // same after trim
    const keys = [...fake.data.keys()].filter((k) => k !== VERSION_KEY);
    expect(keys).toContain(`${KEY_PREFIX}:0:dss:D10001:["FB-PAN","SP-Q3"]`);
  });

  it("caches 404 DEALER_NOT_FOUND and 400 UNKNOWN_SCHEME_TAG", async () => {
    await call(req("NOPE1"));
    const nf = await call(req("NOPE1"));
    expect([nf.status, nf.headers["X-Cache"], nf.log.code]).toEqual([404, "HIT", "DEALER_NOT_FOUND"]);
    await call(req("D10001", ["ABC9"]));
    const ut = await call(req("D10001", ["ABC9"]));
    expect([ut.status, ut.headers["X-Cache"], ut.log.code]).toEqual([400, "HIT", "UNKNOWN_SCHEME_TAG"]);
  });

  it("does not cache other errors (validation 400, 5xx)", async () => {
    await call({ dealer_code: "D10001", scheme_tags: [] });
    deps.getDealerStatus.mockImplementationOnce(() => Promise.reject(new Error("db down")));
    const r = await call(req("D10003"));
    expect(r.status).toBe(500);
    expect([...fake.data.keys()].filter((k) => k !== VERSION_KEY)).toEqual([]);
  });

  it("a new data version replaces the cached answers", async () => {
    await call(req());
    fake.incrSync(VERSION_KEY); // what runEngine does after its commit
    expect((await call(req())).headers["X-Cache"]).toBe("MISS");
    expect(deps.getDealerStatus).toHaveBeenCalledTimes(2);
    expect([...fake.data.keys()]).toContain(`${KEY_PREFIX}:1:dss:D10001:["FB-PAN","SP-Q3"]`);
  });

  it("each process reads the version again at most every 5 s", async () => {
    const c = new ResponseCache({ redis: () => Promise.resolve(fake), ttlSeconds: 900, now: () => now });
    await call(req(), c);
    fake.incrSync(VERSION_KEY);
    expect((await call(req(), c)).headers["X-Cache"]).toBe("HIT"); // still version 0 for up to 5 s
    now += 5_000;
    expect((await call(req(), c)).headers["X-Cache"]).toBe("MISS");
  });

  it("entries expire after the TTL (900 s)", async () => {
    await call(req());
    expect(new Set(fake.ttls.values())).toEqual(new Set([900]));
  });

  it("a broken Redis falls back to the database (BYPASS), and is not retried at once", async () => {
    fake.broken = true;
    const r = await call(req());
    expect([r.status, r.headers["X-Cache"]]).toEqual([200, "BYPASS"]);
    expect(JSON.parse(r.rawBody!).dealer_code).toBe("D10001");
    fake.broken = false;
    expect((await call(req())).headers["X-Cache"]).toBe("BYPASS");
    now += 30_000;
    expect((await call(req())).headers["X-Cache"]).toBe("MISS");
  });

  it.each([
    ["abc", "BYPASS"],
    ["1.5", "BYPASS"],
    ["", "MISS"],
  ])("a corrupt data version %j bypasses the cache instead of failing", async (version, expected) => {
    fake.data.set(VERSION_KEY, version);
    const r = await call(req());
    expect(r.status).toBe(200);
    expect(r.headers["X-Cache"]).toBe(expected);
  });

  it("stores the status, the code and the JSON body", async () => {
    await call(req());
    const key = [...fake.data.keys()].find((k) => k !== VERSION_KEY)!;
    const stored = JSON.parse(fake.data.get(key)!) as { status: number; code: null; body: string };
    expect(stored.status).toBe(200);
    expect(stored.code).toBeNull();
    expect(JSON.parse(stored.body).schemes.map((s: { scheme_tag: string }) => s.scheme_tag)).toEqual(["FB-PAN", "SP-Q3"]);
  });
});

describe("cache switch and data version bump", () => {
  it.each([
    [{ CACHE_ENABLED: "true", REDIS_URL: "redis://localhost:6380/0" }, true],
    [{ CACHE_ENABLED: "false", REDIS_URL: "redis://localhost:6380/0" }, false],
    [{ CACHE_ENABLED: "true" }, false],
    [{}, false],
  ])("%j -> on=%s", (env, on) => {
    const cfg = readConfig(env);
    expect(cacheOn(cfg)).toBe(on);
    expect(getResponseCache(cfg) !== null).toBe(on);
  });

  it("bumpDataVersion is a no-op when the cache is off", async () => {
    expect(await bumpDataVersion({})).toBeNull();
    expect(await bumpDataVersion({ REDIS_URL: "redis://127.0.0.1:1/0" })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("bumpDataVersion carries on with a warning when Redis is down", async () => {
    expect(await bumpDataVersion({ CACHE_ENABLED: "true", REDIS_URL: "redis://127.0.0.1:1/0" })).toBeNull();
    expect(String(warn.mock.calls[0][0])).toContain("cache_data_version_failed");
    expect(String(warn.mock.calls[0][0])).not.toContain("127.0.0.1:1/0");
  });
});
