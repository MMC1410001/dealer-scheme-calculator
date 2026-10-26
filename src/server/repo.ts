/**
 * Server data layer: reads stored results for the iframe and the admin report, and sync-run bookkeeping.
 * The pages read stored results only. No engine run and no BigQuery query on a page request.
 *
 * "server-only" is not imported: it is not installed as a package, and the sync script (tsx) imports
 * createSyncRun / finishSyncRun from this module.
 */
import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { dealer, dealerRewardChoice, dealerSchemeResult, scheme, schemeSlab, syncRun } from "@/db/schema";
import { buildDealerStatus } from "@/engine";
import type { RewardChoice, SchemeStatus } from "@/engine/types";
import { toRewardChoice } from "@/server/reward-choice";
import type {
  AdminReport,
  DealerListPage,
  DealerListStatus,
  DealerStatus,
  ReasonCount,
  SchemeReport,
  SlabReportRow,
  SyncRunSummary,
} from "@/server/types";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** ISO 8601 with the India offset, e.g. 2026-10-16T05:30:00+05:30 (as in docs/api-contract.md). */
export function toIstIso(d: Date | string | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  const ist = new Date(date.getTime() + 330 * 60_000);
  return ist.toISOString().replace(/\.\d{3}Z$/, "+05:30");
}

/** Report labels for reason codes. Fallback: the code itself. */
export const REASON_LABELS: Record<string, string> = {
  REGION_NOT_IN_SCOPE: "Dealer region is not in the scope of this scheme",
  REGION_UNKNOWN: "Region unknown (dealer not in the dealer master or no region value)",
  ENROLLED_IN_OTHER_SCHEME: "Dealer is enrolled in another scheme",
  NO_DATA: "No sales data for this scheme",
  SLAB1_PERIOD_GSR_NOT_MET: "Slab 1 period GSR not met",
  SLAB1_MIN_FIRST_MONTH_GSR_NOT_MET: "Slab 1 minimum first-month GSR not met",
  SLAB1_GROWTH_NOT_MET: "Slab 1 growth not met",
  SLAB1_POINTS_NOT_MET: "Slab 1 points not met",
  OD_ON_CHECK_DATE: "Overdue on the check date",
  UNSPECIFIED: "Reason not given",
};

const reasonLabel = (code: string): string => REASON_LABELS[code] ?? code;

function noDataStatus(tag: string): SchemeStatus {
  return {
    scheme_tag: tag,
    participation: "NOT_IN_SCOPE",
    reason_code: "NO_DATA",
    reason: "No result for this dealer in this scheme yet.",
  };
}

async function latestSuccessDataAsOf(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ dataAsOf: syncRun.dataAsOf })
    .from(syncRun)
    .where(eq(syncRun.status, "SUCCESS"))
    // Prefer real (non-DEMO) runs, so that a local demo load does not change the real dealers' "data as of".
    .orderBy(sql`(${syncRun.source} = 'DEMO')`, desc(syncRun.id))
    .limit(1);
  return row?.dataAsOf ?? null;
}

