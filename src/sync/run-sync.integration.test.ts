/**
 * Integration test of writeSync against the local PostgreSQL (DATABASE_URL from .env): an unchanged re-send writes
 * nothing, a changed value is updated, a row that the new data no longer has is deleted inside the replace scope
 * only, and DEMO rows stay. Test rows only: dealers ZZIT%, scheme FB-PAN month 2099-01 (no real data there).
 * Skipped when the database cannot be reached. Removes its own rows at the end.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getDb, getPool } from "@/db/client";
import type { DealerMasterRow } from "./queries";
import type { MetricInsert } from "./transform";
import { writeSync, type MetricReplaceScope } from "./run-sync";

const TAG = "FB-PAN";
const MONTH = "2099-01";

async function databaseReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, max: 1 });
  try {
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM scheme WHERE tag = $1", [TAG]);
    return r.rows[0].n === 1;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const ready = await databaseReady();
const clean = () =>
  getPool().query(
    "DELETE FROM dealer_metric WHERE month = $1 AND (dealer_code LIKE 'ZZIT%' OR dealer_code = 'DEMOZZIT'); DELETE FROM dealer WHERE code LIKE 'ZZIT%'".replace(
      /\$1/g,
      `'${MONTH}'`,
    ),
  );

const dealerRow = (name: string): DealerMasterRow => ({
  code: "ZZIT0001",
  name,
  zone: "IT",
  region_code: null,
  region_name: "IT Region",
  territory_name: null,
  depot_code: null,
  parent_code: null,
  master_data_month: MONTH,
});
const metric = (dealerCode: string, name: string, value: string): MetricInsert => ({ dealerCode, schemeTag: TAG, metric: name, month: MONTH, value, syncRunId: null });
const scope: MetricReplaceScope[] = [{ tag: TAG, fromMonth: MONTH, toMonth: MONTH }];
/** xmin changes when PostgreSQL writes a new row version: same xmin = the row was not rewritten. */
const versions = async () =>
  (await getPool().query("SELECT dealer_code, metric, value::text, xmin::text FROM dealer_metric WHERE month = $1 AND dealer_code LIKE 'ZZIT%' ORDER BY 1, 2", [MONTH])).rows;
const dealerVersion = async () => (await getPool().query("SELECT xmin::text AS x, name FROM dealer WHERE code = 'ZZIT0001'")).rows[0];

describe.skipIf(!ready)("writeSync against the local database", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await getPool().end();
  });

  it("writes new rows, skips an unchanged re-send, updates a changed value, deletes a missing row, keeps DEMO rows", async () => {
    const db = getDb();
    const first = [metric("ZZIT0001", "gsr", "100.000"), metric("ZZIT0001", "mrv", "-5"), metric("ZZIT0002", "gsr", "7.5")];
    expect(await writeSync(db, [dealerRow("IT Dealer")], first, scope)).toEqual({ dealersChanged: 1, metricsChanged: 3, metricsRemoved: 0 });

    // A DEMO row in the same scope (demo data) must survive every write.
    await getPool().query("INSERT INTO dealer_metric (dealer_code, scheme_tag, metric, month, value) VALUES ('DEMOZZIT', $1, 'gsr', $2, 1)", [TAG, MONTH]);

    const before = await versions();
    const dealerBefore = await dealerVersion();
    // Same data again ("100" and "100.000" are the same numeric value): nothing is written.
    const again = [metric("ZZIT0001", "gsr", "100"), metric("ZZIT0001", "mrv", "-5.000"), metric("ZZIT0002", "gsr", "7.500")];
    expect(await writeSync(db, [dealerRow("IT Dealer")], again, scope)).toEqual({ dealersChanged: 0, metricsChanged: 0, metricsRemoved: 0 });
    expect(await versions()).toEqual(before);
    expect(await dealerVersion()).toEqual(dealerBefore);

    // One value changes, one row is gone from the new data, the dealer name changes.
    const next = [metric("ZZIT0001", "gsr", "120"), metric("ZZIT0001", "mrv", "-5")];
    expect(await writeSync(db, [dealerRow("IT Dealer renamed")], next, scope)).toEqual({ dealersChanged: 1, metricsChanged: 1, metricsRemoved: 1 });
    const after = await versions();
    expect(after.map((r) => [r.dealer_code, r.metric, r.value])).toEqual([
      ["ZZIT0001", "gsr", "120.000"],
      ["ZZIT0001", "mrv", "-5.000"],
    ]);
    // The unchanged mrv row was not rewritten.
    expect(after.find((r) => r.metric === "mrv")?.xmin).toBe(before.find((r) => r.dealer_code === "ZZIT0001" && r.metric === "mrv")?.xmin);
    expect((await dealerVersion()).name).toBe("IT Dealer renamed");

    const demo = await getPool().query("SELECT COUNT(*)::int AS n FROM dealer_metric WHERE dealer_code = 'DEMOZZIT' AND month = $1", [MONTH]);
    expect(demo.rows[0].n).toBe(1);
  });

  it("does not delete rows outside the replace scope", async () => {
    const db = getDb();
    await writeSync(db, [], [metric("ZZIT0003", "gsr", "1")], scope);
    // An empty write with no replace scope removes nothing.
    expect(await writeSync(db, [], [], [])).toEqual({ dealersChanged: 0, metricsChanged: 0, metricsRemoved: 0 });
    const r = await getPool().query("SELECT COUNT(*)::int AS n FROM dealer_metric WHERE dealer_code = 'ZZIT0003' AND month = $1", [MONTH]);
    expect(r.rows[0].n).toBe(1);
  });
});
