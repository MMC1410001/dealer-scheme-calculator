/**
 * Run the scheme engine on the stored per-dealer totals and bring dealer_scheme_result up to date.
 *
 * Reads: scheme (config), dealer, dealer_scheme_enrolment, dealer_od_status, dealer_metric.
 * Writes: dealer_scheme_result, in one transaction: only the changed rows are written, and the rows of dealer/scheme
 * pairs that are gone are deleted. After the commit, it increases the API response cache data version
 * (bumpDataVersion; no-op when the cache is off), so that cached answers are replaced. Always: a new sync also
 * changes data_as_of, even when no result changed.
 *
 * Callers outside the sync must hold the sync lock (src/sync/sync-lock.ts), so that two runs never interleave.
 * Do not import "server-only" here: tsx scripts (sync job, engine-run, demo loader) import this module.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dealer, dealerOdStatus, dealerSchemeEnrolment, dealerSchemeResult, syncRun } from "@/db/schema";
import { evaluateDealerScheme } from "@/engine";
import { STAR_CATEGORIES, type DealerContext, type DealerSchemeMetrics, type StarCategory, type SchemeStatus } from "@/engine/types";
import { loadSchemes } from "@/server/scheme-loader";
import { bumpDataVersion } from "@/server/cache";

/* ------------------------------------------------------------------ */
/* Pure metric grouping                                                 */
/* ------------------------------------------------------------------ */

export interface MetricRow {
  dealerCode: string;
  schemeTag: string;
  /** gsr | total_gsr | mrv | tools_gsr | litres_<STAR CATEGORY> */
  metric: string;
  /** YYYY-MM */
  month: string;
  value: number;
}

const STAR_SET = new Set<string>(STAR_CATEGORIES);

export function emptyMetrics(): DealerSchemeMetrics {
  return { gsrByMonth: {}, mrvByMonth: {} };
}

/**
 * Add one metric value to a DealerSchemeMetrics (values for the same metric and month are summed).
 * Returns false for an unknown metric name (the value is ignored).
 */
export function addMetric(target: DealerSchemeMetrics, metric: string, month: string, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (metric === "gsr") {
    target.gsrByMonth[month] = (target.gsrByMonth[month] ?? 0) + value;
    return true;
  }
  if (metric === "mrv") {
    target.mrvByMonth[month] = (target.mrvByMonth[month] ?? 0) + value;
    return true;
  }
  if (metric === "total_gsr") {
    const t = (target.totalGsrByMonth ??= {});
    t[month] = (t[month] ?? 0) + value;
    return true;
  }
  if (metric === "tools_gsr") {
    const t = (target.toolsGsrByMonth ??= {});
    t[month] = (t[month] ?? 0) + value;
    return true;
  }
  if (metric.startsWith("litres_")) {
    const cat = metric.slice("litres_".length).toUpperCase();
    if (!STAR_SET.has(cat)) return false;
    const byMonth = (target.litresByMonth ??= {});
    const m = (byMonth[month] ??= {});
    const c = cat as StarCategory;
    m[c] = (m[c] ?? 0) + value;
    return true;
  }
  return false;
}

