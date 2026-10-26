/**
 * Scheme engine entry point. Plain TypeScript: no Next.js, database or BigQuery imports.
 *
 * evaluateDealerScheme() → status of one dealer for one scheme (shape: docs/api-contract.md).
 * buildDealerStatus()    → the dealer status object that the iframe page (and a later API route) returns.
 */
import type {
  Condition,
  DealerContext,
  DealerSchemeMetrics,
  DealerStatus,
  ResultReasonCode,
  SchemeConfig,
  SchemeStatus,
  SlabStatus,
} from "./types";
import { classifySlabs } from "./classify";
import { checkParticipation } from "./participation";
import { evaluateFestiveBonanza } from "./festive-bonanza";
import { evaluateStarPoints } from "./star-points";
import { displayDate } from "./labels";
import type { SchemeEvaluation } from "./evaluation";

export * from "./types";
export * from "./money";
export { classifySlabs } from "./classify";
export { checkParticipation, type ParticipationResult } from "./participation";
export { evaluateFestiveBonanza } from "./festive-bonanza";
export { evaluateStarPoints, calculatePoints, type StarPointsPoints } from "./star-points";
export type { SchemeEvaluation } from "./evaluation";

export interface EvaluateOptions {
  /** Today's date, ISO "YYYY-MM-DD". Used for the provisional flag. */
  today: string;
  /** All configured schemes (for the enrolment / exclusivity check). */
  allSchemes: SchemeConfig[];
}

const SLAB1_REASON: Record<Condition["key"], ResultReasonCode> = {
  period_gsr: "SLAB1_PERIOD_GSR_NOT_MET",
  min_first_month_gsr: "SLAB1_MIN_FIRST_MONTH_GSR_NOT_MET",
  growth_pct: "SLAB1_GROWTH_NOT_MET",
  points: "SLAB1_POINTS_NOT_MET",
};

function evaluateByType(scheme: SchemeConfig, metrics: DealerSchemeMetrics): SchemeEvaluation {
  switch (scheme.type) {
    case "FESTIVE_BONANZA":
      return evaluateFestiveBonanza(scheme, metrics);
    case "STAR_POINTS":
      return evaluateStarPoints(scheme, metrics);
    default: {
      const never: never = scheme.type;
      throw new Error(`Unknown scheme type: ${String(never)}`);
    }
  }
}

export function evaluateDealerScheme(
  scheme: SchemeConfig,
  dealer: DealerContext,
  metrics: DealerSchemeMetrics | null,
  opts: EvaluateOptions,
): SchemeStatus {
  const p = checkParticipation(scheme, dealer, metrics, opts.allSchemes);
  if (p.participation === "NOT_IN_SCOPE" || metrics == null) {
    return {
      scheme_tag: scheme.tag,
      participation: "NOT_IN_SCOPE",
      reason: p.participation === "NOT_IN_SCOPE" ? p.reason : undefined,
      reason_code: p.participation === "NOT_IN_SCOPE" ? p.reason_code : "NO_DATA",
    };
  }

  const ev = evaluateByType(scheme, metrics);
  const index = classifySlabs(
    ev.slabConditions.map((cs) => cs.map((c) => c.met)),
    scheme.classificationRule,
  );
  const currentSlab = index == null ? null : scheme.slabs[index];
  const currentSlabNo = currentSlab?.slabNo ?? null;

  const details: SlabStatus[] = scheme.slabs.map((slab, i) => ({
    slab: slab.label,
    slab_no: slab.slabNo,
    // Only the slab the dealer is in is UNLOCKED; lower slabs stay LOCKED (client lead and Mayur, 22-10-2026).
    lock_status: slab.slabNo === currentSlabNo ? "UNLOCKED" : "LOCKED",
    gift: { ...slab.gift },
    cn_alternative: slab.cnAlternative,
    conditions: ev.slabConditions[i],
  }));

  const od_status: SchemeStatus["od_status"] =
    dealer.hasOdOnCheckDate == null ? "PENDING" : dealer.hasOdOnCheckDate ? "OD" : "NO_OD";
  const benefit_blocked = od_status === "OD";

  const status: SchemeStatus = {
    scheme_tag: scheme.tag,
    participation: "IN_SCHEME",
    header: {
      scheme_name: scheme.name,
      from_date: scheme.fromDate,
      to_date: scheme.toDate,
      q1_monthly_avg_gsr: ev.q1MonthlyAvg,
      metrics: ev.metrics,
    },
    provisional: opts.today < scheme.finalOn,
    final_on: scheme.finalOn,
    current_slab: currentSlab?.label ?? null,
    current_slab_no: currentSlabNo,
    benefit_blocked,
    od_status,
    details,
  };

  if (currentSlab == null) {
    const failed = ev.slabConditions[0]?.find((c) => !c.met);
    if (failed) {
      status.reason_code = SLAB1_REASON[failed.key];
      status.reason = `${scheme.slabs[0].label} condition not met: ${failed.label}.`;
    }
  } else if (benefit_blocked) {
    status.reason_code = "OD_ON_CHECK_DATE";
    status.reason = `Dealer has an overdue amount on ${displayDate(scheme.odCheckDate)}. No benefit is given.`;
  }

  if (ev.extraBenefits) status.extra_benefits = ev.extraBenefits(currentSlabNo);
  return status;
}

export function buildDealerStatus(
  dealerCode: string,
  dealerName: string | null | undefined,
  dataAsOf: string | null,
  schemeStatuses: SchemeStatus[],
): DealerStatus {
  return {
    dealer_code: dealerCode,
    dealer_name: dealerName ?? null,
    data_as_of: dataAsOf,
    schemes: schemeStatuses,
  };
}
