import "dotenv/config";
/**
 * Load SYNTHETIC TEST dealers (codes DEMO0001.., DEMO-C1; names "Demo Dealer ...") and run the engine.
 * The values are invented test numbers for the cases below. They are NOT client data.
 * Period values cover the full scheme period (also future months) so that each case shows its final slab.
 *
 * Only rows with dealer_code LIKE 'DEMO%' are deleted and written. Usage: npm run data:demo
 */
import { like } from "drizzle-orm";
import { getDb, getPool } from "@/db/client";
import {
  dealer,
  dealerMetric,
  dealerOdStatus,
  dealerRewardChoice,
  dealerRewardChoiceLog,
  dealerSchemeEnrolment,
  dealerSchemeResult,
} from "@/db/schema";
import { SCHEME_TAGS, SCHEMES } from "@/config/schemes";
import { createSyncRun, finishSyncRun } from "@/server/repo";
import { runEngine } from "@/server/run-engine";
import { runScriptWithSyncLock } from "@/sync/sync-lock";

const FB_PAN = SCHEME_TAGS.festiveBonanzaPan;
const FB_TNHPJK = SCHEME_TAGS.festiveBonanzaTnHpJk;
const SP_Q3 = SCHEME_TAGS.starPoints;
const DEMO_REGION = "DEMO Region (outside TN/HP/JK)";

type Row = { dealerCode: string; schemeTag: string; metric: string; month: string; value: number };
const metrics: Row[] = [];
const add = (dealerCode: string, schemeTag: string, metric: string, month: string, value: number) =>
  metrics.push({ dealerCode, schemeTag, metric, month, value });

/** Festive Bonanza GSR: Q1 months Apr–Jun, then Oct, Nov. */
function dm(code: string, tag: string, q1: [number, number, number], oct: number, nov: number) {
  add(code, tag, "gsr", "2026-04", q1[0]);
  add(code, tag, "gsr", "2026-05", q1[1]);
  add(code, tag, "gsr", "2026-06", q1[2]);
  add(code, tag, "gsr", "2026-10", oct);
  add(code, tag, "gsr", "2026-11", nov);
}

/** Star Points: Q1 GSR per month, Q3 GSR per month, litres per month per category, tools GSR per month. */
function gt(
  code: string,
  q1: [number, number, number],
  q3: [number, number, number],
  litres: Record<string, Record<string, number>>,
  tools: Record<string, number> = {},
) {
  ["2026-04", "2026-05", "2026-06"].forEach((m, i) => add(code, SP_Q3, "gsr", m, q1[i]));
  ["2026-10", "2026-11", "2026-12"].forEach((m, i) => add(code, SP_Q3, "gsr", m, q3[i]));
  for (const [month, cats] of Object.entries(litres)) {
    for (const [cat, l] of Object.entries(cats)) add(code, SP_Q3, `litres_${cat}`, month, l);
  }
  for (const [month, v] of Object.entries(tools)) add(code, SP_Q3, "tools_gsr", month, v);
}

const dealers: Array<typeof dealer.$inferInsert> = [];
const d = (code: string, name: string, regionName: string | null, parentCode: string | null = null) =>
  dealers.push({ code, name: `Demo Dealer ${name}`, zone: "DEMO", regionName, regionCode: null, parentCode });

// DEMO0001 – FB-PAN circular example: Q1 4.5 L, Oct 1.6 L + Nov 2.0 L = 3.6 L, growth 20% -> Slab 1. Choice GIFT.
d("DEMO0001", "01 FB-PAN circular example (Slab 1)", DEMO_REGION);
dm("DEMO0001", FB_PAN, [150_000, 150_000, 150_000], 160_000, 200_000);

// DEMO0002 – FB-PAN growth not met: Q1 6 L (2 L/month), Oct 1.5 L + Nov 1.5 L -> no slab (growth).
d("DEMO0002", "02 FB-PAN growth fail (no slab)", DEMO_REGION);
dm("DEMO0002", FB_PAN, [200_000, 200_000, 200_000], 150_000, 150_000);

// DEMO0003 – CLAUDE.md §11 case: Oct 3 L, Nov 3.5 L, growth ~17% -> fails Slab 1 growth (20%) -> no slab
// (Slab 3 conditions are all met, but STOP_AT_FIRST_FAIL stops at Slab 1).
d("DEMO0003", "03 FB-PAN lower-growth case (no slab)", DEMO_REGION);
dm("DEMO0003", FB_PAN, [277_778, 277_778, 277_778], 300_000, 350_000);

