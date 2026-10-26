/**
 * Daily data cleanup (Mayur, 19-10-2026). Runs after the scheduled daily sync, and with `npm run db:cleanup`.
 *
 * 1. dealer_metric: delete the rows that no active scheme uses, that is, the scheme is not active, or the month is
 *    not one of the scheme's base, period or return-window months. The Q1 base stays while a scheme needs it.
 * 2. sync_run: delete the runs that started more than SYNC_RUN_RETENTION_MONTHS before today and that no
 *    dealer_metric or dealer_scheme_result row refers to. The stored-base check (tagsWithStoredBase) joins
 *    dealer_metric to sync_run, so a referenced run must stay, or every sync would read the base period again.
 * 3. dealer_reward_choice_log: delete the change rows older than REWARD_CHOICE_LOG_RETENTION_MONTHS (Mayur, 22-10-2026:
 *    3 months). The current choice (dealer_reward_choice, one row per dealer and scheme) is never deleted here.
 *    reward_choice_upload (upload history): the uploads older than the same cutoff are deleted with their log rows.
 * dealer_scheme_result has one row per dealer and scheme (each engine run updates it), so it does not grow.
 * After a step that deleted rows, VACUUM (ANALYZE) runs on that table: the space of the deleted rows can be used
 * again, and the planner statistics stay current. Plain VACUUM does not block reads or writes. VACUUM FULL (which
 * locks the table) is never run here: it is a manual step that needs the user's OK.
 * With no active scheme, step 1 is skipped (it would delete every row).
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { SchemeConfig } from "@/engine/types";
import { loadSchemes } from "@/server/scheme-loader";
import { todayInKolkata } from "@/server/run-engine";

export const SYNC_RUN_RETENTION_MONTHS = 6;
/** Audit rows of reward choice changes are kept for 3 months (Mayur, 22-10-2026). */
export const REWARD_CHOICE_LOG_RETENTION_MONTHS = 3;

export interface CleanupResult {
  /** dealer_metric rows deleted (or that would be deleted, with dryRun). Null when step 1 was skipped. */
  metricRows: number | null;
  /** sync_run rows deleted (or that would be deleted, with dryRun). */
  syncRuns: number;
  /** sync_run rows older than this date (YYYY-MM-DD) are candidates. */
  syncRunCutoff: string;
  /** dealer_reward_choice_log rows deleted (or that would be deleted, with dryRun). */
  choiceLogRows: number;
  /** dealer_reward_choice_log rows changed before this date (YYYY-MM-DD) are deleted. */
  choiceLogCutoff: string;
  /** reward_choice_upload rows (uploaded before choiceLogCutoff) deleted (or that would be deleted, with dryRun). */
  choiceUploads: number;
}

/** (scheme tag, month) pairs that the active schemes use: base, period and return-window months. */
export function neededTagMonths(schemes: SchemeConfig[]): Array<{ tag: string; month: string }> {
  const out: Array<{ tag: string; month: string }> = [];
  for (const s of schemes) {
    for (const month of new Set([...s.baseMonths, ...s.periodMonths, ...s.returnWindowMonths])) {
      out.push({ tag: s.tag, month });
    }
  }
  return out;
}

/** today (YYYY-MM-DD) minus `months` calendar months. A day that does not exist goes to the month end. */
export function monthsBefore(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

function rowCount(r: unknown): number {
  return Number((r as { rowCount?: number | null }).rowCount ?? 0);
}

export async function cleanupOldData(db: Db, opts: { today?: string; dryRun?: boolean } = {}): Promise<CleanupResult> {
  const today = opts.today ?? todayInKolkata();
  const syncRunCutoff = monthsBefore(today, SYNC_RUN_RETENTION_MONTHS);
  const schemes = await loadSchemes(db);

  let metricRows: number | null = null;
  if (schemes.length > 0) {
    const keep = JSON.stringify(neededTagMonths(schemes));
    const unused = sql`NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(${keep}::jsonb) AS k(tag text, month text)
      WHERE k.tag = dm.scheme_tag AND k.month = dm.month
    )`;
    if (opts.dryRun) {
      const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM dealer_metric AS dm WHERE ${unused}`);
      metricRows = Number((r.rows[0] as { n: number }).n);
    } else {
      metricRows = rowCount(await db.execute(sql`DELETE FROM dealer_metric AS dm WHERE ${unused}`));
    }
  }

  const oldRuns = sql`sr.started_at < ${syncRunCutoff}::date
    AND sr.status <> 'RUNNING'
    AND NOT EXISTS (SELECT 1 FROM dealer_metric AS dm WHERE dm.sync_run_id = sr.id)
    AND NOT EXISTS (SELECT 1 FROM dealer_scheme_result AS r WHERE r.sync_run_id = sr.id)`;
  const syncRuns = opts.dryRun
    ? Number(((await db.execute(sql`SELECT COUNT(*)::int AS n FROM sync_run AS sr WHERE ${oldRuns}`)).rows[0] as { n: number }).n)
    : rowCount(await db.execute(sql`DELETE FROM sync_run AS sr WHERE ${oldRuns}`));

  const choiceLogCutoff = monthsBefore(today, REWARD_CHOICE_LOG_RETENTION_MONTHS);
  // changed_at is a timestamp with time zone: compare with the start of the cutoff day in India time.
  const oldLog = sql`changed_at < (${choiceLogCutoff}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const choiceLogRows = opts.dryRun
    ? Number(((await db.execute(sql`SELECT COUNT(*)::int AS n FROM dealer_reward_choice_log WHERE ${oldLog}`)).rows[0] as { n: number }).n)
    : rowCount(await db.execute(sql`DELETE FROM dealer_reward_choice_log WHERE ${oldLog}`));
  // Upload history: same cutoff. A newer log row of an old upload keeps its row, with upload_id set to NULL.
  const oldUpload = sql`uploaded_at < (${choiceLogCutoff}::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
  const choiceUploads = opts.dryRun
    ? Number(((await db.execute(sql`SELECT COUNT(*)::int AS n FROM reward_choice_upload WHERE ${oldUpload}`)).rows[0] as { n: number }).n)
    : rowCount(await db.execute(sql`DELETE FROM reward_choice_upload WHERE ${oldUpload}`));

  if (!opts.dryRun) {
    // VACUUM cannot run inside a transaction: each statement runs on its own (autocommit). Table names are constants.
    const deleted: Array<[string, number]> = [
      ["dealer_metric", metricRows ?? 0],
      ["sync_run", syncRuns],
      ["dealer_reward_choice_log", choiceLogRows],
      ["reward_choice_upload", choiceUploads],
    ];
    for (const [table, n] of deleted) if (n > 0) await db.execute(sql.raw(`VACUUM (ANALYZE) ${table}`));
  }

  return { metricRows, syncRuns, syncRunCutoff, choiceLogRows, choiceLogCutoff, choiceUploads };
}

export function formatCleanup(r: CleanupResult, dryRun = false): string {
  const verb = dryRun ? "would delete" : "deleted";
  const metrics = r.metricRows === null ? "dealer_metric skipped (no active scheme)" : `${verb} ${r.metricRows} dealer_metric rows`;
  return (
    `cleanup: ${metrics}, ${verb} ${r.syncRuns} sync_run rows (started before ${r.syncRunCutoff}, not referenced), ` +
    `${verb} ${r.choiceLogRows} dealer_reward_choice_log rows (changed before ${r.choiceLogCutoff}), ` +
    `${verb} ${r.choiceUploads} reward_choice_upload rows`
  );
}
