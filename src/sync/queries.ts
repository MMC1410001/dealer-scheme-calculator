/**
 * BigQuery SQL builders for the sync job. Pure functions: no I/O, unit-tested in queries.test.ts.
 *
 * Facts about example-project.Testdb.zsd_sales that these queries handle (checked 16-10-2026, see docs/bigquery-schema.md):
 * - Partitioned by DAY on billing_date. Every query filters on billing_date (partition pruning).
 * - Rows with billing_date NULL sit in the __NULL__ partition (21.7M rows, about 1.8 GB for the columns read here).
 *   It holds only invoice months 2026-03 .. 2026-05 (checked by the review, 16-10-2026). The April 2026 invoices exist
 *   ONLY there (and part of May 2026). For these rows the invoice date is the billing date.
 * - Two query modes, to keep the scan small:
 *   BASE   – the closed Q1 base period only. The only mode that reads the NULL partition
 *            (`billing_date IS NULL AND invoice_date BETWEEN ...`). Runs once (or on `--base`); the rows stay in PostgreSQL.
 *   PERIOD – the scheme period and the return window only (`billing_date BETWEEN @periodFrom AND @windowTo`).
 *            Routine syncs run only this mode (about 75 MB per query instead of about 2.4 GB).
 * - Duplicate loads: the same (inv_no, line_item) appears in several data_month loads (and twice inside the
 *   2026-06-23 load, once with a "932002.0" product code). Deduplicate: keep the latest data_month.
 * - All numeric columns are STRING: SAFE_CAST(... AS NUMERIC).
 * - product_code is NULL for the main June 2026 load and sometimes "932002.0". The code is normalised, then filled
 *   from the product master (test_product.skucode -> baseproduct), then from the first 6 digits of the SKU.
 * - Signed values: returns (ZRET, ...) and cancellations (S1) are already negative in gross_sales_revenue and inv_vol.
 * - Child dealers roll up to the parent (parent_child, latest data_month): dealer = COALESCE(parent, customer_code).
 *
 * GSR = gross_sales_revenue (= DPL − in-bill discount).
 */
import { STAR_CATEGORIES, type SchemeConfig } from "@/engine/types";
import type { QueryParamTypes, QuerySpec } from "./bigquery-client";

export interface TableRef {
  projectId: string;
  dataset: string;
}

/** Date ranges (ISO dates, inclusive) that one metric query covers. */
export interface DateRanges {
  baseFrom: string;
  baseTo: string;
  periodFrom: string;
  periodTo: string;
  /** Return window after the period (returns only). Equal to periodTo when the scheme has no window. */
  windowTo: string;
}

export interface FestiveBonanzaScope {
  /** distribution_channel codes, e.g. ["11","21"]. */
  channels: string[];
  /** Base product codes excluded (zsd_sales.product_code). */
  excludedCodes: string[];
  /** test_product.categoryname values excluded (whole base product). */
  excludedCategories: string[];
  /** test_product.productgrp values excluded (whole base product). */
  excludedGroups: string[];
  /** zsd_sales.billing_type values that are material returns (MRV). */
  returnTypes: string[];
}

export interface GtProductParam {
  code: string;
  /** LUXURY | PREMIUM | ECONOMY | ENAMELS | OTHERS | TOOLS */
  cat: string;
  /** Counts on the restricted channels (Channel 12). */
  ch12: boolean;
}

export interface StarPointsScope {
  /** Channels where every listed product counts (Trade 11, Franchise 21). */
  fullChannels: string[];
  /** Channels where only ch12 products count (Institutional 12). */
  restrictedChannels: string[];
  products: GtProductParam[];
  returnTypes: string[];
}

/** BASE = closed base period only (reads the NULL partition). PERIOD = scheme period + return window only. */
export type MetricQueryMode = "BASE" | "PERIOD";

export interface MetricQueryOptions {
  /** Default PERIOD. */
  mode?: MetricQueryMode;
  /** Restrict to these raw customer codes (validation runs only). */
  dealerCodes?: string[];
}

const IDENT = /^[A-Za-z0-9_-]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fully qualified table name. Project and dataset are validated identifiers, never user values. */
export function table(t: TableRef, name: string): string {
  for (const part of [t.projectId, t.dataset, name]) {
    if (!IDENT.test(part)) throw new Error(`Invalid BigQuery identifier: ${part}`);
  }
  return `\`${t.projectId}.${t.dataset}.${name}\``;
}

