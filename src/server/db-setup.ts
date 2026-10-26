/**
 * Automatic database setup at server start (DB_AUTO_SETUP, default on; Mayur, 26-10-2026), so that a deployment
 * needs no manual `npm run db:migrate`, `npm run db:seed` or `npm run engine:run`.
 *
 * src/instrumentation.ts (through src/server/startup.ts) runs:
 * 1. migrateDatabase, before the server takes requests: apply the migrations in drizzle/. A failure stops the
 *    server (exit code 1): it must not run on a schema that does not match the code. A PostgreSQL advisory lock
 *    lets one instance migrate at a time. The others wait, then find nothing to do.
 * 2. startDbSetup, in the background, under the sync lock (src/sync/sync-lock.ts):
 *    a. Seed when the hash of the rows from src/config differs from the stored hash (app_state).
 *    b. Run the engine after a seed, or when the build (.next/BUILD_ID, production server only) differs from the
 *       build of the last engine run here, because new engine code can change the results.
 *    When another holder has the sync lock (the daily sync, a manual script), try again after 1 minute. After an
 *    error, try again after 30 minutes, at most 3 attempts. The promise resolves after the first attempt.
 * The daily sync starts after that first attempt, so that a catch-up sync reads the new configuration.
 *
 * The scripts `npm run db:migrate` and `npm run db:seed` stay for manual use. They use the same functions.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { appState } from "@/db/schema";
import { MAX_ATTEMPTS, RETRY_DELAY_MS } from "@/server/sync-schedule";

/**
 * Fixed key of the migration lock. It must differ from SYNC_LOCK_KEY and must not look like a dealer code
 * (8 or 10 digits that start with 6 or 7), or the repository hygiene scan flags it (qa/security).
 */
export const MIGRATE_LOCK_KEY = "5262130402";
/** app_state key of the build of the last engine run at startup. */
export const ENGINE_BUILD_ID_KEY = "engine_build_id";
/** Wait before the next attempt when another holder has the sync lock. */
export const LOCK_RETRY_DELAY_MS = 60_000;

const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";