// DEMO0004 – FB-PAN Slab 7: Oct 7 L + Nov 9 L = 16 L, Q1 9 L. Dec return 0.2 L (material return). Choice CN.
d("DEMO0004", "04 FB-PAN top slab (Slab 7)", DEMO_REGION);
dm("DEMO0004", FB_PAN, [300_000, 300_000, 300_000], 700_000, 900_000);
add("DEMO0004", FB_PAN, "gsr", "2026-12", -20_000);
add("DEMO0004", FB_PAN, "mrv", "2026-12", -20_000);

// DEMO0005 – FB-TNHPJK (TN North): Oct 2 L + Nov 2.5 L = 4.5 L -> Slab 2 (no growth condition). Also FB-PAN metrics -> region not in scope.
d("DEMO0005", "05 FB-TNHPJK TN North (Slab 2)", "TN North");
dm("DEMO0005", FB_TNHPJK, [300_000, 300_000, 300_000], 200_000, 250_000);
dm("DEMO0005", FB_PAN, [300_000, 300_000, 300_000], 200_000, 250_000);

// DEMO0006 – not in the dealer master: region unknown.
dm("DEMO0006", FB_PAN, [100_000, 100_000, 100_000], 200_000, 200_000);

// DEMO0007 – Star Points Slab 3: Oct 3,000 L Luxury x 30 = 90,000; Nov 3,000 L Luxury x 14 = 42,000;
// Dec 1,000 L Premium x 6 = 6,000 -> 138,000 points. Q1 15 L, Q3 18 L (growth 20%). Choice CN.
d("DEMO0007", "07 SP (Slab 3)", DEMO_REGION);
gt("DEMO0007", [500_000, 500_000, 500_000], [600_000, 600_000, 600_000], {
  "2026-10": { LUXURY: 3_000 },
  "2026-11": { LUXURY: 3_000 },
  "2026-12": { PREMIUM: 1_000 },
});

// DEMO0008 – Star Points beyond Slab 7: 300,000 + 140,000 + 30,000 + 6,000 + tools 4,000 (10 x 400) = 480,000 points.
// Q1 30 L, Q3 60 L (growth 100%). Choice GIFT.
d("DEMO0008", "08 SP beyond Slab 7", DEMO_REGION);
gt(
  "DEMO0008",
  [1_000_000, 1_000_000, 1_000_000],
  [2_000_000, 2_000_000, 2_000_000],
  {
    "2026-10": { LUXURY: 10_000 },
    "2026-11": { LUXURY: 10_000 },
    "2026-12": { PREMIUM: 5_000, ENAMELS: 2_000 },
  },
  { "2026-12": 150_000 },
);

// DEMO0009 – enrolled in Star Points. FB numbers would reach FB-PAN Slab 1, but FB-PAN shows "enrolled in other scheme".
// SP points 30,000 (1,000 L Luxury in Oct) -> no slab (points).
d("DEMO0009", "09 enrolled in SP", DEMO_REGION);
dm("DEMO0009", FB_PAN, [150_000, 150_000, 150_000], 160_000, 200_000);
gt("DEMO0009", [300_000, 300_000, 300_000], [400_000, 400_000, 400_000], { "2026-10": { LUXURY: 1_000 } });

// DEMO0010 – parent with child DEMO-C1 (child sales are rolled up to the parent). FB-PAN Slab 2.
d("DEMO0010", "10 parent (Slab 2)", DEMO_REGION);
d("DEMO-C1", "10-C1 child of DEMO0010", DEMO_REGION, "DEMO0010");
dm("DEMO0010", FB_PAN, [150_000, 150_000, 150_000], 200_000, 250_000);

// DEMO0011 – FB-PAN Slab 1 numbers, but OD on 30-11-2026 -> benefit blocked.
d("DEMO0011", "11 OD on check date", DEMO_REGION);
dm("DEMO0011", FB_PAN, [150_000, 150_000, 150_000], 160_000, 200_000);

// DEMO0012 – zero Q1 sales of any product (BA, 19-10-2026): Oct 3 L + Nov 3 L would meet the GSR of Slab 2,
// but with no Q1 FY 2026-27 sales at all the growth is not met -> FB-PAN no slab (SLAB1_GROWTH_NOT_MET).
d("DEMO0012", "12 FB-PAN zero Q1 sales (no slab)", DEMO_REGION);
dm("DEMO0012", FB_PAN, [0, 0, 0], 300_000, 300_000);

