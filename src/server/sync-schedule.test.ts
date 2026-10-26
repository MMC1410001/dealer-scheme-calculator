/** Daily BigQuery sync schedule (src/server/sync-schedule.ts). 08:00 IST = 02:30 UTC. */
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  formatDailyTime,
  nextSlot,
  parseDailyTime,
  runScheduledSync,
  runWithRetry,
  startSyncSchedule,
  todaysSlot,
  type DailyTime,
  type ScheduledSyncDeps,
} from "./sync-schedule";

const EIGHT: DailyTime = { hour: 8, minute: 0 };

function deps(over: Partial<ScheduledSyncDeps> & { at: string }): ScheduledSyncDeps & { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    now: () => new Date(over.at),
    withLock: async (work) => ({ ran: true, value: await work() }),
    lastSuccessSince: async () => null,
    runSync: async () => "sync run 1",
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    ...over,
    logs,
    errors,
  };
}

describe("parseDailyTime", () => {
  it("reads HH:MM", () => {
    expect(parseDailyTime("08:00")).toEqual({ hour: 8, minute: 0 });
    expect(parseDailyTime(" 8:05 ")).toEqual({ hour: 8, minute: 5 });
    expect(parseDailyTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(formatDailyTime({ hour: 8, minute: 5 })).toBe("08:05");
  });
  it("refuses other text", () => {
    for (const v of ["24:00", "08:60", "8", "08:00:00", "8am", "", "-1:00"]) expect(parseDailyTime(v)).toBeNull();
  });
});

describe("slots in India time", () => {
  it("today's 08:00 IST is 02:30 UTC", () => {
    expect(todaysSlot(new Date("2026-10-19T01:00:00Z"), EIGHT).toISOString()).toBe("2026-10-19T02:30:00.000Z");
    expect(todaysSlot(new Date("2026-10-19T12:00:00Z"), EIGHT).toISOString()).toBe("2026-10-19T02:30:00.000Z");
  });
  it("uses the India date, not the UTC date (19:00 UTC on 19 Oct is 00:30 IST on 20 Oct)", () => {
    expect(todaysSlot(new Date("2026-10-19T19:00:00Z"), EIGHT).toISOString()).toBe("2026-10-20T02:30:00.000Z");
  });
  it("next slot is today before 08:00 IST, tomorrow at or after it", () => {
    expect(nextSlot(new Date("2026-10-19T02:29:59Z"), EIGHT).toISOString()).toBe("2026-10-19T02:30:00.000Z");
    expect(nextSlot(new Date("2026-10-19T02:30:00Z"), EIGHT).toISOString()).toBe("2026-10-20T02:30:00.000Z");
    expect(nextSlot(new Date("2026-10-19T10:00:00Z"), EIGHT).toISOString()).toBe("2026-10-20T02:30:00.000Z");
  });
});

describe("runScheduledSync", () => {
  it("runs the sync when today's run has not succeeded", async () => {
    const d = deps({ at: "2026-10-19T02:30:00Z" });
    const since = vi.fn(async () => null);
    d.lastSuccessSince = since;
    expect(await runScheduledSync(EIGHT, d)).toBe("ran");
    expect(since).toHaveBeenCalledWith(new Date("2026-10-19T02:30:00Z"));
    expect(d.logs.at(-1)).toContain("Daily sync done: sync run 1");
  });
  it("skips when a sync already succeeded since today's time", async () => {
    const runSync = vi.fn(async () => "x");
    const d = deps({ at: "2026-10-19T02:30:01Z", runSync, lastSuccessSince: async () => new Date("2026-10-19T02:30:00Z") });
    expect(await runScheduledSync(EIGHT, d)).toBe("already-done");
    expect(runSync).not.toHaveBeenCalled();
  });
  it("skips when another sync holds the lock", async () => {
    const runSync = vi.fn(async () => "x");
    const d = deps({ at: "2026-10-19T02:30:00Z", runSync, withLock: async () => ({ ran: false }) });
    expect(await runScheduledSync(EIGHT, d)).toBe("locked");
    expect(runSync).not.toHaveBeenCalled();
  });
  it("logs a failure and does not throw", async () => {
    const d = deps({ at: "2026-10-19T02:30:00Z", runSync: async () => Promise.reject(new Error("BigQuery down")) });
    expect(await runScheduledSync(EIGHT, d)).toBe("failed");
    expect(d.errors[0]).toContain("BigQuery down");
  });
});

describe("startSyncSchedule", () => {
  function fakeTimers() {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    return { calls, timers: { setTimeout: (fn: () => void, ms: number) => (calls.push({ fn, ms }), {}) } };
  }

  it("before 08:00 IST: no run now, timer for today's 08:00", () => {
    const runSync = vi.fn(async () => "x");
    const { calls, timers } = fakeTimers();
    const next = startSyncSchedule(EIGHT, deps({ at: "2026-10-19T01:30:00Z", runSync }), timers);
    expect(next.toISOString()).toBe("2026-10-19T02:30:00.000Z");
    expect(calls[0].ms).toBe(60 * 60_000);
    expect(runSync).not.toHaveBeenCalled();
  });

  it("after 08:00 IST: one catch-up attempt now, timer for tomorrow", async () => {
    const runSync = vi.fn(async () => "x");
    const { calls, timers } = fakeTimers();
    const next = startSyncSchedule(EIGHT, deps({ at: "2026-10-19T04:30:00Z", runSync }), timers);
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1));
    expect(next.toISOString()).toBe("2026-10-20T02:30:00.000Z");
    expect(calls[0].ms).toBe(22 * 60 * 60_000);
  });

  it("arms the next day after each run", async () => {
    let now = "2026-10-19T01:30:00Z";
    const runSync = vi.fn(async () => "x");
    const { calls, timers } = fakeTimers();
    startSyncSchedule(EIGHT, { ...deps({ at: now, runSync }), now: () => new Date(now) }, timers);
    now = "2026-10-19T02:30:00Z";
    calls[0].fn();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(calls[1].ms).toBe(24 * 60 * 60_000);
  });
});

