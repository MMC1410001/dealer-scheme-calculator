/**
 * Festive Bonanza (FB-PAN and FB-TNHPJK) – CLAUDE.md section 7.
 *
 * Slab conditions (all must be true):
 *  1. period_gsr:           Oct + Nov GSR >= slab GSR.
 *  2. min_first_month_gsr:  Oct GSR >= slab minimum.
 *  3. growth_pct:           (Oct + Nov) / 2 >= Q1 monthly average × (1 + growth %). Only when the slab has growthPct (FB-PAN).
 *
 * Material returns in the return-window month(s) are deducted from the LAST period month (Nov).
 * The Oct minimum check uses Oct only.
 * Zero Q1 base: the growth result follows zeroBaseGrowthRule (MET_IF_ANY_BASE_SALES: met only when the dealer had
 * Q1 sales of any product).
 */
import type { Condition, DealerSchemeMetrics, Metric, SchemeConfig } from "./types";
import {
  displayGrowthPct,
  fromPaise,
  growthGsrNeededPaise,
  growthGsrRequiredPaise,
  growthMet,
  hadAnyBaseSales,
  round2,
  sumPaise,
  toPaise,
} from "./money";
import { monthKey, monthLabel, periodLabel } from "./labels";
import type { SchemeEvaluation } from "./evaluation";

export function evaluateFestiveBonanza(scheme: SchemeConfig, m: DealerSchemeMetrics): SchemeEvaluation {
  const gsr = (month: string) => m.gsrByMonth[month] ?? 0;
  const months = scheme.periodMonths;
  if (months.length === 0) throw new Error(`Scheme ${scheme.tag}: periodMonths is empty.`);

  const q1Paise = sumPaise(scheme.baseMonths.map(gsr));
  const windowPaise = sumPaise(scheme.returnWindowMonths.map(gsr));

  // Per-month GSR in paise; the return window goes to the last period month.
  const monthPaise = months.map((mo) => toPaise(gsr(mo)));
  monthPaise[monthPaise.length - 1] += windowPaise;

  const firstMonthPaise = monthPaise[0];
  const periodPaise = monthPaise.reduce((a, b) => a + b, 0);
  const growthDisplay = displayGrowthPct(periodPaise, months.length, q1Paise, scheme.baseMonthCount);

  const mrvPaise = sumPaise([...months, ...scheme.returnWindowMonths].map((mo) => m.mrvByMonth[mo] ?? 0));
  const anyQ1Sales = hadAnyBaseSales(m, scheme.baseMonths);

  const metrics: Metric[] = months.map((mo, i) => ({
    key: `${monthKey(mo)}_gsr`,
    label: `${monthLabel(mo)} GSR`,
    value: fromPaise(monthPaise[i]),
    unit: "INR",
  }));
  metrics.push({ key: "period_gsr", label: `GSR ${periodLabel(months)}`, value: fromPaise(periodPaise), unit: "INR" });
  metrics.push({ key: "growth_pct", label: "Growth", value: growthDisplay, unit: "PERCENT" });
  // Oct + Nov GSR required and still needed for the Slab 1 growth % (FB-PAN only; FB-TNHPJK has no growth
  // condition). Extra metrics: growth_pct stays as it is. Not shown when the Q1 base is zero (zero-base rule).
  const firstGrowthPct = scheme.slabs[0]?.growthPct;
  if (firstGrowthPct != null && q1Paise > 0) {
    metrics.push({
      key: "growth_gsr_required",
      label: `GSR required for ${firstGrowthPct}% growth`,
      value: fromPaise(growthGsrRequiredPaise(months.length, q1Paise, scheme.baseMonthCount, firstGrowthPct)),
      unit: "INR",
    });
    metrics.push({
      key: "growth_gsr_needed",
      label: `GSR still needed for ${firstGrowthPct}% growth`,
      value: fromPaise(growthGsrNeededPaise(periodPaise, months.length, q1Paise, scheme.baseMonthCount, firstGrowthPct)),
      unit: "INR",
    });
  }
  if (mrvPaise !== 0) {
    metrics.push({ key: "mrv_total", label: "Material returns", value: fromPaise(mrvPaise), unit: "INR" });
  }

  const slabConditions: Condition[][] = scheme.slabs.map((slab) => {
    const conditions: Condition[] = [];
    if (slab.periodGsrRequired != null) {
      conditions.push({
        key: "period_gsr",
        label: `GSR ${periodLabel(months)}`,
        required: slab.periodGsrRequired,
        actual: fromPaise(periodPaise),
        met: periodPaise >= toPaise(slab.periodGsrRequired),
      });
    }
    if (slab.minFirstMonthGsr != null) {
      conditions.push({
        key: "min_first_month_gsr",
        label: `Min GSR in ${monthLabel(months[0])}`,
        required: slab.minFirstMonthGsr,
        actual: fromPaise(firstMonthPaise),
        met: firstMonthPaise >= toPaise(slab.minFirstMonthGsr),
      });
    }
    if (slab.growthPct != null) {
      conditions.push({
        key: "growth_pct",
        label: "Growth over Q1 monthly avg",
        required: slab.growthPct,
        actual: growthDisplay,
        met: growthMet(
          periodPaise,
          months.length,
          q1Paise,
          scheme.baseMonthCount,
          slab.growthPct,
          scheme.zeroBaseGrowthRule,
          anyQ1Sales,
        ),
      });
    }
    return conditions;
  });

  return { q1Paise, q1MonthlyAvg: round2(fromPaise(q1Paise) / scheme.baseMonthCount), metrics, slabConditions };
}
