/** Test helpers (used only by *.test.ts). */
import { SCHEMES, SCHEME_TAGS } from "@/config/schemes";
import type { DealerContext, DealerSchemeMetrics, SchemeConfig } from "./types";

export const FB_PAN = SCHEMES.find((s) => s.tag === SCHEME_TAGS.festiveBonanzaPan)!;
export const FB_TNHPJK = SCHEMES.find((s) => s.tag === SCHEME_TAGS.festiveBonanzaTnHpJk)!;
export const SP_Q3 = SCHEMES.find((s) => s.tag === SCHEME_TAGS.starPoints)!;

export function dealer(overrides: Partial<DealerContext> = {}): DealerContext {
  return {
    dealerCode: "D10001",
    dealerName: "Test Dealer",
    regionName: "Mah North",
    enrolledSchemeTag: null,
    hasOdOnCheckDate: null,
    ...overrides,
  };
}

/** Festive Bonanza metrics: Q1 total spread over the 3 base months. */
export function fbMetrics(q1: number, oct: number, nov: number, extra: Partial<DealerSchemeMetrics> = {}): DealerSchemeMetrics {
  return {
    gsrByMonth: { "2026-04": q1, "2026-05": 0, "2026-06": 0, "2026-10": oct, "2026-11": nov, ...(extra.gsrByMonth ?? {}) },
    mrvByMonth: { ...(extra.mrvByMonth ?? {}) },
    ...(extra.totalGsrByMonth ? { totalGsrByMonth: extra.totalGsrByMonth } : {}),
  };
}

export function withRule(scheme: SchemeConfig, patch: Partial<SchemeConfig>): SchemeConfig {
  return { ...scheme, ...patch };
}

export const OPTS = { today: "2026-10-16", allSchemes: SCHEMES };
