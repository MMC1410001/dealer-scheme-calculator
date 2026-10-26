import "dotenv/config";
/**
 * Run the scheme engine on the stored dealer_metric totals and print the counts.
 * Usage: npm run engine:run [-- --today=YYYY-MM-DD] [-- --sync-run=<id>]
 */
import { getDb, getPool } from "@/db/client";
import { getAdminReport } from "@/server/repo";
import { runEngine } from "@/server/run-engine";
import { runScriptWithSyncLock } from "@/sync/sync-lock";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  const today = arg("today");
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("--today must be YYYY-MM-DD.");
  const syncRunArg = arg("sync-run");
  const syncRunId = syncRunArg ? Number(syncRunArg) : undefined;

  const started = Date.now();
  // Under the sync lock: a sync running at the same time would otherwise mix old and new results.
  const locked = await runScriptWithSyncLock(getPool(), "Engine run", () => runEngine(getDb(), { today, syncRunId }));
  if (!locked.ran) return;
  const r = locked.value;
  console.log(`Engine: ${r.dealers} dealers, ${r.results} results, ${r.changed} changed, ${r.removed} removed (${Date.now() - started} ms).`);

  const report = await getAdminReport();
  for (const s of report.schemes) {
    const notIn = s.notInScope.map((x) => `${x.reasonCode}=${x.count}`).join(", ") || "-";
    const noSlab = s.noSlab.map((x) => `${x.reasonCode}=${x.count}`).join(", ") || "-";
    const slabs = s.slabs
      .filter((x) => x.dealers > 0)
      .map((x) => `S${x.slabNo}=${x.dealers} (gift ${x.gift}, cn ${x.cn}, blocked ${x.benefitBlocked})`)
      .join("; ") || "-";
    console.log(`${s.tag}: in scheme ${s.inScope} | slabs: ${slabs} | no slab: ${noSlab} | not in scope: ${notIn}`);
  }
}

main()
  .catch((err: unknown) => {
    console.error("Engine run failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
