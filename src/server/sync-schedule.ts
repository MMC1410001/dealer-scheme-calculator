/**
 * Daily BigQuery sync inside the app server (SYNC_DAILY_AT, India time; default 08:00 outside APP_ENV=local).
 *
 * src/instrumentation.ts starts the schedule once in each server process. Each day at SYNC_DAILY_AT:
 * 1. Take the sync lock (src/sync/sync-lock.ts). When another instance or a manual `npm run sync:bigquery` has it,
 *    skip: that run loads the same data.
 * 2. Skip when a BigQuery sync already succeeded since today's scheduled time (another instance was first).
 * 3. Run the routine sync (the same as `npm run sync:bigquery`), which also runs the engine.
 * 4. After a successful sync, delete the data that no active scheme needs (src/sync/cleanup.ts, `npm run db:cleanup`).
 * At server start after today's scheduled time, the same steps run once. So a server that was down at the
 * scheduled time catches up, and a restart after a successful run does nothing.
 * A failed run is logged and marked FAILED in sync_run (admin "Sync runs"). It is tried again after 30 minutes,
 * at most 3 attempts for one scheduled time. After that, the next try is the next day, or the next server start.
 * A skip (lock held, or already done) is not a failure and is not retried.
 *
 * India has no daylight saving time, so the fixed offset UTC+05:30 is exact.
 */

