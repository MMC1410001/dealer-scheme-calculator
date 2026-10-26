/** Shared types between the data layer (src/server/repo.ts) and the web layer (src/app). */
import type { DealerStatus } from "@/engine/types";

export type { DealerStatus };

export interface SyncRunSummary {
  id: number;
  source: "BIGQUERY" | "CSV" | "DEMO";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: string;
  finishedAt: string | null;
  dataAsOf: string | null;
  rowCount: number | null;
  bytesProcessed: number | null;
  message: string | null;
}

export interface ReasonCount {
  reasonCode: string;
  reason: string;
  count: number;
}

export interface SlabReportRow {
  slabNo: number;
  label: string;
  dealers: number;
  /** Dealers in this slab by reward choice. */
  gift: number;
  cn: number;
  notChosen: number;
  /** Star Points: dealers in this slab by chosen destination of the extra tickets. */
  destinationCruise: number;
  destinationOverseas: number;
  /** Dealers in this slab whose benefit is blocked by OD on the check date. */
  benefitBlocked: number;
  /** Slab conditions as in the circular table (INR, %, points). Null when the scheme has no such condition. */
  periodGsrRequired: number | null;
  minFirstMonthGsr: number | null;
  growthPct: number | null;
  pointsRequired: number | null;
  giftDescription: string;
  giftValue: number | null;
  cnAlternative: number;
}

export interface SchemeReport {
  tag: string;
  name: string;
  type: string;
  fromDate: string;
  toDate: string;
  inScope: number;
  notInScope: ReasonCount[];
  slabs: SlabReportRow[];
  /** Dealers in scope but in no slab, by the first failed Slab 1 condition. */
  noSlab: ReasonCount[];
}

export interface AdminReport {
  dataAsOf: string | null;
  lastSync: SyncRunSummary | null;
  schemes: SchemeReport[];
}

/** Status filter of the admin dealer list: UNLOCKED = in a slab, LOCKED = in no slab. */
export type DealerListStatus = "ALL" | "UNLOCKED" | "LOCKED";

export interface DealerListRow {
  code: string;
  name: string | null;
  regionName: string | null;
  /** Slab the dealer is in (the only UNLOCKED slab). Null = no slab. */
  slabNo: number | null;
  slab: string | null;
  benefitBlocked: boolean;
}

export interface DealerListPage {
  rows: DealerListRow[];
  /** Dealer counts for the scheme and search, by status (independent of the status filter). */
  counts: { all: number; unlocked: number; locked: number };
  page: number;
  pageSize: number;
}
