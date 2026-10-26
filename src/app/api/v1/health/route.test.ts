/** Health probe: it checks the database (readiness), keeps the answer for 15 s, and gives 503 when the database fails. */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const getDataAsOf = vi.fn<() => Promise<string | null>>();
vi.mock("@/server/repo", () => ({ getDataAsOf: () => getDataAsOf() }));

const DATA_AS_OF = "2026-10-18T00:00:00+05:30";
let errSpy: MockInstance<typeof console.error>;

/** A new copy of the route module for each test, so that the 15 s cache starts empty. */
async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

beforeEach(() => {
  getDataAsOf.mockReset();
  errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  errSpy.mockRestore();
});

describe("GET /api/v1/health", () => {
  it("database answers: 200 {status: ok, data_as_of}", async () => {
    getDataAsOf.mockResolvedValue(DATA_AS_OF);
    const res = await (await loadRoute()).GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", data_as_of: DATA_AS_OF });
    expect(getDataAsOf).toHaveBeenCalledTimes(1);
  });

  it("database answers with no data load yet: 200 with data_as_of null", async () => {
    getDataAsOf.mockResolvedValue(null);
    const res = await (await loadRoute()).GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", data_as_of: null });
  });

  it("database fails: 503 {status: unavailable, data_as_of: null}; the log has no error detail", async () => {
    getDataAsOf.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret"));
    const res = await (await loadRoute()).GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", data_as_of: null });
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("database check failed");
    expect(logged).not.toContain("ECONNREFUSED");
    expect(logged).not.toContain("secret");
  });

  it("keeps a good answer for 15 s, then checks the database again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
    getDataAsOf.mockResolvedValue(DATA_AS_OF);
    const route = await loadRoute();
    await route.GET();
    vi.setSystemTime(new Date("2026-10-21T10:00:14Z"));
    await route.GET();
    expect(getDataAsOf).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-21T10:00:16Z"));
    await route.GET();
    expect(getDataAsOf).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failure: the next probe checks the database again and recovers", async () => {
    getDataAsOf.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(DATA_AS_OF);
    const route = await loadRoute();
    expect((await route.GET()).status).toBe(503);
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", data_as_of: DATA_AS_OF });
  });

  it("a cached good answer turns into 503 when the database fails after 15 s", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
    getDataAsOf.mockResolvedValueOnce(DATA_AS_OF).mockRejectedValueOnce(new Error("down"));
    const route = await loadRoute();
    expect((await route.GET()).status).toBe(200);
    vi.setSystemTime(new Date("2026-10-21T10:00:16Z"));
    expect((await route.GET()).status).toBe(503);
  });
});

describe("HEAD /api/v1/health", () => {
  it("same status as GET, no body: 200 when the database answers, 503 when it fails", async () => {
    getDataAsOf.mockResolvedValueOnce(DATA_AS_OF);
    const up = await (await loadRoute()).HEAD();
    expect(up.status).toBe(200);
    expect(await up.text()).toBe("");
    getDataAsOf.mockRejectedValueOnce(new Error("down"));
    const down = await (await loadRoute()).HEAD();
    expect(down.status).toBe(503);
    expect(await down.text()).toBe("");
  });
});
