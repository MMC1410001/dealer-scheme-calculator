/** Automatic setup at server start (src/server/db-setup.ts): seed and engine run only after a change. */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  LOCK_RETRY_DELAY_MS,
  migrationErrorText,
  readBuildId,
  runDbSetup,
  runDbSetupWithRetry,
  type DbSetupDeps,
} from "./db-setup";
import { MAX_ATTEMPTS, RETRY_DELAY_MS } from "./sync-schedule";

function deps(over: Partial<DbSetupDeps> = {}): DbSetupDeps & { logs: string[]; errors: string[]; calls: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const calls: string[] = [];
  return {
    withLock: async (work) => ({ ran: true, value: await work() }),
    configHash: () => "hash-1",
    storedConfigHash: async () => "hash-1",
    seed: async () => {
      calls.push("seed");
      return ["FB-PAN"];
    },
    buildId: "build-1",
    storedBuildId: async () => "build-1",
    saveBuildId: async (id) => {
      calls.push(`save ${id}`);
    },
    runEngine: async () => {
      calls.push("engine");
      return "1 dealers";
    },
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    ...over,
    logs,
    errors,
    calls,
  };
}

describe("runDbSetup", () => {
  it("does nothing when the configuration and the build are unchanged", async () => {
    const d = deps();
    expect(await runDbSetup(d)).toBe("unchanged");
    expect(d.calls).toEqual([]);
  });

  it("seeds and runs the engine when the configuration changed", async () => {
    const d = deps({ storedConfigHash: async () => "hash-0" });
    expect(await runDbSetup(d)).toBe("ran");
    expect(d.calls).toEqual(["seed", "engine", "save build-1"]);
  });

  it("seeds on a database that was never seeded by this code (no stored hash)", async () => {
    const d = deps({ storedConfigHash: async () => null });
    expect(await runDbSetup(d)).toBe("ran");
    expect(d.calls).toEqual(["seed", "engine", "save build-1"]);
  });

  it("runs only the engine for a new build", async () => {
    const d = deps({ storedBuildId: async () => "build-0" });
    expect(await runDbSetup(d)).toBe("ran");
    expect(d.calls).toEqual(["engine", "save build-1"]);
  });

  it("no build ID (next dev): engine only after a seed, and nothing saved", async () => {
    expect((await runDbSetup(deps({ buildId: null, storedBuildId: async () => null }))).valueOf()).toBe("unchanged");
    const d = deps({ buildId: null, storedConfigHash: async () => "hash-0" });
    expect(await runDbSetup(d)).toBe("ran");
    expect(d.calls).toEqual(["seed", "engine"]);
  });

  it("writes nothing when another holder has the lock", async () => {
    const d = deps({ storedConfigHash: async () => "hash-0", withLock: async () => ({ ran: false }) });
    expect(await runDbSetup(d)).toBe("locked");
    expect(d.calls).toEqual([]);
  });

  it("an engine error is logged, not thrown, and the build is not saved (next start tries again)", async () => {
    const d = deps({
      storedBuildId: async () => "build-0",
      runEngine: async () => {
        throw new Error("boom");
      },
    });
    expect(await runDbSetup(d)).toBe("failed");
    expect(d.errors.join()).toContain("boom");
    expect(d.calls).toEqual([]);
  });
});

describe("runDbSetupWithRetry", () => {
  function timers() {
    const pending: Array<{ fn: () => void; ms: number }> = [];
    return { pending, setTimeout: (fn: () => void, ms: number) => (pending.push({ fn, ms }), {}) };
  }

  it("no retry after a run or when unchanged", async () => {
    const t = timers();
    expect(await runDbSetupWithRetry(deps(), t)).toBe("unchanged");
    expect(t.pending).toEqual([]);
  });

  it("tries again after 1 minute while the lock is held", async () => {
    const t = timers();
    let held = true;
    const d = deps({
      withLock: async (work) => {
        if (held) return (held = false), { ran: false };
        return { ran: true, value: await work() };
      },
      storedConfigHash: async () => "hash-0",
    });
    expect(await runDbSetupWithRetry(d, t)).toBe("locked");
    expect(t.pending.map((p) => p.ms)).toEqual([LOCK_RETRY_DELAY_MS]);
    t.pending.shift()!.fn();
    await vi.waitFor(() => expect(d.calls).toEqual(["seed", "engine", "save build-1"]));
    expect(t.pending).toEqual([]);
  });

  it(`after a failure, tries again after 30 minutes, at most ${MAX_ATTEMPTS} attempts`, async () => {
    const t = timers();
    const runEngine = vi.fn<DbSetupDeps["runEngine"]>().mockRejectedValue(new Error("db down"));
    const d = deps({ storedBuildId: async () => "build-0", runEngine });
    expect(await runDbSetupWithRetry(d, t)).toBe("failed");
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      expect(t.pending.map((p) => p.ms)).toEqual([RETRY_DELAY_MS]);
      t.pending.shift()!.fn();
      await vi.waitFor(() => expect(runEngine).toHaveBeenCalledTimes(i));
    }
    await vi.waitFor(() => expect(d.errors.at(-1)).toContain("Gave up"));
    expect(t.pending).toEqual([]);
  });
});

describe("readBuildId", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "db-setup-"));
  mkdirSync(path.join(dir, ".next"));
  writeFileSync(path.join(dir, ".next", "BUILD_ID"), "abc123\n");

  it("reads .next/BUILD_ID on a production server", () => {
    expect(readBuildId(dir, "production")).toBe("abc123");
  });
  it("is null under next dev or without the file", () => {
    expect(readBuildId(dir, "development")).toBeNull();
    expect(readBuildId(path.join(dir, "missing"), "production")).toBeNull();
  });
});

describe("migrationErrorText", () => {
  it("adds the Postgres code and reason from the cause", () => {
    const cause = Object.assign(new Error('relation "x" already exists'), { code: "42P07" });
    expect(migrationErrorText(new Error("Failed query", { cause }))).toBe(
      'Failed query. Cause: [42P07] relation "x" already exists',
    );
    expect(migrationErrorText("plain")).toBe("plain");
  });
});