function toSyncRunSummary(r: typeof syncRun.$inferSelect): SyncRunSummary {
  return {
    id: r.id,
    source: r.source as SyncRunSummary["source"],
    status: r.status as SyncRunSummary["status"],
    startedAt: toIstIso(r.startedAt) ?? "",
    finishedAt: toIstIso(r.finishedAt),
    dataAsOf: toIstIso(r.dataAsOf),
    rowCount: r.rowCount ?? null,
    bytesProcessed: r.bytesProcessed === null ? null : Number(r.bytesProcessed),
    message: r.message ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Dealer status (iframe)                                               */
/* ------------------------------------------------------------------ */

/**
 * Stored scheme status of a dealer. A child dealer sees the parent's result (sales roll up to the parent).
 * Returns null when the code is in neither the dealer table nor the results.
 */
export async function getDealerStatus(dealerCode: string, schemeTags?: string[]): Promise<DealerStatus | null> {
  const db = getDb();
  const code = dealerCode.trim();
  if (!code) return null;

  const [self] = await db
    .select({ code: dealer.code, name: dealer.name, parentCode: dealer.parentCode })
    .from(dealer)
    .where(eq(dealer.code, code))
    .limit(1);

  let resolvedCode = code;
  let resolvedName: string | null = self?.name ?? null;
  if (self?.parentCode && self.parentCode !== code) {
    resolvedCode = self.parentCode;
    const [parent] = await db
      .select({ name: dealer.name })
      .from(dealer)
      .where(eq(dealer.code, resolvedCode))
      .limit(1);
    resolvedName = parent?.name ?? null;
  }

  const activeTags = (
    await db.select({ tag: scheme.tag }).from(scheme).where(eq(scheme.active, true)).orderBy(asc(scheme.tag))
  ).map((r) => r.tag);
  const tags = schemeTags && schemeTags.length ? schemeTags.filter((t) => activeTags.includes(t)) : activeTags;

  const rows = tags.length
    ? await db
        .select({ schemeTag: dealerSchemeResult.schemeTag, status: dealerSchemeResult.status })
        .from(dealerSchemeResult)
        .where(and(eq(dealerSchemeResult.dealerCode, resolvedCode), inArray(dealerSchemeResult.schemeTag, tags)))
    : [];

  if (!self && rows.length === 0) {
    // Unknown in the dealer master. The dealer may still have results under other tags.
    const [any] = await db
      .select({ c: dealerSchemeResult.dealerCode })
      .from(dealerSchemeResult)
      .where(eq(dealerSchemeResult.dealerCode, code))
      .limit(1);
    if (!any) return null;
  }

  const byTag = new Map(rows.map((r) => [r.schemeTag, r.status as SchemeStatus]));
  const choices = await loadRewardChoices(db, resolvedCode, rows.map((r) => r.schemeTag));
  // reward_choice: IN_SCHEME only, null when not chosen (docs/api-contract.md).
  const statuses = tags.map((t) => {
    const s = byTag.get(t);
    if (!s) return noDataStatus(t);
    return s.participation === "IN_SCHEME" ? { ...s, reward_choice: choices.get(t) ?? null } : s;
  });
  const dataAsOf = toIstIso(await latestSuccessDataAsOf(db));
  return buildDealerStatus(resolvedCode, resolvedName, dataAsOf, statuses);
}

/** Stored reward choices of one dealer (resolved code) for these schemes, by scheme tag. */
export async function loadRewardChoices(db: Db, dealerCode: string, schemeTags: string[]): Promise<Map<string, RewardChoice>> {
  if (schemeTags.length === 0) return new Map();
  const rows = await db
    .select()
    .from(dealerRewardChoice)
    .where(and(eq(dealerRewardChoice.dealerCode, dealerCode), inArray(dealerRewardChoice.schemeTag, schemeTags)));
  return new Map(rows.map((r) => [r.schemeTag, toRewardChoice({ ...r, updatedAt: toIstIso(r.updatedAt) ?? "" })]));
}

/** Tags of the active schemes (the dealer status API checks the requested tags against this list). */
export async function listActiveSchemeTags(): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ tag: scheme.tag }).from(scheme).where(eq(scheme.active, true)).orderBy(asc(scheme.tag));
  return rows.map((r) => r.tag);
}

/** "Data as of" of the stored results (latest successful sync run), as IST ISO 8601. Null when no run exists. */
export async function getDataAsOf(): Promise<string | null> {
  return toIstIso(await latestSuccessDataAsOf(getDb()));
}

/* ------------------------------------------------------------------ */
/* Admin report                                                         */
/* ------------------------------------------------------------------ */