export interface DailyTime {
  hour: number;
  minute: number;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
/** Wait before the next attempt after a failed sync. */
export const RETRY_DELAY_MS = 30 * 60_000;
/** Attempts for one scheduled time (the first attempt and 2 retries). */
export const MAX_ATTEMPTS = 3;
const DAY_MS = 24 * 60 * 60_000;

/** "HH:MM" (24-hour) -> DailyTime. Null when the text is not a valid time. */
export function parseDailyTime(raw: string): DailyTime | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatDailyTime(t: DailyTime): string {
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/** The scheduled time on the India calendar day of `now`, as an instant. */
export function todaysSlot(now: Date, t: DailyTime): Date {
  const istDayStart = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(istDayStart - IST_OFFSET_MS + (t.hour * 60 + t.minute) * 60_000);
}

/** The first scheduled time strictly after `now`. */
export function nextSlot(now: Date, t: DailyTime): Date {
  const today = todaysSlot(now, t);
  return today.getTime() > now.getTime() ? today : new Date(today.getTime() + DAY_MS);
}

export interface ScheduledSyncDeps {
  now: () => Date;
  /** Runs `work` under the sync lock. { ran: false } when another holder has the lock. */
  withLock: <T>(work: () => Promise<T>) => Promise<{ ran: true; value: T } | { ran: false }>;
  /** Start time of the latest successful BigQuery sync at or after `since`, or null. */
  lastSuccessSince: (since: Date) => Promise<Date | null>;
  /** The routine sync. Returns a one-line summary for the log. */
  runSync: () => Promise<string>;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export type ScheduledSyncOutcome = "ran" | "failed" | "locked" | "already-done";

/**
 * One scheduled attempt (steps 1-3 at the top of this file) for the scheduled time `slot`
 * (default: today's scheduled time). Never throws.
 */
export async function runScheduledSync(
  t: DailyTime,
  deps: ScheduledSyncDeps,
  slot: Date = todaysSlot(deps.now(), t),
): Promise<ScheduledSyncOutcome> {
  try {
    const r = await deps.withLock(async (): Promise<ScheduledSyncOutcome> => {
      const done = await deps.lastSuccessSince(slot);
      if (done) {
        deps.log(`[sync-schedule] Skipped: a sync already succeeded today at ${done.toISOString()}.`);
        return "already-done";
      }
      deps.log("[sync-schedule] Daily sync started.");
      deps.log(`[sync-schedule] Daily sync done: ${await deps.runSync()}`);
      return "ran";
    });
    if (!r.ran) {
      deps.log("[sync-schedule] Skipped: another sync is running (other instance or manual run).");
      return "locked";
    }
    return r.value;
  } catch (err) {
    deps.error(`[sync-schedule] Daily sync failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

export interface ScheduleTimers {
  setTimeout: (fn: () => void, ms: number) => { unref?: () => unknown };
}

/**
 * Attempts the sync for `slot`. After a failure, tries again after RETRY_DELAY_MS, at most MAX_ATTEMPTS in total.
 * Resolves with the outcome of the first attempt; the retries run on later timers.
 */
export async function runWithRetry(
  t: DailyTime,
  slot: Date,
  deps: ScheduledSyncDeps,
  timers: ScheduleTimers,
  attempt = 1,
): Promise<ScheduledSyncOutcome> {
  const outcome = await runScheduledSync(t, deps, slot);
  if (outcome !== "failed") return outcome;
  if (attempt >= MAX_ATTEMPTS) {
    deps.error(`[sync-schedule] Gave up after ${MAX_ATTEMPTS} attempts. The next try is at the next daily time.`);
    return outcome;
  }
  deps.log(`[sync-schedule] Retry ${attempt + 1} of ${MAX_ATTEMPTS} in ${RETRY_DELAY_MS / 60_000} minutes.`);
  const handle = timers.setTimeout(() => void runWithRetry(t, slot, deps, timers, attempt + 1), RETRY_DELAY_MS);
  handle.unref?.();
  return outcome;
}

/**
 * Starts the daily schedule: a catch-up attempt when today's time has passed, then one attempt each day
 * (each with the retries of runWithRetry). Returns the time of the next daily attempt.
 */
export function startSyncSchedule(
  t: DailyTime,
  deps: ScheduledSyncDeps,
  timers: ScheduleTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms) },
): Date {
  const now = deps.now();
  const next = nextSlot(now, t);
  const today = todaysSlot(now, t);
  if (now.getTime() >= today.getTime()) void runWithRetry(t, today, deps, timers);
  const arm = (at: Date): void => {
    const handle = timers.setTimeout(() => {
      // Arm the next day first: the retries of this slot must not delay it.
      arm(nextSlot(new Date(Math.max(deps.now().getTime(), at.getTime())), t));
      void runWithRetry(t, at, deps, timers);
    }, Math.max(0, at.getTime() - deps.now().getTime()));
    // The schedule alone must not keep a process alive.
    handle.unref?.();
  };
  arm(next);
  return next;
}

const globalForSchedule = globalThis as unknown as { __schemeSyncSchedule?: boolean };

/** Wires the real database, lock and BigQuery sync. Called once from src/instrumentation.ts. */
export async function startDailySyncFromConfig(t: DailyTime | null): Promise<void> {
  if (!t || globalForSchedule.__schemeSyncSchedule) return;
  globalForSchedule.__schemeSyncSchedule = true;
  const [{ getDb, getPool }, { withSyncLock }, { lastSuccessfulSyncSince }, { runBigQuerySync }, { cleanupOldData, formatCleanup }] =
    await Promise.all([
      import("@/db/client"),
      import("@/sync/sync-lock"),
      import("@/server/repo"),
      import("@/sync/run-sync"),
      import("@/sync/cleanup"),
    ]);
  const next = startSyncSchedule(t, {
    now: () => new Date(),
    withLock: (work) => withSyncLock(getPool(), work),
    lastSuccessSince: (since) => lastSuccessfulSyncSince(getDb(), "BIGQUERY", since),
    runSync: async () => {
      const r = await runBigQuerySync(getDb(), { printSql: false, log: (m) => console.log(`[sync-schedule] ${m}`) });
      // Daily cleanup after a successful sync. A cleanup error is logged only: it must not fail (and retry) the sync.
      let cleanup: string;
      try {
        cleanup = formatCleanup(await cleanupOldData(getDb()));
      } catch (err) {
        cleanup = "cleanup failed";
        console.error(`[sync-schedule] Cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return `sync run ${r.syncRunId}, dealers=${r.dealers ?? 0}, metric rows=${r.metricRows ?? 0}, engine results=${r.engine?.results ?? 0}; ${cleanup}`;
    },
    log: (m) => console.log(m),
    error: (m) => console.error(m),
  });
  console.log(`[sync-schedule] Daily BigQuery sync at ${formatDailyTime(t)} IST. Next: ${next.toISOString()}.`);
}
