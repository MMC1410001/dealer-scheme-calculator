/**
 * BigQuery sync job.
 *
 * 1. Read the scheme configuration from PostgreSQL (scheme, scheme_scope_rule, sp_product_category).
 * 2. Build the queries: dealer master, one Festive Bonanza metric query per (dates + scope) group
 *    (FB-PAN and FB-TNHPJK share one query), one Star Points metric query per Star Points scheme.
 *    Routine sync: PERIOD queries only (scheme period + return window, about 75 MB each).
 *    BASE queries (closed Q1 base period, about 2.2 GB each, the only ones that read the NULL partition) run only
 *    with `--base`, or for a scheme that has no base rows from a successful BigQuery sync yet.
 * 3. Dry-run every query, log the bytes, and stop when a query is above its byte limit
 *    (BIGQUERY_MAX_BYTES_BILLED, or BIGQUERY_MAX_BYTES_BILLED_BASE for BASE queries).
 * 4. Run the queries. In one PostgreSQL transaction: upsert dealers, replace the dealer_metric rows of the synced
 *    schemes in the synced months only (a routine sync keeps the stored base months).
 * 5. Run the scheme engine (runEngine) and finish the sync_run.
 *
 * BigQuery is read-only here. Raw sales rows are never copied to PostgreSQL; only per-dealer monthly totals.
 * Do not import "server-only": scripts/sync-bigquery.ts (tsx) imports this module.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dealer, dealerMetric, spProductCategory, schemeScopeRule, syncRun } from "@/db/schema";
import { CHANNELS, RETURN_BILLING_TYPES } from "@/config/schemes";
import type { SchemeConfig } from "@/engine/types";
import { createSyncRun, finishSyncRun } from "@/server/repo";
import { runEngine } from "@/server/run-engine";
import { loadSchemes } from "@/server/scheme-loader";
import { dryRun, formatBytes, getBqConfig, runQuery, type BqConfig, type QuerySpec } from "./bigquery-client";
import {
  buildDealerMasterQuery,
  buildFestiveBonanzaMetricsQuery,
  buildStarPointsMetricsQuery,
  rangesFromScheme,
  rangesKey,
  type DateRanges,
  type DealerMasterRow,
  type FestiveBonanzaMetricRow,
  type FestiveBonanzaScope,
  type StarPointsMetricRow,
  type MetricQueryMode,
  type TableRef,
} from "./queries";
import {
  fbRowsToMetrics,
  fbScopeKey,
  spProductParams,
  spRowsToMetrics,
  maxBillDate,
  scopeFromRules,
  splitGtChannels,
  type MetricInsert,
} from "./transform";

export interface SyncOptions {
  /** Dry-run only: print SQL and bytes. No query runs, nothing is written. */
  dryRun?: boolean;
  /** Print the SQL of each query (default: true in dry-run mode). */
  printSql?: boolean;
  /**
   * Also refresh the closed base period (Q1) for every scheme. Default false: base queries run only for schemes
   * that have no base rows from a successful BigQuery sync yet.
   */
  refreshBase?: boolean;
  log?: (msg: string) => void;
}

export interface PlannedQuery {
  kind: "DEALER_MASTER" | "FESTIVE_BONANZA" | "STAR_POINTS";
  /** BASE / PERIOD for metric queries. Null for the dealer master. */
  mode: MetricQueryMode | null;
  /** Scheme tags that receive the rows of this query. */
  tags: string[];
  /** dealer_metric months (YYYY-MM, inclusive) that the rows of this query replace for `tags`. */
  replaceMonths: { from: string; to: string } | null;
  spec: QuerySpec;
  dryRunBytes?: number;
}

/** Rows to replace in dealer_metric: one scheme tag, months from..to (YYYY-MM, inclusive). */
export interface MetricReplaceScope {
  tag: string;
  fromMonth: string;
  toMonth: string;
}

const LAST_MONTH = "9999-12";

