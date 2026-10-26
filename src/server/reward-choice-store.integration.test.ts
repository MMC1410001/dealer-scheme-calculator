/**
 * Integration test against the local PostgreSQL (DATABASE_URL from .env) with the demo dealers (npm run data:demo).
 * Skipped when the database cannot be reached or the demo dealers are not loaded. Removes its own choices at the end.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getDb, getPool } from "@/db/client";
import { getDealerStatus } from "@/server/repo";
import { cleanupOldData } from "@/sync/cleanup";
import { saveRewardChoices } from "./reward-choice-store";

const TOUCHED = ["DEMO0013", "DEMO0010"];

async function demoDataReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, max: 1 });
  try {
    const r = await pool.query(
      "SELECT (SELECT COUNT(*) FROM dealer WHERE code IN ('DEMO0013','DEMO-C1'))::int AS n, to_regclass('dealer_reward_choice_log') IS NOT NULL AS t",
    );
    return r.rows[0].n === 2 && r.rows[0].t === true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const ready = await demoDataReady();
const noBump = { source: "API" as const, bumpCache: () => Promise.resolve() };
const clean = () =>
  getPool().query(
    "DELETE FROM dealer_reward_choice WHERE dealer_code = ANY($1) AND scheme_tag = 'FB-PAN'; DELETE FROM dealer_reward_choice_log WHERE dealer_code = ANY($1) AND scheme_tag = 'FB-PAN'".replace(
      /\$1/g,
      `ARRAY['${TOUCHED.join("','")}']`,
    ),
  );

describe.skipIf(!ready)("saveRewardChoices against the local database", () => {
  afterAll(async () => {
    await clean();
    await getPool().end();
  });

  it("saves, skips an unchanged re-send, logs only changes, and shows the choice in the dealer status", async () => {
    await clean();
    const db = getDb();
    const input = { dealerCode: "DEMO0013", schemeTag: "FB-PAN", choice: "CN" as const, destination: null, chosenBy: "IT" };
    const [first] = await saveRewardChoices(db, [input], noBump);
    expect(first).toMatchObject({ ok: true, changed: true, dealerCode: "DEMO0013" });
    const [again] = await saveRewardChoices(db, [input], noBump);
    expect(again).toMatchObject({ ok: true, changed: false });
    const [gift] = await saveRewardChoices(db, [{ ...input, choice: "GIFT" }], noBump);
    expect(gift).toMatchObject({ ok: true, changed: true });

    const log = await getPool().query("SELECT choice FROM dealer_reward_choice_log WHERE dealer_code = 'DEMO0013' AND scheme_tag = 'FB-PAN' ORDER BY id");
    expect(log.rows.map((r) => r.choice)).toEqual(["CN", "GIFT"]);

    const status = await getDealerStatus("DEMO0013", ["FB-PAN"]);
    expect(status?.schemes[0].reward_choice).toMatchObject({ choice: "GIFT", destination: null, source: "API", chosen_by: "IT" });
  });

  it("saves a child's choice under the parent and refuses the bad items", async () => {
    const out = await saveRewardChoices(
      getDb(),
      [
        { dealerCode: "DEMO-C1", schemeTag: "FB-PAN", choice: "CN", destination: null, chosenBy: null },
        { dealerCode: "DEMO0002", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: null },
        { dealerCode: "DEMO9999", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: null },
        { dealerCode: "DEMO0013", schemeTag: "ABC9", choice: "GIFT", destination: null, chosenBy: null },
        { dealerCode: "DEMO0007", schemeTag: "SP-Q3", choice: "GIFT", destination: "CRUISE", chosenBy: null },
      ],
      { ...noBump, defaultChosenBy: "admin" },
    );
    expect(out[0]).toMatchObject({ ok: true, dealerCode: "DEMO0010", rewardChoice: { chosen_by: "admin" } });
    expect(out.slice(1).map((o) => (o.ok ? "ok" : o.code))).toEqual(["NOT_IN_SLAB", "DEALER_NOT_FOUND", "UNKNOWN_SCHEME_TAG", "DESTINATION_NOT_ALLOWED"]);
  });

  it("counts change-log rows older than 3 months for the clean-up (dry run)", async () => {
    await getPool().query(
      "INSERT INTO dealer_reward_choice_log (dealer_code, scheme_tag, choice, source, changed_at) VALUES ('DEMO0013', 'FB-PAN', 'CN', 'API', now() - interval '4 months'), ('DEMO0013', 'FB-PAN', 'GIFT', 'API', now() - interval '2 months')",
    );
    const r = await cleanupOldData(getDb(), { dryRun: true });
    const old = await getPool().query("SELECT COUNT(*)::int AS n FROM dealer_reward_choice_log WHERE changed_at < now() - interval '3 months'");
    expect(r.choiceLogRows).toBe(old.rows[0].n);
    expect(r.choiceLogRows).toBeGreaterThanOrEqual(1);
  });

  it("two identical requests at the same time: one change, one log row, the other reports the stored row", async () => {
    await clean();
    const input = { dealerCode: "DEMO0013", schemeTag: "FB-PAN", choice: "CN" as const, destination: null, chosenBy: "RACE" };
    const out = await Promise.all([saveRewardChoices(getDb(), [input], noBump), saveRewardChoices(getDb(), [input], noBump)]);
    const flat = out.map(([o]) => o);
    expect(flat.every((o) => o.ok)).toBe(true);
    expect(flat.filter((o) => o.ok && o.changed)).toHaveLength(1);
    for (const o of flat) expect(o).toMatchObject({ ok: true, rewardChoice: { choice: "CN", chosen_by: "RACE" } });
    const log = await getPool().query("SELECT COUNT(*)::int AS n FROM dealer_reward_choice_log WHERE dealer_code = 'DEMO0013' AND scheme_tag = 'FB-PAN'");
    expect(log.rows[0].n).toBe(1);
  });

  it("refuses all rows for the same dealer and scheme in one batch", async () => {
    const row = { dealerCode: "DEMO0013", schemeTag: "FB-PAN", choice: "CN" as const, destination: null, chosenBy: null };
    const out = await saveRewardChoices(getDb(), [row, { ...row, choice: "GIFT" }], noBump);
    expect(out.map((o) => (o.ok ? "ok" : o.code))).toEqual(["DUPLICATE", "DUPLICATE"]);
  });
});