export async function getAdminReport(): Promise<AdminReport> {
  const db = getDb();

  const schemes = await db
    .select({ tag: scheme.tag, name: scheme.name, type: scheme.type, fromDate: scheme.fromDate, toDate: scheme.toDate })
    .from(scheme)
    .where(eq(scheme.active, true))
    .orderBy(asc(scheme.tag));

  const slabs = await db.select().from(schemeSlab).orderBy(asc(schemeSlab.schemeTag), asc(schemeSlab.slabNo));

  // Participation and reasons: one aggregate.
  const reasonAgg = await db.execute<{ scheme_tag: string; participation: string; in_slab: boolean; reason_code: string; n: number }>(sql`
    SELECT scheme_tag, participation, (current_slab_no IS NOT NULL) AS in_slab,
           COALESCE(reason_code, 'UNSPECIFIED') AS reason_code, COUNT(*)::int AS n
    FROM dealer_scheme_result
    GROUP BY scheme_tag, participation, (current_slab_no IS NOT NULL), COALESCE(reason_code, 'UNSPECIFIED')
  `);

  // Slab counts with reward choice split and OD block.
  const slabAgg = await db.execute<{
    scheme_tag: string;
    slab_no: number;
    dealers: number;
    gift: number;
    cn: number;
    not_chosen: number;
    cruise: number;
    overseas: number;
    blocked: number;
  }>(sql`
    SELECT r.scheme_tag, r.current_slab_no AS slab_no,
           COUNT(*)::int AS dealers,
           COUNT(*) FILTER (WHERE c.choice = 'GIFT')::int AS gift,
           COUNT(*) FILTER (WHERE c.choice = 'CN')::int AS cn,
           COUNT(*) FILTER (WHERE c.choice IS NULL OR c.choice NOT IN ('GIFT', 'CN'))::int AS not_chosen,
           COUNT(*) FILTER (WHERE c.destination = 'CRUISE')::int AS cruise,
           COUNT(*) FILTER (WHERE c.destination = 'OVERSEAS')::int AS overseas,
           COUNT(*) FILTER (WHERE r.benefit_blocked)::int AS blocked
    FROM dealer_scheme_result r
    LEFT JOIN dealer_reward_choice c ON c.dealer_code = r.dealer_code AND c.scheme_tag = r.scheme_tag
    WHERE r.participation = 'IN_SCHEME' AND r.current_slab_no IS NOT NULL
    GROUP BY r.scheme_tag, r.current_slab_no
  `);

  const out: SchemeReport[] = schemes.map((s) => {
    const rs = reasonAgg.rows.filter((r) => r.scheme_tag === s.tag);
    const inScope = rs.filter((r) => r.participation === "IN_SCHEME").reduce((a, r) => a + Number(r.n), 0);

    const group = (filter: (r: (typeof rs)[number]) => boolean): ReasonCount[] => {
      const m = new Map<string, number>();
      for (const r of rs.filter(filter)) m.set(r.reason_code, (m.get(r.reason_code) ?? 0) + Number(r.n));
      return [...m.entries()]
        .map(([reasonCode, count]) => ({ reasonCode, reason: reasonLabel(reasonCode), count }))
        .sort((a, b) => b.count - a.count);
    };

    const slabRows: SlabReportRow[] = slabs
      .filter((sl) => sl.schemeTag === s.tag)
      .map((sl) => {
        const a = slabAgg.rows.find((r) => r.scheme_tag === s.tag && Number(r.slab_no) === sl.slabNo);
        return {
          slabNo: sl.slabNo,
          label: sl.label,
          dealers: Number(a?.dealers ?? 0),
          gift: Number(a?.gift ?? 0),
          cn: Number(a?.cn ?? 0),
          notChosen: Number(a?.not_chosen ?? 0),
          destinationCruise: Number(a?.cruise ?? 0),
          destinationOverseas: Number(a?.overseas ?? 0),
          benefitBlocked: Number(a?.blocked ?? 0),
          periodGsrRequired: sl.periodGsrRequired === null ? null : Number(sl.periodGsrRequired),
          minFirstMonthGsr: sl.minFirstMonthGsr === null ? null : Number(sl.minFirstMonthGsr),
          growthPct: sl.growthPct === null ? null : Number(sl.growthPct),
          pointsRequired: sl.pointsRequired === null ? null : Number(sl.pointsRequired),
          giftDescription: sl.giftDescription,
          giftValue: sl.giftValue === null ? null : Number(sl.giftValue),
          cnAlternative: Number(sl.cnAlternative),
        };
      });

    return {
      tag: s.tag,
      name: s.name,
      type: s.type,
      fromDate: s.fromDate,
      toDate: s.toDate,
      inScope,
      notInScope: group((r) => r.participation === "NOT_IN_SCOPE"),
      slabs: slabRows,
      noSlab: group((r) => r.participation === "IN_SCHEME" && !r.in_slab),
    };
  });

  const [last] = await db.select().from(syncRun).orderBy(desc(syncRun.id)).limit(1);
  return {
    dataAsOf: toIstIso(await latestSuccessDataAsOf(db)),
    lastSync: last ? toSyncRunSummary(last) : null,
    schemes: out,
  };
}

/* ------------------------------------------------------------------ */
/* Sync runs and dealer list                                          */
/* ------------------------------------------------------------------ */

export async function listSyncRuns(limit = 20): Promise<SyncRunSummary[]> {
  const db = getDb();
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const rows = await db.select().from(syncRun).orderBy(desc(syncRun.id)).limit(n);
  return rows.map(toSyncRunSummary);
}

/** Escape LIKE wildcards in user input. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Dealer list of one scheme for the admin Dealers page (client lead and Mayur, 22-10-2026): one row per dealer result
 * (parent code), with the slab the dealer is in. Ineligible dealers stay in the list. Left out: dealers with no
 * sales data for the scheme (NO_DATA) and dealers whose region belongs to another scheme (REGION_NOT_IN_SCOPE,
 * for example a TN dealer under FB-PAN). Order: highest slab first, then dealer code.
 * `q`: code prefix or name contains (case-insensitive).
 */