/** dealer_metric months that a query mode writes. */
export function replaceMonthsFor(ranges: DateRanges, mode: MetricQueryMode): { from: string; to: string } {
  return mode === "BASE"
    ? { from: ranges.baseFrom.slice(0, 7), to: ranges.baseTo.slice(0, 7) }
    : { from: ranges.periodFrom.slice(0, 7), to: LAST_MONTH };
}

export interface PlanOptions {
  /** Schemes (tags) that get a BASE query. */
  baseTags: ReadonlySet<string>;
}

export interface SyncResult {
  syncRunId: number | null;
  dryRun: boolean;
  queries: Array<{ name: string; tags: string[]; dryRunBytes: number; bytesProcessed?: number; rows?: number }>;
  totalDryRunBytes: number;
  dealers?: number;
  metricRows?: number;
  dataAsOf?: string | null;
  engine?: { dealers: number; results: number };
}

const DEALER_BATCH = 1000;
const METRIC_BATCH = 2000;

/** Rows that writeSync inserted or updated (changed), and stored metric rows that it deleted (removed). */
export interface WriteSyncResult {
  dealersChanged: number;
  metricsChanged: number;
  metricsRemoved: number;
}

/**
 * Schemes that have base-period rows from a successful BigQuery sync. A routine sync needs these rows; without them
 * the growth condition would read Q1 = 0. Demo rows (source DEMO) do not count.
 * The check looks for `total_gsr` rows (added 19-10-2026): a database synced before that has only `gsr` base rows,
 * so its next sync reads the base period once more.
 */
export async function tagsWithStoredBase(db: Db, schemes: SchemeConfig[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const cfg of schemes) {
    const r = replaceMonthsFor(rangesFromScheme(cfg), "BASE");
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(dealerMetric)
      .innerJoin(syncRun, eq(syncRun.id, dealerMetric.syncRunId))
      .where(
        and(
          eq(dealerMetric.schemeTag, cfg.tag),
          eq(dealerMetric.metric, "total_gsr"),
          gte(dealerMetric.month, r.from),
          lte(dealerMetric.month, r.to),
          eq(syncRun.source, "BIGQUERY"),
          eq(syncRun.status, "SUCCESS"),
        ),
      )
      .limit(1);
    if (row) out.add(cfg.tag);
  }
  return out;
}

/** Build the query plan from the scheme configuration stored in PostgreSQL. */
export async function planSyncQueries(db: Db, t: TableRef, opts: { refreshBase?: boolean } = {}): Promise<PlannedQuery[]> {
  const schemes = await loadSchemes(db);
  if (schemes.length === 0) throw new Error("No active schemes. Run npm run db:seed first.");
  const tags = schemes.map((s) => s.tag);
  const stored = opts.refreshBase ? new Set<string>() : await tagsWithStoredBase(db, schemes);
  const baseTags = new Set(tags.filter((tag) => !stored.has(tag)));
  return buildPlan(db, t, schemes, { baseTags });
}

