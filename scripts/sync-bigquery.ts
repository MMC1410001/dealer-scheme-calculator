import "dotenv/config";
/**
 * BigQuery sync: dealer master + per-dealer monthly totals -> PostgreSQL, then the scheme engine.
 *
 * Usage:
 *   npm run sync:bigquery              # routine: scheme period only (about 75 MB per query), write, run the engine.
 *                                      # A scheme with no stored base period (Q1) also gets its base query (once).
 *   npm run sync:bigquery -- --base    # also refresh the closed base period (Q1, reads the NULL partition, about 2.2 GB per query)
 *   npm run sync:bigquery -- --dry-run # print the SQL and the bytes each query would scan; nothing runs or is written
 *   --no-sql                           # with --dry-run: do not print the SQL
 *
 * A real run takes the sync lock (src/sync/sync-lock.ts). When the daily schedule (SYNC_DAILY_AT) or another manual
 * run has it, this run stops with exit code 1 and changes nothing.
 *
 * Needs: DATABASE_URL, the seeded scheme configuration (npm run db:seed), and BigQuery credentials
 * (GOOGLE_APPLICATION_CREDENTIALS key file, or Application Default Credentials: gcloud auth application-default login).
 */
import { getDb, getPool } from "@/db/client";
import { formatBytes } from "@/sync/bigquery-client";
import { runBigQuerySync } from "@/sync/run-sync";
import { withSyncLock } from "@/sync/sync-lock";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const quiet = process.argv.includes("--no-sql");
  const refreshBase = process.argv.includes("--base");
  const started = Date.now();
  const sync = () => runBigQuerySync(getDb(), { dryRun, printSql: !quiet, refreshBase });
  let r;
  if (dryRun) {
    r = await sync();
  } else {
    const locked = await withSyncLock(getPool(), sync);
    if (!locked.ran) {
      console.error("Another BigQuery sync is running (daily schedule or another manual run). Try again after it ends.");
      process.exitCode = 1;
      return;
    }
    r = locked.value;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (r.dryRun) {
    console.log(`Dry run done: ${r.queries.length} queries, ${formatBytes(r.totalDryRunBytes)} would be scanned (${secs}s).`);
    return;
  }
  const scanned = r.queries.reduce((s, q) => s + (q.bytesProcessed ?? 0), 0);
  console.log(
    `Sync run ${r.syncRunId} done in ${secs}s: dealers=${r.dealers}, metric rows=${r.metricRows}, ` +
      `data as of ${r.dataAsOf ?? "-"}, scanned ${formatBytes(scanned)}, engine results=${r.engine?.results ?? 0}.`,
  );
}

main()
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("BigQuery sync failed:", msg);
    if (/default credentials|Could not load the default credentials|invalid_grant|reauth/i.test(msg)) {
      console.error("BigQuery credentials are missing or expired. Run: gcloud auth application-default login");
      console.error("Or set GOOGLE_APPLICATION_CREDENTIALS to a service account key file in .env.");
      console.error("Or put the key itself (base64) in BIGQUERY_CREDENTIALS_JSON in .env.");
    }
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