/** Last day of a "YYYY-MM" month, as an ISO date. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Date ranges of a scheme: base period, scheme period, return window (last return-window month end). */
export function rangesFromScheme(cfg: SchemeConfig): DateRanges {
  const windowMonths = [...cfg.returnWindowMonths].sort();
  const windowTo = windowMonths.length ? lastDayOfMonth(windowMonths[windowMonths.length - 1]) : cfg.toDate;
  const r: DateRanges = {
    baseFrom: cfg.baseFromDate,
    baseTo: cfg.baseToDate,
    periodFrom: cfg.fromDate,
    periodTo: cfg.toDate,
    windowTo: windowTo < cfg.toDate ? cfg.toDate : windowTo,
  };
  validateRanges(r);
  return r;
}

export function validateRanges(r: DateRanges): void {
  for (const [k, v] of Object.entries(r)) {
    if (!ISO_DATE.test(v)) throw new Error(`Date range ${k} is not an ISO date: ${v}`);
  }
  if (r.baseFrom > r.baseTo) throw new Error("baseFrom is after baseTo");
  if (r.periodFrom > r.periodTo) throw new Error("periodFrom is after periodTo");
  if (r.windowTo < r.periodTo) throw new Error("windowTo is before periodTo");
  if (r.baseTo >= r.periodFrom) throw new Error("The base period must end before the scheme period starts");
}

/** Stable key: schemes with the same key can share one metric query. */
export function rangesKey(r: DateRanges): string {
  return [r.baseFrom, r.baseTo, r.periodFrom, r.periodTo, r.windowTo].join("|");
}

/** Only the date parameters the SQL of a mode uses. */
function rangeParams(r: DateRanges, mode: MetricQueryMode): { params: Record<string, string>; types: Record<string, "DATE"> } {
  return mode === "BASE"
    ? { params: { baseFrom: r.baseFrom, baseTo: r.baseTo }, types: { baseFrom: "DATE", baseTo: "DATE" } }
    : {
        params: { periodFrom: r.periodFrom, periodTo: r.periodTo, windowTo: r.windowTo },
        types: { periodFrom: "DATE", periodTo: "DATE", windowTo: "DATE" },
      };
}

/** Partition filter of a mode. BASE also reads the NULL partition; PERIOD never does. */
function dateFilter(mode: MetricQueryMode): string {
  return mode === "BASE"
    ? `(
      billing_date BETWEEN @baseFrom AND @baseTo
      OR (billing_date IS NULL AND invoice_date BETWEEN @baseFrom AND @baseTo)
    )`
    : "billing_date BETWEEN @periodFrom AND @windowTo";
}

/**
 * Shared CTEs (only the columns needed are read, to keep the scan small): parent-child map, SKU -> base product map, deduplicated sales lines in the date ranges,
 * and `scoped` (one row per line with dealer, month, flags and product code).
 */
function salesCtes(t: TableRef, opts: MetricQueryOptions, withLitres: boolean): string {
  const mode = opts.mode ?? "PERIOD";
  const dealerFilter = opts.dealerCodes?.length ? "\n    AND TRIM(customer_code) IN UNNEST(@dealerCodes)" : "";
  return `pc AS (
  -- Parent-child map, latest monthly load. A child rolls up to its parent.
  SELECT TRIM(child) AS child, ANY_VALUE(TRIM(parent)) AS parent
  FROM ${table(t, "parent_child")}
  WHERE data_month = (SELECT MAX(data_month) FROM ${table(t, "parent_child")})
    AND child IS NOT NULL AND parent IS NOT NULL
  GROUP BY child
),
sku_master AS (
  -- SKU -> base product, used only when zsd_sales.product_code is empty.
  SELECT LTRIM(TRIM(skucode), '0') AS sku, ANY_VALUE(TRIM(baseproduct)) AS baseproduct
  FROM ${table(t, "test_product")}
  WHERE skucode IS NOT NULL AND baseproduct IS NOT NULL
  GROUP BY sku
),
lines AS (
  SELECT
    COALESCE(billing_date, invoice_date) AS bill_date,
    TRIM(customer_code) AS customer_code,
    TRIM(distribution_channel) AS channel,
    TRIM(billing_type) AS billing_type,
    NULLIF(REGEXP_REPLACE(TRIM(product_code), r'\\.0*$', ''), '') AS product_code,
    LTRIM(TRIM(sku_code), '0') AS sku,
    SAFE_CAST(gross_sales_revenue AS NUMERIC) AS gsr${withLitres ? ",\n    SAFE_CAST(inv_vol AS NUMERIC) AS litres" : ""}
  FROM ${table(t, "zsd_sales")}
  WHERE ${dateFilter(mode)}
    AND TRIM(distribution_channel) IN UNNEST(@channels)${dealerFilter}
  -- Duplicate loads: keep one row per invoice line, from the latest data_month (dated partition first on a tie).
  QUALIFY ROW_NUMBER() OVER (PARTITION BY inv_no, line_item ORDER BY data_month DESC, billing_date IS NULL) = 1
),
scoped AS (
  SELECT
    COALESCE(pc.parent, l.customer_code) AS dealer_code,
    FORMAT_DATE('%Y-%m', l.bill_date) AS month,
    l.bill_date,
    ${mode === "BASE" ? "TRUE" : "FALSE"} AS in_base,
    ${mode === "BASE" ? "FALSE" : "l.bill_date BETWEEN @periodFrom AND @periodTo"} AS in_period,
    l.billing_type IN UNNEST(@returnTypes) AS is_return,
    COALESCE(l.product_code, sm.baseproduct, NULLIF(SUBSTR(l.sku, 1, 6), '')) AS product_code,
    -- First 6 digits of the SKU. Star Points Table III codes are partly SKU prefixes (e.g. 517179 Woodcraft PU
    -- Thinner, whose product_code is 953004), so the Star Points query matches this first.
    NULLIF(SUBSTR(l.sku, 1, 6), '') AS sku_prefix,
    l.sku,
    l.channel,
    l.gsr${withLitres ? ",\n    l.litres" : ""}
  FROM lines AS l
  LEFT JOIN pc ON pc.child = l.customer_code
  LEFT JOIN sku_master AS sm ON sm.sku = l.sku
)`;
}