async function buildPlan(db: Db, t: TableRef, schemes: SchemeConfig[], opts: PlanOptions): Promise<PlannedQuery[]> {
  const tags = schemes.map((s) => s.tag);

  const ruleRows = await db.select().from(schemeScopeRule).where(inArray(schemeScopeRule.schemeTag, tags));
  const rulesByTag = new Map<string, typeof ruleRows>();
  for (const r of ruleRows) {
    const list = rulesByTag.get(r.schemeTag) ?? [];
    list.push(r);
    rulesByTag.set(r.schemeTag, list);
  }

  const plan: PlannedQuery[] = [
    { kind: "DEALER_MASTER", mode: null, tags: [], replaceMonths: null, spec: buildDealerMasterQuery(t) },
  ];
  /** PERIOD always; BASE only when one of the tags needs it. */
  const modesFor = (groupTags: string[]): MetricQueryMode[] =>
    groupTags.some((tag) => opts.baseTags.has(tag)) ? ["BASE", "PERIOD"] : ["PERIOD"];

  // Festive Bonanza: group schemes with the same dates and scope into one query.
  const fbGroups = new Map<string, { cfg: SchemeConfig; scope: FestiveBonanzaScope; tags: string[] }>();
  for (const cfg of schemes.filter((s) => s.type === "FESTIVE_BONANZA")) {
    const scope = scopeFromRules(rulesByTag.get(cfg.tag) ?? []);
    if (scope.unsupported.length) {
      throw new Error(
        `Scheme ${cfg.tag}: ${scope.unsupported.length} scope rule(s) use columns the sync does not support yet ` +
          `(zone/area/depot/SKU/combined columns). First rule: ${JSON.stringify(scope.unsupported[0])}`,
      );
    }
    if (!scope.channels.length) throw new Error(`Scheme ${cfg.tag}: no INCLUDE channel rule in scheme_scope_rule.`);
    const fbScope: FestiveBonanzaScope = {
      channels: scope.channels,
      excludedCodes: scope.excludedCodes,
      excludedCategories: scope.excludedCategories,
      excludedGroups: scope.excludedGroups,
      returnTypes: [...RETURN_BILLING_TYPES],
    };
    const key = `${rangesKey(rangesFromScheme(cfg))}#${fbScopeKey(fbScope)}`;
    const g = fbGroups.get(key);
    if (g) g.tags.push(cfg.tag);
    else fbGroups.set(key, { cfg, scope: fbScope, tags: [cfg.tag] });
  }
  for (const g of fbGroups.values()) {
    const ranges = rangesFromScheme(g.cfg);
    for (const mode of modesFor(g.tags)) {
      plan.push({
        kind: "FESTIVE_BONANZA",
        mode,
        tags: g.tags,
        replaceMonths: replaceMonthsFor(ranges, mode),
        spec: buildFestiveBonanzaMetricsQuery(t, ranges, g.scope, { mode }),
      });
    }
  }

  // Star Points: one query per scheme (product list per scheme).
  for (const cfg of schemes.filter((s) => s.type === "STAR_POINTS")) {
    const scope = scopeFromRules(rulesByTag.get(cfg.tag) ?? []);
    if (scope.unsupported.length || scope.excludedCodes.length || scope.excludedCategories.length || scope.excludedGroups.length) {
      throw new Error(`Scheme ${cfg.tag}: Star Points supports only channel and region scope rules in phase 1.`);
    }
    if (!scope.channels.length) throw new Error(`Scheme ${cfg.tag}: no INCLUDE channel rule in scheme_scope_rule.`);
    const productRows = await db
      .select({
        productCode: spProductCategory.productCode,
        starCategory: spProductCategory.starCategory,
        channel12Eligible: spProductCategory.channel12Eligible,
      })
      .from(spProductCategory)
      .where(inArray(spProductCategory.schemeTag, [cfg.tag]));
    const products = spProductParams(productRows);
    if (!products.length) throw new Error(`Scheme ${cfg.tag}: sp_product_category is empty. Run npm run db:seed first.`);
    const { fullChannels, restrictedChannels } = splitGtChannels(scope.channels, [CHANNELS.INSTITUTIONAL]);
    const ranges = rangesFromScheme(cfg);
    const spScope = { fullChannels, restrictedChannels, products, returnTypes: [...RETURN_BILLING_TYPES] };
    for (const mode of modesFor([cfg.tag])) {
      plan.push({
        kind: "STAR_POINTS",
        mode,
        tags: [cfg.tag],
        replaceMonths: replaceMonthsFor(ranges, mode),
        spec: buildStarPointsMetricsQuery(t, ranges, spScope, { mode }),
      });
    }
  }
  return plan;
}

