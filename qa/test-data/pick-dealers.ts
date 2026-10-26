/**
 * Picks a few real dealers from the stored results (dealer_scheme_result) and writes qa/test-data/dealers.json.
 *
 *   npm run qa:pick-dealers                          # database of DATABASE_URL (.env)
 *   npm run qa:pick-dealers -- --pool 2000           # size of the k6 dealer pool (default 1000)
 *   npm run qa:pick-dealers -- --include-demo        # also pick the synthetic DEMO dealers
 *
 * Only reads the database (one READ ONLY transaction). dealers.json holds real dealer codes (client data): it is
 * git-ignored. Share it with QA only through the team's secret store, never in the repository or a chat.
 *
 * dealers.main          the dealer with the highest slab, IN_SCHEME in the most schemes (Playwright DEALER_CODE)
 * dealers.no_slab       IN_SCHEME, but Slab 1 is not met
 * dealers.not_in_scope  region not in the scope of a scheme
 * dealers.child         {code, parent}: a child dealer whose parent has results
 * pool                  a spread of dealers across the code range, for k6 (DEALERS_FILE=true)
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "dealers.json");

function args(argv: string[]): { pool: number; includeDemo: boolean } {
  const i = argv.indexOf("--pool");
  const pool = i >= 0 ? Number(argv[i + 1]) : 1000;
  if (!Number.isInteger(pool) || pool < 1 || pool > 100_000) throw new Error("--pool must be an integer from 1 to 100000");
  return { pool, includeDemo: argv.includes("--include-demo") };
}

async function main(): Promise<void> {
  const { pool, includeDemo } = args(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const demo = includeDemo ? "" : "AND r.dealer_code NOT LIKE 'DEMO%'";
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const one = async (sql: string): Promise<Record<string, unknown> | undefined> => (await client.query(sql)).rows[0];
    const main = await one(`
      SELECT r.dealer_code FROM dealer_scheme_result r WHERE TRUE ${demo}
      GROUP BY r.dealer_code
      ORDER BY max(r.current_slab_no) DESC NULLS LAST, count(*) FILTER (WHERE r.participation = 'IN_SCHEME') DESC, r.dealer_code
      LIMIT 1`);
    const noSlab = await one(`
      SELECT r.dealer_code FROM dealer_scheme_result r
      WHERE r.participation = 'IN_SCHEME' AND r.current_slab_no IS NULL AND r.reason_code LIKE 'SLAB1_%' ${demo}
      ORDER BY r.dealer_code LIMIT 1`);
    const notInScope = await one(`
      SELECT r.dealer_code FROM dealer_scheme_result r
      WHERE r.participation = 'NOT_IN_SCOPE' AND r.reason_code = 'REGION_NOT_IN_SCOPE' ${demo}
      ORDER BY r.dealer_code LIMIT 1`);
    const child = await one(`
      SELECT d.code, d.parent_code FROM dealer d
      WHERE d.parent_code IS NOT NULL AND d.parent_code <> d.code ${includeDemo ? "" : "AND d.code NOT LIKE 'DEMO%'"}
        AND EXISTS (SELECT 1 FROM dealer_scheme_result r WHERE r.dealer_code = d.parent_code)
      ORDER BY d.code LIMIT 1`);
    const all = (await client.query(`SELECT DISTINCT r.dealer_code FROM dealer_scheme_result r WHERE TRUE ${demo} ORDER BY 1`)).rows.map(
      (r: { dealer_code: string }) => r.dealer_code,
    );
    await client.query("COMMIT");

    const step = Math.max(1, Math.floor(all.length / pool));
    const spread = all.filter((_, i) => i % step === 0).slice(0, pool);
    const dealers = {
      main: main?.dealer_code ?? null,
      no_slab: noSlab?.dealer_code ?? null,
      not_in_scope: notInScope?.dealer_code ?? null,
      child: child ? { code: child.code, parent: child.parent_code } : null,
    };
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          _about: "Real dealer codes for QA (client data, git-ignored). Built by qa/test-data/pick-dealers.ts. Never commit or paste them.",
          source_env: process.env.APP_ENV || "unset",
          generated_at: new Date().toISOString(),
          dealers,
          pool: spread,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`${all.length} dealers with results; picked main/no_slab/not_in_scope/child and a pool of ${spread.length}. Wrote ${OUT}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error("pick-dealers failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