export async function listSchemeDealers(opts: {
  schemeTag: string;
  status: DealerListStatus;
  q?: string;
  /** Only the dealers in this slab (link from a slab row of the report). */
  slabNo?: number | null;
  /** Only the dealers that the report counts as "In scope" (participation IN_SCHEME). */
  inScopeOnly?: boolean;
  page: number;
  pageSize: number;
}): Promise<DealerListPage> {
  const db = getDb();
  const pageSize = Math.max(1, Math.min(200, Math.floor(opts.pageSize)));
  const page = Math.max(1, Math.floor(opts.page));
  const term = (opts.q ?? "").trim();

  // The report filters apply to the counts too, so that each tab count matches the report number.
  const base = sql`r.scheme_tag = ${opts.schemeTag}
    AND COALESCE(r.reason_code, '') NOT IN ('NO_DATA', 'REGION_NOT_IN_SCOPE')${
      opts.slabNo != null ? sql` AND r.current_slab_no = ${opts.slabNo}` : sql``
    }${opts.inScopeOnly ? sql` AND r.participation = 'IN_SCHEME'` : sql``}`;
  const search = term
    ? sql` AND (r.dealer_code ILIKE ${`${escapeLike(term)}%`} OR d.name ILIKE ${`%${escapeLike(term)}%`})`
    : sql``;
  const statusFilter =
    opts.status === "UNLOCKED"
      ? sql` AND r.current_slab_no IS NOT NULL`
      : opts.status === "LOCKED"
        ? sql` AND r.current_slab_no IS NULL`
        : sql``;

  const counts = await db.execute<{ unlocked: number; locked: number }>(sql`
    SELECT COUNT(*) FILTER (WHERE r.current_slab_no IS NOT NULL)::int AS unlocked,
           COUNT(*) FILTER (WHERE r.current_slab_no IS NULL)::int AS locked
    FROM dealer_scheme_result r
    LEFT JOIN dealer d ON d.code = r.dealer_code
    WHERE ${base}${search}
  `);
  const unlocked = Number(counts.rows[0]?.unlocked ?? 0);
  const locked = Number(counts.rows[0]?.locked ?? 0);

  const res = await db.execute<{
    code: string;
    name: string | null;
    region_name: string | null;
    slab_no: number | null;
    slab: string | null;
    benefit_blocked: boolean;
  }>(sql`
    SELECT r.dealer_code AS code, d.name, d.region_name, r.current_slab_no AS slab_no,
           r.status->>'current_slab' AS slab, r.benefit_blocked
    FROM dealer_scheme_result r
    LEFT JOIN dealer d ON d.code = r.dealer_code
    WHERE ${base}${search}${statusFilter}
    ORDER BY r.current_slab_no DESC NULLS LAST, r.dealer_code
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);

  return {
    rows: res.rows.map((r) => ({
      code: r.code,
      name: r.name,
      regionName: r.region_name,
      slabNo: r.slab_no === null ? null : Number(r.slab_no),
      slab: r.slab,
      benefitBlocked: r.benefit_blocked,
    })),
    counts: { all: unlocked + locked, unlocked, locked },
    page,
    pageSize,
  };
}

export async function createSyncRun(db: Db, source: SyncRunSummary["source"]): Promise<number> {
  const [row] = await db.insert(syncRun).values({ source, status: "RUNNING" }).returning({ id: syncRun.id });
  return row.id;
}

/** Start time of the latest successful sync run of `source` that started at or after `since`. Null when none. */
export async function lastSuccessfulSyncSince(db: Db, source: SyncRunSummary["source"], since: Date): Promise<Date | null> {
  const [row] = await db
    .select({ startedAt: syncRun.startedAt })
    .from(syncRun)
    .where(and(eq(syncRun.source, source), eq(syncRun.status, "SUCCESS"), gte(syncRun.startedAt, since)))
    .orderBy(desc(syncRun.startedAt))
    .limit(1);
  return row?.startedAt ?? null;
}

export async function finishSyncRun(
  db: Db,
  id: number,
  r: {
    status: "SUCCESS" | "FAILED";
    dataAsOf?: Date | string | null;
    rowCount?: number | null;
    bytesProcessed?: number | string | null;
    message?: string | null;
  },
): Promise<void> {
  await db
    .update(syncRun)
    .set({
      status: r.status,
      finishedAt: sql`now()`,
      dataAsOf: r.dataAsOf === undefined || r.dataAsOf === null ? null : new Date(r.dataAsOf),
      rowCount: r.rowCount ?? null,
      bytesProcessed: r.bytesProcessed === undefined || r.bytesProcessed === null ? null : String(r.bytesProcessed),
      message: r.message ?? null,
    })
    .where(eq(syncRun.id, id));
}