function dealerFilterParams(opts: MetricQueryOptions): { params: Record<string, unknown>; types: Record<string, unknown> } {
  return opts.dealerCodes?.length
    ? { params: { dealerCodes: opts.dealerCodes }, types: { dealerCodes: ["STRING"] } }
    : { params: {}, types: {} };
}

/**
 * Rows that count: base months and period months (all billing types), return-window months (returns only).
 * BASE mode: in_base is TRUE. PERIOD mode: in_base is FALSE.
 */
const COUNTED = "(in_base OR in_period OR is_return)";

export interface FestiveBonanzaMetricRow {
  dealer_code: string;
  month: string;
  /** Signed GSR sum of the scheme products (string, 2 decimals). */
  gsr: string;
  /** Signed GSR sum of ALL products in the query's channels (zero-Q1 rule; Star Points growth). */
  total_gsr: string;
  /** Material returns (negative or zero), period and window months only. */
  mrv: string;
  /** Latest bill date of the period/window lines in this row (null for base months). */
  max_bill_date: string | null;
  line_count: number;
}

/**
 * Festive Bonanza metrics: one row per dealer x month.
 * Scope: channels (Trade 11, Franchise 21) and all products except the exclusions.
 * Exclusion at base-product level: a base product is excluded when ANY of its SKUs in test_product has an excluded
 * categoryname / productgrp (some distemper SKUs have productgrp NULL in the master, e.g. 943010 SUPER BRIGHT).
 * total_gsr = all products in the channels (excluded products too). A row can have gsr 0 and total_gsr non-zero.
 */
export function buildFestiveBonanzaMetricsQuery(
  t: TableRef,
  ranges: DateRanges,
  scope: FestiveBonanzaScope,
  opts: MetricQueryOptions = {},
): QuerySpec {
  validateRanges(ranges);
  if (!scope.channels.length) throw new Error("Festive Bonanza scope has no channels");
  const mode = opts.mode ?? "PERIOD";
  const sql = `WITH
${salesCtes(t, opts, false)},
excluded AS (
  SELECT DISTINCT TRIM(baseproduct) AS product_code
  FROM ${table(t, "test_product")}
  WHERE baseproduct IS NOT NULL
    AND (categoryname IN UNNEST(@excludedCategories) OR productgrp IN UNNEST(@excludedGroups))
  UNION DISTINCT
  SELECT code AS product_code FROM UNNEST(@excludedCodes) AS code
),
counted AS (
  SELECT s.*, x.product_code IS NULL AS in_scope
  FROM scoped AS s
  LEFT JOIN excluded AS x ON x.product_code = s.product_code
  WHERE ${COUNTED}
)
SELECT
  dealer_code,
  month,
  CAST(ROUND(SUM(IF(in_scope, gsr, 0)), 2) AS STRING) AS gsr,
  CAST(ROUND(SUM(gsr), 2) AS STRING) AS total_gsr,
  CAST(ROUND(SUM(IF(in_scope AND is_return AND NOT in_base, gsr, 0)), 2) AS STRING) AS mrv,
  CAST(MAX(IF(in_base, NULL, bill_date)) AS STRING) AS max_bill_date,
  COUNTIF(in_scope) AS line_count
FROM counted
GROUP BY dealer_code, month`;
  const df = dealerFilterParams(opts);
  const rp = rangeParams(ranges, mode);
  return {
    name: `festive_bonanza_${mode.toLowerCase()}`,
    sql,
    params: {
      ...rp.params,
      channels: scope.channels,
      excludedCodes: scope.excludedCodes,
      excludedCategories: scope.excludedCategories,
      excludedGroups: scope.excludedGroups,
      returnTypes: scope.returnTypes,
      ...df.params,
    },
    types: {
      ...rp.types,
      channels: ["STRING"],
      excludedCodes: ["STRING"],
      excludedCategories: ["STRING"],
      excludedGroups: ["STRING"],
      returnTypes: ["STRING"],
      ...df.types,
    } as QueryParamTypes,
  };
}

