/**
 * Pure transforms for the sync job: scheme configuration -> query scope, BigQuery rows -> dealer_metric rows.
 * No I/O. Unit-tested in transform.test.ts.
 */
import { STAR_CATEGORIES } from "@/engine/types";
import type { FestiveBonanzaMetricRow, StarPointsMetricRow, FestiveBonanzaScope, GtProductParam } from "./queries";

/* ------------------------------------------------------------------ */
/* Scope from scheme_scope_rule rows                                    */
/* ------------------------------------------------------------------ */

export interface ScopeRuleLike {
  ruleType: string;
  channel: string | null;
  zone: string | null;
  region: string | null;
  area: string | null;
  depot: string | null;
  productCode: string | null;
  skuCode: string | null;
  productCategory: string | null;
  productGroup: string | null;
}

export interface SalesScope {
  channels: string[];
  excludedCodes: string[];
  excludedCategories: string[];
  excludedGroups: string[];
  /** Rules the sync query cannot apply yet (phase 1). The caller must stop on these. */
  unsupported: ScopeRuleLike[];
}

const filled = (v: string | null | undefined): v is string => v !== null && v !== undefined && v.trim() !== "";

/**
 * Turn scope rules (template v3.0 shape) into the sales query scope.
 * - INCLUDE row with only `channel` -> channel in scope.
 * - Row with only `region` -> region scope; the engine applies it (ignored here).
 * - EXCLUDE row with only one of productCode / productCategory / productGroup -> exclusion.
 * - Anything else (zone, area, depot, SKU, combined columns, product INCLUDE rows) -> unsupported.
 */
export function scopeFromRules(rules: ScopeRuleLike[]): SalesScope {
  const out: SalesScope = { channels: [], excludedCodes: [], excludedCategories: [], excludedGroups: [], unsupported: [] };
  for (const r of rules) {
    const cols = (
      ["channel", "zone", "region", "area", "depot", "productCode", "skuCode", "productCategory", "productGroup"] as const
    ).filter((k) => filled(r[k]));
    const only = (k: (typeof cols)[number]) => cols.length === 1 && cols[0] === k;
    const type = r.ruleType.toUpperCase();
    if (type === "INCLUDE" && only("channel")) out.channels.push(r.channel!.trim());
    else if (only("region")) continue;
    else if (type === "EXCLUDE" && only("productCode")) out.excludedCodes.push(r.productCode!.trim());
    else if (type === "EXCLUDE" && only("productCategory")) out.excludedCategories.push(r.productCategory!.trim());
    else if (type === "EXCLUDE" && only("productGroup")) out.excludedGroups.push(r.productGroup!.trim());
    else out.unsupported.push(r);
  }
  const uniq = (a: string[]) => [...new Set(a)].sort();
  return {
    channels: uniq(out.channels),
    excludedCodes: uniq(out.excludedCodes),
    excludedCategories: uniq(out.excludedCategories),
    excludedGroups: uniq(out.excludedGroups),
    unsupported: out.unsupported,
  };
}

/** Signature of a Festive Bonanza scope: schemes with the same signature and dates share one query. */
export function fbScopeKey(s: FestiveBonanzaScope): string {
  return JSON.stringify([s.channels, s.excludedCodes, s.excludedCategories, s.excludedGroups, s.returnTypes]);
}

export interface GtProductLike {
  productCode: string;
  starCategory: string;
  channel12Eligible: boolean;
}

/** sp_product_category rows -> query parameter (one entry per code). */
export function spProductParams(rows: GtProductLike[]): GtProductParam[] {
  const byCode = new Map<string, GtProductParam>();
  for (const r of rows) {
    const code = r.productCode.trim();
    if (!byCode.has(code)) byCode.set(code, { code, cat: r.starCategory.toUpperCase(), ch12: r.channel12Eligible });
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** Split scheme channels into full channels and restricted (Channel 12: only ch12 products). */
export function splitGtChannels(channels: string[], restricted: string[]): { fullChannels: string[]; restrictedChannels: string[] } {
  const r = new Set(restricted);
  return {
    fullChannels: channels.filter((c) => !r.has(c)),
    restrictedChannels: channels.filter((c) => r.has(c)),
  };
}

/* ------------------------------------------------------------------ */
/* BigQuery rows -> dealer_metric rows                                  */
/* ------------------------------------------------------------------ */

export interface MetricInsert {
  dealerCode: string;
  schemeTag: string;
  metric: string;
  month: string;
  /** Decimal string (dealer_metric.value is numeric). */
  value: string;
  syncRunId: number | null;
}

const MONTH = /^\d{4}-\d{2}$/;

function isZero(v: string | null | undefined): boolean {
  if (v === null || v === undefined || v === "") return true;
  const n = Number(v);
  return !Number.isFinite(n) || n === 0;
}

function push(out: MetricInsert[], base: Omit<MetricInsert, "metric" | "value">, metric: string, value: string | null | undefined) {
  if (isZero(value)) return;
  out.push({ ...base, metric, value: String(value) });
}

/**
 * Festive Bonanza rows -> metric rows for each tag (FB-PAN and FB-TNHPJK share the same metric query).
 * Zero values are skipped (the engine reads a missing value as 0).
 */
export function fbRowsToMetrics(rows: FestiveBonanzaMetricRow[], tags: string[], syncRunId: number | null): MetricInsert[] {
  const out: MetricInsert[] = [];
  for (const r of rows) {
    if (!r.dealer_code || !MONTH.test(r.month)) continue;
    for (const schemeTag of tags) {
      const base = { dealerCode: r.dealer_code, schemeTag, month: r.month, syncRunId };
      push(out, base, "gsr", r.gsr);
      push(out, base, "total_gsr", r.total_gsr);
      push(out, base, "mrv", r.mrv);
    }
  }
  return out;
}

/** Star Points rows -> metric rows (gsr, total_gsr, mrv, tools_gsr, litres_<CATEGORY>). */
export function spRowsToMetrics(rows: StarPointsMetricRow[], tag: string, syncRunId: number | null): MetricInsert[] {
  const out: MetricInsert[] = [];
  for (const r of rows) {
    if (!r.dealer_code || !MONTH.test(r.month)) continue;
    const base = { dealerCode: r.dealer_code, schemeTag: tag, month: r.month, syncRunId };
    push(out, base, "gsr", r.gsr);
    push(out, base, "total_gsr", r.total_gsr);
    push(out, base, "mrv", r.mrv);
    push(out, base, "tools_gsr", r.tools_gsr);
    for (const c of STAR_CATEGORIES) push(out, base, `litres_${c}`, r[`litres_${c}`]);
  }
  return out;
}

/** Latest bill date in the period / window rows (YYYY-MM-DD), or null. */
export function maxBillDate(rows: Array<{ max_bill_date: string | null }>): string | null {
  let max: string | null = null;
  for (const r of rows) if (r.max_bill_date && (max === null || r.max_bill_date > max)) max = r.max_bill_date;
  return max;
}