/** BigQuery config of one planned query: BASE queries use the base byte limit. */
export function queryConfig(q: Pick<PlannedQuery, "mode">, cfg: BqConfig): BqConfig {
  return q.mode === "BASE" ? { ...cfg, maxBytesBilled: cfg.maxBytesBilledBase } : cfg;
}

/** Dry-run every planned query. Throws when one is above its byte limit. */
export async function dryRunPlan(plan: PlannedQuery[], cfg: BqConfig, log: (m: string) => void): Promise<number> {
  let total = 0;
  for (const q of plan) {
    const qcfg = queryConfig(q, cfg);
    const { bytes } = await dryRun(q.spec, qcfg);
    q.dryRunBytes = bytes;
    total += bytes;
    log(`dry run  ${q.spec.name.padEnd(24)} ${q.tags.join(",").padEnd(10)} ${formatBytes(bytes)}`);
    if (bytes > qcfg.maxBytesBilled) {
      const env = q.mode === "BASE" ? "BIGQUERY_MAX_BYTES_BILLED_BASE" : "BIGQUERY_MAX_BYTES_BILLED";
      throw new Error(
        `Query ${q.spec.name} would scan ${formatBytes(bytes)}, above ${env} (${formatBytes(qcfg.maxBytesBilled)}). Sync stopped.`,
      );
    }
  }
  log(`dry run  total ${formatBytes(total)}`);
  return total;
}

function dealerInsert(r: DealerMasterRow): typeof dealer.$inferInsert {
  return {
    code: r.code,
    name: r.name,
    zone: r.zone,
    regionCode: r.region_code,
    regionName: r.region_name,
    territoryName: r.territory_name,
    depotCode: r.depot_code,
    parentCode: r.parent_code,
  };
}

/** Replace scopes of the metric queries in a plan (one entry per tag and query). */
export function replaceScopesOf(plan: PlannedQuery[]): MetricReplaceScope[] {
  return plan.flatMap((q) =>
    q.replaceMonths ? q.tags.map((tag) => ({ tag, fromMonth: q.replaceMonths!.from, toMonth: q.replaceMonths!.to })) : [],
  );
}

/**
 * Write dealers and metrics in one transaction, and write only what changed (unchanged re-sends make no dead rows):
 * - dealer: upsert on the code; a row is updated only when one of its master values differs.
 * - dealer_metric: the new rows go to a temporary table first. For each replace scope (tag and months), the stored
 *   rows that the new data no longer has are deleted, so a routine sync keeps the base months. Then an upsert writes
 *   only the rows whose value differs. An unchanged row keeps its sync_run_id (the run that last changed it).
 * Demo test rows (DEMO%) are left alone. Exported for tests.
 */