/** Group flat dealer_metric rows into dealer -> scheme tag -> DealerSchemeMetrics. */
export function groupMetrics(rows: Iterable<MetricRow>): Map<string, Map<string, DealerSchemeMetrics>> {
  const out = new Map<string, Map<string, DealerSchemeMetrics>>();
  for (const r of rows) {
    let bySchemes = out.get(r.dealerCode);
    if (!bySchemes) out.set(r.dealerCode, (bySchemes = new Map()));
    let m = bySchemes.get(r.schemeTag);
    if (!m) bySchemes.set(r.schemeTag, (m = emptyMetrics()));
    addMetric(m, r.metric, r.month, r.value);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Engine run                                                           */
/* ------------------------------------------------------------------ */

/** Today's date (YYYY-MM-DD) in Asia/Kolkata. */
export function todayInKolkata(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const BATCH = 1000;

type ResultInsert = typeof dealerSchemeResult.$inferInsert;

export function toResultRow(dealerCode: string, status: SchemeStatus, syncRunId: number | null): ResultInsert {
  return {
    dealerCode,
    schemeTag: status.scheme_tag,
    participation: status.participation,
    reasonCode: status.reason_code ?? null,
    currentSlabNo: status.current_slab_no ?? null,
    benefitBlocked: status.benefit_blocked ?? false,
    provisional: status.provisional ?? true,
    status,
    syncRunId,
  };
}

/** results: rows calculated. changed: rows inserted or updated (result differs). removed: rows of pairs that are gone. */
export interface EngineRunResult {
  dealers: number;
  results: number;
  changed: number;
  removed: number;
}

export async function runEngine(
  db: Db,
  opts: { syncRunId?: number; today?: string } = {},
): Promise<EngineRunResult> {
  const today = opts.today ?? todayInKolkata();
  const schemes = await loadSchemes(db);
  if (schemes.length === 0) throw new Error("No active schemes. Run npm run db:seed first.");

  let syncRunId: number | null = opts.syncRunId ?? null;
  if (syncRunId === null) {
    const [last] = await db
      .select({ id: syncRun.id })
      .from(syncRun)
      .where(eq(syncRun.status, "SUCCESS"))
      // Prefer real (non-DEMO) runs; a DEMO run is used only when no real run exists.
      .orderBy(sql`(${syncRun.source} = 'DEMO')`, desc(syncRun.id))
      .limit(1);
    syncRunId = last?.id ?? null;
  }

  // Metrics: aggregate in SQL to one row per dealer x scheme (keeps the row count low), then group.
  const metricsByDealer = new Map<string, Map<string, DealerSchemeMetrics>>();
  for (const s of schemes) {
    const res = await db.execute<{ dealer_code: string; entries: Array<[string, string, number]> }>(sql`
      SELECT dealer_code, json_agg(json_build_array(metric, month, value::float8)) AS entries
      FROM dealer_metric
      WHERE scheme_tag = ${s.tag}
      GROUP BY dealer_code
    `);
    for (const row of res.rows) {
      const m = emptyMetrics();
      for (const [metric, month, value] of row.entries) addMetric(m, metric, month, Number(value));
      let bySchemes = metricsByDealer.get(row.dealer_code);
      if (!bySchemes) metricsByDealer.set(row.dealer_code, (bySchemes = new Map()));
      bySchemes.set(s.tag, m);
    }
  }

  const enrolRows = await db
    .select({ dealerCode: dealerSchemeEnrolment.dealerCode, schemeTag: dealerSchemeEnrolment.schemeTag })
    .from(dealerSchemeEnrolment);
  const enrolment = new Map(enrolRows.map((r) => [r.dealerCode, r.schemeTag]));

  // Dealers to evaluate: all with metrics for any scheme, plus all enrolled dealers.
  const codes = new Set<string>([...metricsByDealer.keys(), ...enrolment.keys()]);

  // Dealer master (region). Only the codes we need, in chunks.
  const master = new Map<string, { name: string | null; regionName: string | null }>();
  const codeList = [...codes];
  for (let i = 0; i < codeList.length; i += 5000) {
    const chunk = codeList.slice(i, i + 5000);
    const rows = await db
      .select({ code: dealer.code, name: dealer.name, regionName: dealer.regionName })
      .from(dealer)
      .where(inArray(dealer.code, chunk));
    for (const r of rows) master.set(r.code, { name: r.name, regionName: r.regionName });
  }

  // OD status on each scheme's OD check date.
  const odDates = [...new Set(schemes.map((s) => s.odCheckDate))];
  const odRows = await db
    .select({ dealerCode: dealerOdStatus.dealerCode, asOfDate: dealerOdStatus.asOfDate, hasOd: dealerOdStatus.hasOd })
    .from(dealerOdStatus)
    .where(inArray(dealerOdStatus.asOfDate, odDates));
  const od = new Map(odRows.map((r) => [`${r.dealerCode}|${r.asOfDate}`, r.hasOd]));

  const results: ResultInsert[] = [];
  for (const code of codes) {
    const m = master.get(code);
    const bySchemes = metricsByDealer.get(code);
    for (const s of schemes) {
      const ctx: DealerContext = {
        dealerCode: code,
        dealerName: m?.name ?? null,
        regionName: m?.regionName ?? null, // not in the dealer table = region unknown
        enrolledSchemeTag: enrolment.get(code) ?? null,
        hasOdOnCheckDate: od.get(`${code}|${s.odCheckDate}`) ?? null,
      };
      const status = evaluateDealerScheme(s, ctx, bySchemes?.get(s.tag) ?? null, { today, allSchemes: schemes });
      results.push(toResultRow(code, status, syncRunId));
    }
  }

  // Write only what changed, in one transaction (readers see the old results until the commit). The new results go to
  // a temporary table first; then the rows of dealer/scheme pairs that are gone are deleted, and an upsert writes only
  // the rows whose result changed. A daily run that changes few results then makes few dead rows, instead of
  // replacing the whole table (about 300 MB with the real data). An unchanged row keeps its sync_run_id and
  // computed_at: they tell when the result last changed.
  // Each batch is sent as ONE JSON parameter and expanded in PostgreSQL (much faster than a multi-row VALUES list).
  const written = await db.transaction(async (tx) => {
    await tx.execute(sql`
      CREATE TEMPORARY TABLE engine_result_new (
        dealer_code text NOT NULL, scheme_tag text NOT NULL, participation text NOT NULL, reason_code text,
        current_slab_no int, benefit_blocked boolean NOT NULL, provisional boolean NOT NULL, status jsonb NOT NULL,
        sync_run_id int, PRIMARY KEY (dealer_code, scheme_tag)
      ) ON COMMIT DROP
    `);
    for (let i = 0; i < results.length; i += BATCH) {
      const batch = results.slice(i, i + BATCH).map((r) => ({
        dealer_code: r.dealerCode,
        scheme_tag: r.schemeTag,
        participation: r.participation,
        reason_code: r.reasonCode,
        current_slab_no: r.currentSlabNo,
        benefit_blocked: r.benefitBlocked,
        provisional: r.provisional,
        status: r.status,
        sync_run_id: r.syncRunId,
      }));
      await tx.execute(sql`
        INSERT INTO engine_result_new
          (dealer_code, scheme_tag, participation, reason_code, current_slab_no, benefit_blocked, provisional, status, sync_run_id)
        SELECT dealer_code, scheme_tag, participation, reason_code, current_slab_no, benefit_blocked, provisional, status, sync_run_id
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
          dealer_code text, scheme_tag text, participation text, reason_code text, current_slab_no int,
          benefit_blocked boolean, provisional boolean, status jsonb, sync_run_id int)
      `);
    }
    const removed = await tx.execute(sql`
      DELETE FROM dealer_scheme_result AS r
      WHERE NOT EXISTS (SELECT 1 FROM engine_result_new AS n WHERE n.dealer_code = r.dealer_code AND n.scheme_tag = r.scheme_tag)
    `);
    const upserted = await tx.execute(sql`
      INSERT INTO dealer_scheme_result
        (dealer_code, scheme_tag, participation, reason_code, current_slab_no, benefit_blocked, provisional, status, sync_run_id)
      SELECT dealer_code, scheme_tag, participation, reason_code, current_slab_no, benefit_blocked, provisional, status, sync_run_id
      FROM engine_result_new
      ON CONFLICT (dealer_code, scheme_tag) DO UPDATE SET
        participation = EXCLUDED.participation,
        reason_code = EXCLUDED.reason_code,
        current_slab_no = EXCLUDED.current_slab_no,
        benefit_blocked = EXCLUDED.benefit_blocked,
        provisional = EXCLUDED.provisional,
        status = EXCLUDED.status,
        sync_run_id = EXCLUDED.sync_run_id,
        computed_at = now()
      WHERE (dealer_scheme_result.participation, dealer_scheme_result.reason_code, dealer_scheme_result.current_slab_no,
             dealer_scheme_result.benefit_blocked, dealer_scheme_result.provisional, dealer_scheme_result.status)
        IS DISTINCT FROM
            (EXCLUDED.participation, EXCLUDED.reason_code, EXCLUDED.current_slab_no,
             EXCLUDED.benefit_blocked, EXCLUDED.provisional, EXCLUDED.status)
    `);
    return { changed: Number(upserted.rowCount ?? 0), removed: Number(removed.rowCount ?? 0) };
  });

  // New results are committed: cached API answers of the old results must not be served again.
  await bumpDataVersion();

  return { dealers: codes.size, results: results.length, ...written };
}
