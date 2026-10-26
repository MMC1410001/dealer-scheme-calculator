/** Internal result of a scheme-type evaluation, before slab classification. */
import type { Condition, ExtraBenefitStatus, Metric } from "./types";

export interface SchemeEvaluation {
  /** Base period (Q1) GSR in paise. */
  q1Paise: number;
  /** Q1 GSR ÷ baseMonthCount, INR, 2 decimals. */
  q1MonthlyAvg: number;
  /** Header metrics in display order. */
  metrics: Metric[];
  /** Per slab (in slab order), all conditions with met flags. */
  slabConditions: Condition[][];
  /** Star Points: extra benefits beyond the top slabs, for the given current slab number. */
  extraBenefits?: (currentSlabNo: number | null) => ExtraBenefitStatus[];
}