export type StarPointsMetricRow = FestiveBonanzaMetricRow & {
  tools_gsr: string;
} & Record<`litres_${(typeof STAR_CATEGORIES)[number]}`, string>;

/**
 * Star Points metrics: one row per dealer x month.
 * Scope: only the listed products (Table III + tools). Full channels count every listed product; restricted
 * channels (Channel 12) count only products with ch12 = true.
 * gsr = all listed products incl. tools; litres and tools_gsr only for period and return-window months.
 * Free packs (test_product.paidfree = Free, GSR 0, e.g. "XNSS ... 1L") give no litres for points: the circular counts
 * litres purchased (Mayur, 23-10-2026; the Acme update of 20-10-2026 also leaves them out).
 * total_gsr = ALL products in the scheme channels (Trade, Franchise, Channel 12), listed or not: the Q3-over-Q1
 * growth condition uses it (BA, 19-10-2026).
 */
export function buildStarPointsMetricsQuery(
  t: TableRef,
  ranges: DateRanges,
  scope: StarPointsScope,
  opts: MetricQueryOptions = {},
): QuerySpec {
  validateRanges(ranges);
  if (!scope.fullChannels.length) throw new Error("Star Points scope has no channels");
  if (!scope.products.length) throw new Error("Star Points scope has no products");
  const mode = opts.mode ?? "PERIOD";
  const litres = STAR_CATEGORIES.map(
    (c) => `  CAST(ROUND(SUM(IF(cat = '${c}' AND NOT in_base AND NOT is_free, litres, 0)), 3) AS STRING) AS litres_${c},`,
  ).join("\n");
  const sql = `WITH
${salesCtes(t, opts, true)},
free_skus AS (
  -- Free packs give no points (litres purchased only).
  SELECT DISTINCT LTRIM(TRIM(skucode), '0') AS sku
  FROM ${table(t, "test_product")}
  WHERE skucode IS NOT NULL AND UPPER(TRIM(paidfree)) = 'FREE'
),
sp_products AS (
  SELECT p.code AS product_code, ANY_VALUE(p.cat) AS cat, LOGICAL_OR(p.ch12) AS ch12
  FROM UNNEST(@spProducts) AS p
  GROUP BY p.code
),
matched AS (
  -- Table III match: SKU prefix first, then the base product code (some Table III codes are SKU prefixes).
  SELECT
    s.*,
    COALESCE(gp.cat, gc.cat) IS NOT NULL
      AND (s.channel IN UNNEST(@fullChannels)
        OR (s.channel IN UNNEST(@restrictedChannels) AND IF(gp.product_code IS NOT NULL, gp.ch12, gc.ch12))) AS in_scope,
    COALESCE(gp.cat, gc.cat) AS listed_cat,
    fs.sku IS NOT NULL AS is_free
  FROM scoped AS s
  LEFT JOIN sp_products AS gp ON gp.product_code = s.sku_prefix
  LEFT JOIN sp_products AS gc ON gc.product_code = s.product_code
  LEFT JOIN free_skus AS fs ON fs.sku = s.sku
  WHERE ${COUNTED}
),
counted AS (
  -- cat is NULL for a line that does not count for points (not listed, or not eligible on Channel 12).
  SELECT *, IF(in_scope, listed_cat, NULL) AS cat FROM matched
)
SELECT
  dealer_code,
  month,
  CAST(ROUND(SUM(IF(in_scope, gsr, 0)), 2) AS STRING) AS gsr,
  CAST(ROUND(SUM(gsr), 2) AS STRING) AS total_gsr,
  CAST(ROUND(SUM(IF(in_scope AND is_return AND NOT in_base, gsr, 0)), 2) AS STRING) AS mrv,
  CAST(ROUND(SUM(IF(cat = 'TOOLS' AND NOT in_base, gsr, 0)), 2) AS STRING) AS tools_gsr,
${litres}
  CAST(MAX(IF(in_base, NULL, bill_date)) AS STRING) AS max_bill_date,
  COUNTIF(in_scope) AS line_count
FROM counted
GROUP BY dealer_code, month`;
  const df = dealerFilterParams(opts);
  const channels = [...new Set([...scope.fullChannels, ...scope.restrictedChannels])];
  const rp = rangeParams(ranges, mode);
  return {
    name: `star_points_${mode.toLowerCase()}`,
    sql,
    params: {
      ...rp.params,
      channels,
      fullChannels: scope.fullChannels,
      restrictedChannels: scope.restrictedChannels,
      spProducts: scope.products,
      returnTypes: scope.returnTypes,
      ...df.params,
    },
    types: {
      ...rp.types,
      channels: ["STRING"],
      fullChannels: ["STRING"],
      restrictedChannels: ["STRING"],
      spProducts: [{ code: "STRING", cat: "STRING", ch12: "BOOL" }],
      returnTypes: ["STRING"],
      ...df.types,
    } as QueryParamTypes,
  };
}