export async function writeSync(db: Db, dealers: DealerMasterRow[], metrics: MetricInsert[], replace: MetricReplaceScope[]): Promise<WriteSyncResult> {
  return db.transaction(async (tx) => {
    let dealersChanged = 0;
    for (let i = 0; i < dealers.length; i += DEALER_BATCH) {
      const r = await tx
        .insert(dealer)
        .values(dealers.slice(i, i + DEALER_BATCH).map(dealerInsert))
        .onConflictDoUpdate({
          target: dealer.code,
          set: {
            name: sql`excluded.name`,
            zone: sql`excluded.zone`,
            regionCode: sql`excluded.region_code`,
            regionName: sql`excluded.region_name`,
            territoryName: sql`excluded.territory_name`,
            depotCode: sql`excluded.depot_code`,
            parentCode: sql`excluded.parent_code`,
            updatedAt: sql`now()`,
          },
          setWhere: sql`(${dealer.name}, ${dealer.zone}, ${dealer.regionCode}, ${dealer.regionName}, ${dealer.territoryName}, ${dealer.depotCode}, ${dealer.parentCode})
            IS DISTINCT FROM (excluded.name, excluded.zone, excluded.region_code, excluded.region_name, excluded.territory_name, excluded.depot_code, excluded.parent_code)`,
        });
      dealersChanged += Number(r.rowCount ?? 0);
    }

    await tx.execute(sql`
      CREATE TEMPORARY TABLE sync_metric_new (
        dealer_code text NOT NULL, scheme_tag text NOT NULL, metric text NOT NULL, month text NOT NULL,
        value numeric(18, 3) NOT NULL, sync_run_id int, PRIMARY KEY (dealer_code, scheme_tag, metric, month)
      ) ON COMMIT DROP
    `);
    for (let i = 0; i < metrics.length; i += METRIC_BATCH) {
      // One JSON parameter for each batch, expanded in PostgreSQL (also keeps far below the 65,535 parameter limit).
      const batch = metrics.slice(i, i + METRIC_BATCH).map((m) => ({
        dealer_code: m.dealerCode,
        scheme_tag: m.schemeTag,
        metric: m.metric,
        month: m.month,
        value: m.value,
        sync_run_id: m.syncRunId,
      }));
      await tx.execute(sql`
        INSERT INTO sync_metric_new (dealer_code, scheme_tag, metric, month, value, sync_run_id)
        SELECT dealer_code, scheme_tag, metric, month, value::numeric(18, 3), sync_run_id
        FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
          dealer_code text, scheme_tag text, metric text, month text, value text, sync_run_id int)
      `);
    }

    let metricsRemoved = 0;
    for (const r of replace) {
      const del = await tx.execute(sql`
        DELETE FROM dealer_metric AS dm
        WHERE dm.scheme_tag = ${r.tag} AND dm.month >= ${r.fromMonth} AND dm.month <= ${r.toMonth}
          AND dm.dealer_code NOT LIKE 'DEMO%'
          AND NOT EXISTS (
            SELECT 1 FROM sync_metric_new AS n
            WHERE n.dealer_code = dm.dealer_code AND n.scheme_tag = dm.scheme_tag AND n.metric = dm.metric AND n.month = dm.month
          )
      `);
      metricsRemoved += Number(del.rowCount ?? 0);
    }
    const up = await tx.execute(sql`
      INSERT INTO dealer_metric (dealer_code, scheme_tag, metric, month, value, sync_run_id)
      SELECT dealer_code, scheme_tag, metric, month, value, sync_run_id FROM sync_metric_new
      ON CONFLICT (dealer_code, scheme_tag, metric, month) DO UPDATE SET value = EXCLUDED.value, sync_run_id = EXCLUDED.sync_run_id
      WHERE dealer_metric.value IS DISTINCT FROM EXCLUDED.value
    `);
    return { dealersChanged, metricsChanged: Number(up.rowCount ?? 0), metricsRemoved };
  });
}

