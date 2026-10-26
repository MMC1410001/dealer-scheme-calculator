/**
 * One writer of the dealer data at a time, across all processes and server instances that use the same database:
 * the BigQuery sync, and every engine run or seed outside it (they replace results or the configuration that a
 * sync reads).
 *
 * The lock is a PostgreSQL session advisory lock on one dedicated connection. It is released when the work ends,
 * and PostgreSQL releases it when the connection or the process dies, so a crash never leaves it held.
 * Users: the daily schedule (src/server/sync-schedule.ts), `npm run sync:bigquery`, `npm run engine:run`,
 * `npm run data:demo` and `npm run db:seed` (scripts/).
 * Do not import "server-only": the tsx script imports this module.
 */
import type { Pool } from "pg";

/**
 * Fixed key of the sync lock (any 64-bit integer that no other lock in this database uses). It must not look like a
 * dealer code (8 or 10 digits that start with 6 or 7), or the repository hygiene scan flags it (qa/security).
 */
export const SYNC_LOCK_KEY = "5262130401";

export type LockedResult<T> = { ran: true; value: T } | { ran: false };

/** Runs `work` while this process holds the sync lock. Returns { ran: false } at once when another holder has it. */
export async function withSyncLock<T>(pool: Pool, work: () => Promise<T>): Promise<LockedResult<T>> {
  const client = await pool.connect();
  try {
    const got = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1::bigint) as ok", [SYNC_LOCK_KEY]);
    if (!got.rows[0]?.ok) return { ran: false };
    try {
      return { ran: true, value: await work() };
    } finally {
      await client.query("select pg_advisory_unlock($1::bigint)", [SYNC_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/**
 * For the CLI scripts: runs `work` under the sync lock. When another holder has the lock, prints why, sets exit code
 * 1 and returns { ran: false }; nothing is written.
 */
export async function runScriptWithSyncLock<T>(pool: Pool, what: string, work: () => Promise<T>): Promise<LockedResult<T>> {
  const locked = await withSyncLock(pool, work);
  if (!locked.ran) {
    console.error(`${what}: a BigQuery sync, engine run or seed is in progress (daily schedule or another manual run). Try again after it ends.`);
    process.exitCode = 1;
  }
  return locked;
}