describe("retry after a failure", () => {
  function fakeTimers() {
    const calls: Array<{ fn: () => void; ms: number }> = [];
    return { calls, timers: { setTimeout: (fn: () => void, ms: number) => (calls.push({ fn, ms }), {}) } };
  }
  const SLOT = new Date("2026-10-19T02:30:00Z");

  it("tries again after 30 minutes for the same scheduled time, at most 3 attempts", async () => {
    const runSync = vi.fn(async () => Promise.reject(new Error("BigQuery down")));
    const since = vi.fn<(since: Date) => Promise<Date | null>>(async () => null);
    let now = "2026-10-19T02:30:00Z";
    const d = { ...deps({ at: now, runSync, lastSuccessSince: since }), now: () => new Date(now) };
    const { calls, timers } = fakeTimers();

    expect(await runWithRetry(EIGHT, SLOT, d, timers)).toBe("failed");
    expect(calls).toHaveLength(1);
    expect(calls[0].ms).toBe(RETRY_DELAY_MS);
    expect(RETRY_DELAY_MS).toBe(30 * 60_000);

    now = "2026-10-19T03:00:00Z";
    calls[0].fn();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    now = "2026-10-19T03:30:00Z";
    calls[1].fn();
    await vi.waitFor(() => expect(d.errors.at(-1)).toContain(`Gave up after ${MAX_ATTEMPTS} attempts`));

    expect(runSync).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(2); // no 4th attempt
    for (const c of since.mock.calls) expect(c[0]).toEqual(SLOT); // every retry checks the same scheduled time
    expect(d.logs).toContain("[sync-schedule] Retry 2 of 3 in 30 minutes.");
  });

  it("stops retrying when a retry succeeds", async () => {
    let fail = true;
    const runSync = vi.fn(async () => (fail ? Promise.reject(new Error("timeout")) : "sync run 9"));
    const d = deps({ at: "2026-10-19T02:30:00Z", runSync });
    const { calls, timers } = fakeTimers();
    await runWithRetry(EIGHT, SLOT, d, timers);
    fail = false;
    calls[0].fn();
    await vi.waitFor(() => expect(d.logs.at(-1)).toContain("Daily sync done: sync run 9"));
    expect(calls).toHaveLength(1);
  });

  it("does not retry a skip (lock held or already done)", async () => {
    const { calls, timers } = fakeTimers();
    expect(await runWithRetry(EIGHT, SLOT, deps({ at: "2026-10-19T02:30:00Z", withLock: async () => ({ ran: false }) }), timers)).toBe("locked");
    expect(await runWithRetry(EIGHT, SLOT, deps({ at: "2026-10-19T02:30:00Z", lastSuccessSince: async () => SLOT }), timers)).toBe("already-done");
    expect(calls).toHaveLength(0);
  });

  it("arms the next day at once, also while a retry is pending", async () => {
    let now = "2026-10-19T01:30:00Z";
    const runSync = vi.fn(async () => Promise.reject(new Error("down")));
    const { calls, timers } = fakeTimers();
    startSyncSchedule(EIGHT, { ...deps({ at: now, runSync }), now: () => new Date(now) }, timers);
    now = "2026-10-19T02:30:00Z";
    calls[0].fn();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1].ms).toBe(24 * 60 * 60_000); // next day
    expect(calls[2].ms).toBe(RETRY_DELAY_MS); // retry of today
  });
});