/** Applies the migrations in drizzle/ (relative to the working directory). Returns the number applied. */
export async function migrateDatabase(pool: Pool, migrationsFolder = path.join(process.cwd(), "drizzle")): Promise<number> {
  const client = await pool.connect();
  const applied = async (): Promise<number> => {
    const t = await client.query<{ t: string | null }>("select to_regclass($1) as t", [MIGRATIONS_TABLE]);
    if (!t.rows[0]?.t) return 0;
    const n = await client.query<{ n: string }>(`select count(*) as n from ${MIGRATIONS_TABLE}`);
    return Number(n.rows[0]?.n ?? 0);
  };
  try {
    await client.query("select pg_advisory_lock($1::bigint)", [MIGRATE_LOCK_KEY]);
    try {
      const before = await applied();
      await migrate(drizzle(client), { migrationsFolder });
      return (await applied()) - before;
    } finally {
      await client.query("select pg_advisory_unlock($1::bigint)", [MIGRATE_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Error text of a failed migration. Drizzle wraps the driver error; the Postgres code and reason are in `cause`. */
export function migrationErrorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return `${text}. Cause: ${code ? `[${code}] ` : ""}${cause.message}`;
  }
  return cause !== undefined ? `${text}. Cause: ${String(cause)}` : text;
}

/** Build ID of the production build (.next/BUILD_ID). Null under `next dev` or when the file is missing. */
export function readBuildId(cwd = process.cwd(), nodeEnv = process.env.NODE_ENV): string | null {
  if (nodeEnv !== "production") return null;
  try {
    return readFileSync(path.join(cwd, ".next", "BUILD_ID"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export async function readAppState(db: Db, key: string): Promise<string | null> {
  const [row] = await db.select({ value: appState.value }).from(appState).where(eq(appState.key, key));
  return row?.value ?? null;
}

export async function writeAppState(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: sql`now()` } });
}

export interface DbSetupDeps {
  /** Runs `work` under the sync lock. { ran: false } when another holder has the lock. */
  withLock: <T>(work: () => Promise<T>) => Promise<{ ran: true; value: T } | { ran: false }>;
  /** Hash of the rows that the seed writes now (src/config). */
  configHash: () => string;
  storedConfigHash: () => Promise<string | null>;
  /** Seeds the configuration and stores its hash. Returns one summary line per scheme. */
  seed: () => Promise<string[]>;
  /** Build of this server, or null (no engine run for a new build). */
  buildId: string | null;
  storedBuildId: () => Promise<string | null>;
  saveBuildId: (id: string) => Promise<void>;
  /** Runs the engine. Returns a one-line summary for the log. */
  runEngine: () => Promise<string>;
  log: (msg: string) => void;
  error: (msg: string) => void;
}

export type DbSetupOutcome = "ran" | "unchanged" | "locked" | "failed";

/** One attempt of step 2 at the top of this file. Never throws. */
export async function runDbSetup(deps: DbSetupDeps): Promise<DbSetupOutcome> {
  try {
    const r = await deps.withLock(async (): Promise<DbSetupOutcome> => {
      const seeded = deps.configHash() !== (await deps.storedConfigHash());
      if (seeded) {
        for (const line of await deps.seed()) deps.log(`[db-setup] Seeded ${line}`);
      }
      const newBuild = deps.buildId !== null && deps.buildId !== (await deps.storedBuildId());
      if (!seeded && !newBuild) {
        deps.log("[db-setup] Scheme configuration and build unchanged: no seed, no engine run.");
        return "unchanged";
      }
      deps.log(`[db-setup] Engine run started (${seeded ? "new scheme configuration" : "new build"}).`);
      deps.log(`[db-setup] Engine run done: ${await deps.runEngine()}`);
      if (deps.buildId !== null) await deps.saveBuildId(deps.buildId);
      return "ran";
    });
    if (!r.ran) {
      deps.log(
        `[db-setup] Waiting: a sync, engine run or seed is in progress. Next try in ${LOCK_RETRY_DELAY_MS / 60_000} minute.`,
      );
      return "locked";
    }
    return r.value;
  } catch (err) {
    deps.error(`[db-setup] Seed or engine run failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

export interface SetupTimers {
  setTimeout: (fn: () => void, ms: number) => { unref?: () => unknown };
}

/**
 * Runs runDbSetup. While the lock is held, tries again every LOCK_RETRY_DELAY_MS. After a failure, tries again
 * after RETRY_DELAY_MS, at most MAX_ATTEMPTS in total. Resolves with the outcome of the first attempt.
 */
export async function runDbSetupWithRetry(
  deps: DbSetupDeps,
  timers: SetupTimers = { setTimeout: (fn, ms) => setTimeout(fn, ms) },
  attempt = 1,
): Promise<DbSetupOutcome> {
  const outcome = await runDbSetup(deps);
  let retry: { ms: number; attempt: number } | null = null;
  if (outcome === "locked") retry = { ms: LOCK_RETRY_DELAY_MS, attempt };
  if (outcome === "failed") {
    if (attempt >= MAX_ATTEMPTS) {
      deps.error(`[db-setup] Gave up after ${MAX_ATTEMPTS} attempts. The next try is at the next server start.`);
    } else {
      deps.log(`[db-setup] Retry ${attempt + 1} of ${MAX_ATTEMPTS} in ${RETRY_DELAY_MS / 60_000} minutes.`);
      retry = { ms: RETRY_DELAY_MS, attempt: attempt + 1 };
    }
  }
  if (retry) {
    const next = retry;
    // A retry alone must not keep a process alive.
    timers.setTimeout(() => void runDbSetupWithRetry(deps, timers, next.attempt), next.ms).unref?.();
  }
  return outcome;
}

const globalForSetup = globalThis as unknown as { __schemeDbSetup?: boolean };

/** Wires the real database, lock, seed and engine. Called once from src/server/startup.ts. */
export async function startDbSetup(): Promise<void> {
  if (globalForSetup.__schemeDbSetup) return;
  globalForSetup.__schemeDbSetup = true;
  const [{ getDb, getPool }, { withSyncLock }, { SCHEME_CONFIG_HASH_KEY, buildSeedPlan, seedSchemes }, { runEngine }] =
    await Promise.all([
      import("@/db/client"),
      import("@/sync/sync-lock"),
      import("@/server/scheme-seed"),
      import("@/server/run-engine"),
    ]);
  const plan = buildSeedPlan();
  await runDbSetupWithRetry({
    withLock: (work) => withSyncLock(getPool(), work),
    configHash: () => plan.hash,
    storedConfigHash: () => readAppState(getDb(), SCHEME_CONFIG_HASH_KEY),
    seed: () => seedSchemes(getDb(), plan),
    buildId: readBuildId(),
    storedBuildId: () => readAppState(getDb(), ENGINE_BUILD_ID_KEY),
    saveBuildId: (id) => writeAppState(getDb(), ENGINE_BUILD_ID_KEY, id),
    runEngine: async () => {
      const r = await runEngine(getDb());
      return `${r.dealers} dealers, ${r.results} results, ${r.changed} changed, ${r.removed} removed`;
    },
    log: (m) => console.log(m),
    error: (m) => console.error(m),
  });
}