// DEMO0013 – zero Q1 scheme base, but Q1 sales of other products (total_gsr 1 L a month): the growth is met on the
// zero base -> FB-PAN Slab 1 (Oct 1.6 L + Nov 2 L = 3.6 L).
d("DEMO0013", "13 FB-PAN Q1 sales of other products only (Slab 1)", DEMO_REGION);
dm("DEMO0013", FB_PAN, [0, 0, 0], 160_000, 200_000);
["2026-04", "2026-05", "2026-06"].forEach((m) => add("DEMO0013", FB_PAN, "total_gsr", m, 100_000));

// DEMO0014 – Star Points growth on total GSR (BA, 19-10-2026): Table III GSR 5 L a month in Q1 and in Q3 (0%),
// total GSR 6 L a month in Q1 and 7 L a month in Q3 (+16.7%). 3,000 L Luxury in Oct x 30 = 90,000 points
// -> Slab 1 only because the growth uses total GSR.
d("DEMO0014", "14 SP growth on total GSR (Slab 1)", DEMO_REGION);
gt("DEMO0014", [500_000, 500_000, 500_000], [500_000, 500_000, 500_000], { "2026-10": { LUXURY: 3_000 } });
["2026-04", "2026-05", "2026-06"].forEach((m) => add("DEMO0014", SP_Q3, "total_gsr", m, 600_000));
["2026-10", "2026-11", "2026-12"].forEach((m) => add("DEMO0014", SP_Q3, "total_gsr", m, 700_000));

const enrolments = [{ dealerCode: "DEMO0009", schemeTag: SP_Q3, source: "DEMO" }];
const choices = [
  { dealerCode: "DEMO0001", schemeTag: FB_PAN, choice: "GIFT", source: "DEMO" },
  { dealerCode: "DEMO0004", schemeTag: FB_PAN, choice: "CN", source: "DEMO" },
  { dealerCode: "DEMO0007", schemeTag: SP_Q3, choice: "CN", source: "DEMO" },
  { dealerCode: "DEMO0008", schemeTag: SP_Q3, choice: "GIFT", destination: "OVERSEAS", source: "DEMO" },
];
const fbOdDate = SCHEMES.find((s) => s.tag === FB_PAN)?.odCheckDate ?? "2026-11-30";
const od = [{ dealerCode: "DEMO0011", asOfDate: fbOdDate, hasOd: true, odAmount: "25000", source: "DEMO" }];

async function loadDemo(): Promise<void> {
  const db = getDb();
  const runId = await createSyncRun(db, "DEMO");
  try {
    await db.transaction(async (tx) => {
      const demo = "DEMO%";
      await tx.delete(dealerSchemeResult).where(like(dealerSchemeResult.dealerCode, demo));
      await tx.delete(dealerMetric).where(like(dealerMetric.dealerCode, demo));
      await tx.delete(dealerRewardChoice).where(like(dealerRewardChoice.dealerCode, demo));
      await tx.delete(dealerRewardChoiceLog).where(like(dealerRewardChoiceLog.dealerCode, demo));
      await tx.delete(dealerOdStatus).where(like(dealerOdStatus.dealerCode, demo));
      await tx.delete(dealerSchemeEnrolment).where(like(dealerSchemeEnrolment.dealerCode, demo));
      await tx.delete(dealer).where(like(dealer.code, demo));

      await tx.insert(dealer).values(dealers);
      await tx.insert(dealerMetric).values(
        metrics.map((m) => ({ ...m, value: String(m.value), syncRunId: runId })),
      );
      await tx.insert(dealerSchemeEnrolment).values(enrolments);
      await tx.insert(dealerRewardChoice).values(choices);
      await tx.insert(dealerOdStatus).values(od);
    });
    await finishSyncRun(db, runId, {
      status: "SUCCESS",
      dataAsOf: new Date(),
      rowCount: metrics.length,
      message: `Synthetic demo data: ${dealers.length} dealers, ${metrics.length} metric rows.`,
    });
    console.log(`Demo data loaded: ${dealers.length} dealers, ${metrics.length} metric rows (sync_run ${runId}).`);

    const started = Date.now();
    const r = await runEngine(db, { syncRunId: runId });
    console.log(`Engine: ${r.dealers} dealers, ${r.results} results, ${r.changed} changed, ${r.removed} removed (${Date.now() - started} ms).`);
  } catch (err) {
    await finishSyncRun(db, runId, { status: "FAILED", message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** The demo rows and the engine run are written under the sync lock, so that a running sync is never mixed in. */
async function main(): Promise<void> {
  await runScriptWithSyncLock(getPool(), "Demo load", loadDemo);
}

main()
  .catch((err: unknown) => {
    console.error("Demo load failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
