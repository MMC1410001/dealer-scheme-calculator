import "dotenv/config";
/**
 * Delete the data that no active scheme needs (src/sync/cleanup.ts). The daily scheduled sync runs the same step.
 * A real run holds the sync lock (it deletes dealer_metric rows that a running sync may write); a dry run only reads.
 * Usage: npm run db:cleanup [-- --dry-run] [-- --today=YYYY-MM-DD]
 */
import { getDb, getPool } from "@/db/client";
import { cleanupOldData, formatCleanup } from "@/sync/cleanup";
import { runScriptWithSyncLock } from "@/sync/sync-lock";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const today = process.argv.find((a) => a.startsWith("--today="))?.slice("--today=".length);
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("--today must be YYYY-MM-DD.");
  const clean = () => cleanupOldData(getDb(), { dryRun, today });
  if (dryRun) {
    console.log(formatCleanup(await clean(), true));
    return;
  }
  const locked = await runScriptWithSyncLock(getPool(), "Cleanup", clean);
  if (locked.ran) console.log(formatCleanup(locked.value));
}

main()
  .catch((err: unknown) => {
    console.error("Cleanup failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