export interface DealerMasterRow {
  code: string;
  name: string | null;
  zone: string | null;
  region_code: string | null;
  region_name: string | null;
  territory_name: string | null;
  depot_code: string | null;
  parent_code: string | null;
  master_data_month: string | null;
}

/**
 * Dealer master: customer_attributes (latest data_month) + parent from parent_child (latest data_month).
 * Children in parent_child that are not in customer_attributes are added with only code and parent_code, so that
 * the iframe can resolve them to their parent (289 such children in the 2026-09 load).
 */
export function buildDealerMasterQuery(t: TableRef): QuerySpec {
  const sql = `WITH
ca AS (
  SELECT *
  FROM ${table(t, "customer_attributes")}
  WHERE data_month = (SELECT MAX(data_month) FROM ${table(t, "customer_attributes")})
    AND dealer_code IS NOT NULL
  QUALIFY ROW_NUMBER() OVER (PARTITION BY TRIM(dealer_code) ORDER BY dealer_name) = 1
),
pc AS (
  SELECT TRIM(child) AS child, ANY_VALUE(TRIM(parent)) AS parent
  FROM ${table(t, "parent_child")}
  WHERE data_month = (SELECT MAX(data_month) FROM ${table(t, "parent_child")})
    AND child IS NOT NULL AND parent IS NOT NULL
  GROUP BY child
)
SELECT
  TRIM(ca.dealer_code) AS code,
  NULLIF(TRIM(ca.dealer_name), '') AS name,
  NULLIF(TRIM(ca.zone), '') AS zone,
  NULLIF(REGEXP_REPLACE(TRIM(ca.region_code), r'\\.0*$', ''), '') AS region_code, -- master holds "6.0"
  NULLIF(TRIM(ca.region_name), '') AS region_name,
  NULLIF(TRIM(ca.territory_name), '') AS territory_name,
  NULLIF(REGEXP_REPLACE(TRIM(ca.depot_code), r'\\.0*$', ''), '') AS depot_code,
  pc.parent AS parent_code,
  CAST(ca.data_month AS STRING) AS master_data_month
FROM ca
LEFT JOIN pc ON pc.child = TRIM(ca.dealer_code)
UNION ALL
SELECT
  pc.child AS code,
  CAST(NULL AS STRING) AS name,
  CAST(NULL AS STRING) AS zone,
  CAST(NULL AS STRING) AS region_code,
  CAST(NULL AS STRING) AS region_name,
  CAST(NULL AS STRING) AS territory_name,
  CAST(NULL AS STRING) AS depot_code,
  pc.parent AS parent_code,
  CAST(NULL AS STRING) AS master_data_month
FROM pc
WHERE pc.child NOT IN (SELECT TRIM(dealer_code) FROM ca)`;
  return { name: "dealer_master", sql, params: {}, types: {} };
}

/** INFORMATION_SCHEMA.COLUMNS for the given tables (metadata query, no table scan). */
export function buildInspectSchemaQuery(t: TableRef, tables: string[]): QuerySpec {
  for (const name of tables) table(t, name); // validates identifiers
  const columns = table(t, "INFORMATION_SCHEMA").replace(/`$/, ".COLUMNS`");
  const sql = `SELECT table_name, ordinal_position, column_name, data_type, is_partitioning_column
FROM ${columns}
WHERE table_name IN UNNEST(@tables)
ORDER BY table_name, ordinal_position`;
  return { name: "inspect_schema", sql, params: { tables }, types: { tables: ["STRING"] } };
}
