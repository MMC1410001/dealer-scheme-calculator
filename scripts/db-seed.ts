import "dotenv/config";
/**
 * Seed the scheme configuration (phase 1: the 3 circulars hard-coded in src/config). The seed itself is in
 * src/server/scheme-seed.ts; the server runs it at startup too, when the configuration changed (src/server/db-setup.ts).
 * After the commit, it runs the engine again, so that the stored results follow the new configuration (for example a
 * new Star Points monthly bonus); the engine run increases the API response cache data version.
 * Seed and engine run hold the sync lock: a sync running at the same time would read a half-changed configuration.
 * Usage: npm run db:seed [-- --no-engine]   (--no-engine: configuration only, for example before the first sync)
 */
import { getDb, getPool } from "@/db/client";
import { runEngine } from "@/server/run-engine";
import { seedSchemes } from "@/server/scheme-seed";
import { runScriptWithSyncLock } from "@/sync/sync-lock";

async function main(): Promise<void> {
  const withEngine = !process.argv.includes("--no-engine");
  await runScriptWithSyncLock(getPool(), "Seed", async () => {
    const lines = await seedSchemes(getDb());
    for (const line of lines) console.log(line);
    console.log(`Seeded ${lines.length} schemes.`);
    if (!withEngine) return;
    const started = Date.now();
    const r = await runEngine(getDb());
    console.log(`Engine: ${r.dealers} dealers, ${r.results} results, ${r.changed} changed, ${r.removed} removed (${Date.now() - started} ms).`);
  });
}

main()
  .catch((err: unknown) => {
    console.error("Seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