export async function runBigQuerySync(db: Db, opts: SyncOptions = {}): Promise<SyncResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const cfg = getBqConfig();
  const t: TableRef = { projectId: cfg.projectId, dataset: cfg.dataset };
  const plan = await planSyncQueries(db, t, { refreshBase: opts.refreshBase });
  const baseQueries = plan.filter((q) => q.mode === "BASE");
  log(
    baseQueries.length
      ? `plan     base period queries for ${[...new Set(baseQueries.flatMap((q) => q.tags))].join(",")} (reads the NULL partition)`
      : "plan     routine: scheme period only (stored base period kept)",
  );

  if (opts.dryRun) {
    if (opts.printSql ?? true) {
      for (const q of plan) {
        log(`\n-- ${q.spec.name} (tags: ${q.tags.join(",") || "-"})\n-- params: ${JSON.stringify(summariseParams(q.spec.params))}\n${q.spec.sql}\n`);
      }
    }
    const total = await dryRunPlan(plan, cfg, log);
    return {
      syncRunId: null,
      dryRun: true,
      totalDryRunBytes: total,
      queries: plan.map((q) => ({ name: q.spec.name, tags: q.tags, dryRunBytes: q.dryRunBytes ?? 0 })),
    };
  }

  const syncRunId = await createSyncRun(db, "BIGQUERY");
  const result: SyncResult = { syncRunId, dryRun: false, queries: [], totalDryRunBytes: 0 };
  let bytesProcessed = 0;
  try {
    result.totalDryRunBytes = await dryRunPlan(plan, cfg, log);

    let dealers: DealerMasterRow[] = [];
    const metrics: MetricInsert[] = [];
    const periodDates: Array<{ max_bill_date: string | null }> = [];

    for (const q of plan) {
      const started = Date.now();
      const res =
        q.kind === "DEALER_MASTER"
          ? await runQuery<DealerMasterRow>(q.spec, queryConfig(q, cfg))
          : q.kind === "FESTIVE_BONANZA"
            ? await runQuery<FestiveBonanzaMetricRow>(q.spec, queryConfig(q, cfg))
            : await runQuery<StarPointsMetricRow>(q.spec, queryConfig(q, cfg));
      bytesProcessed += res.bytesProcessed;
      log(
        `query    ${q.spec.name.padEnd(24)} ${q.tags.join(",").padEnd(10)} rows=${res.rows.length} ` +
          `scanned=${formatBytes(res.bytesProcessed)} ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      result.queries.push({
        name: q.spec.name,
        tags: q.tags,
        dryRunBytes: q.dryRunBytes ?? 0,
        bytesProcessed: res.bytesProcessed,
        rows: res.rows.length,
      });
      if (q.kind === "DEALER_MASTER") {
        dealers = (res.rows as DealerMasterRow[]).filter((r) => r.code);
      } else if (q.kind === "FESTIVE_BONANZA") {
        const rows = res.rows as FestiveBonanzaMetricRow[];
        appendAll(metrics, fbRowsToMetrics(rows, q.tags, syncRunId));
        appendAll(periodDates, rows);
      } else {
        const rows = res.rows as StarPointsMetricRow[];
        appendAll(metrics, spRowsToMetrics(rows, q.tags[0], syncRunId));
        appendAll(periodDates, rows);
      }
    }

    const syncedTags = [...new Set(plan.filter((q) => q.kind !== "DEALER_MASTER").flatMap((q) => q.tags))];
    const written = await writeSync(db, dealers, metrics, replaceScopesOf(plan));
    const dataAsOf = maxBillDate(periodDates);
    log(
      `write    dealers=${dealers.length} (changed ${written.dealersChanged}) metric_rows=${metrics.length} ` +
        `(changed ${written.metricsChanged}, removed ${written.metricsRemoved}) tags=${syncedTags.join(",")} data_as_of=${dataAsOf ?? "-"}`,
    );

    const engine = await runEngine(db, { syncRunId });
    log(`engine   dealers=${engine.dealers} results=${engine.results} (changed ${engine.changed}, removed ${engine.removed})`);

    await finishSyncRun(db, syncRunId, {
      status: "SUCCESS",
      dataAsOf: dataAsOf ? `${dataAsOf}T00:00:00+05:30` : null,
      rowCount: metrics.length,
      bytesProcessed,
      message: `dealers=${dealers.length}; metric_rows=${metrics.length}; tags=${syncedTags.join(",")}; engine_results=${engine.results}`,
    });
    return { ...result, dealers: dealers.length, metricRows: metrics.length, dataAsOf, engine };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishSyncRun(db, syncRunId, { status: "FAILED", bytesProcessed, message: message.slice(0, 2000) }).catch(() => undefined);
    throw err;
  }
}

/** Append without spread: push(...arr) overflows the call stack for large result sets (100k+ rows). */
function appendAll<T>(target: T[], items: readonly T[]): void {
  for (const item of items) target.push(item);
}

/** Short parameter summary for logs (long arrays are counted, not printed). */
export function summariseParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = Array.isArray(v) && v.length > 12 ? `[${v.length} items]` : v;
  return out;
}
