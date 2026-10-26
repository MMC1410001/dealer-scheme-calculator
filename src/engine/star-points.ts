/**
 * Star Points Q3 FY 2026-27 (SP-Q3) – CLAUDE.md section 8.
 *
 * Points = Σ months Σ categories litres × (base + bonus of that month) + tools points.
 *  - Return-window months (returns only, negative litres) use the LAST period month's bonus.
 *  - Tools: floor(total tools GSR / step) × points per step, on the period total incl. window; never negative.
 *  - Points are calculated exactly (litres in 1/1000 L × points per litre in 1/1000) and rounded DOWN to
 *    2 decimals. The slab and extra-benefit checks use this floored value, so a fractional shortfall
 *    (84,999.995 points) never unlocks a slab (85,000).
 * Slab conditions (all must be true): points >= slab points; Q3 GSR >= Q1 GSR × (1 + growth %).
 * Growth GSR follows growthGsrBasis: ALL_PRODUCTS = totalGsrByMonth (all products in the scheme channels; BA,
 * 19-10-2026), SCHEME_PRODUCTS = gsrByMonth (Table III + tools). The header GSR values use the same basis.
 * Extra benefits beyond the top slabs: circular page 2.
 */
import {
  STAR_CATEGORIES,
  type Condition,
  type DealerSchemeMetrics,
  type ExtraBenefitStatus,
  type StarCategory,
  type Metric,
  type SchemeConfig,
} from "./types";
import {
  displayGrowthPct,
  floorDiv,
  fromPaise,
  growthGsrNeededPaise,
  growthGsrRequiredPaise,
  growthMet,
  hadAnyBaseSales,
  round2,
  sumPaise,
  toPaise,
} from "./money";
import { fiscalQuarterLabel, monthKey, monthLabel } from "./labels";
import type { SchemeEvaluation } from "./evaluation";

const CATEGORY_LABEL: Record<StarCategory, string> = {
  LUXURY: "Luxury",
  PREMIUM: "Premium",
  ECONOMY: "Economy",
  ENAMELS: "Enamels",
  OTHERS: "Others",
};

/** Points in hundredths (integer) for exact comparisons of configured values (slab points, steps). */
const toHundredths = (x: number) => Math.round(x * 100);

/** Exact units: litres in 1/1000 L, points per litre in 1/1000 point → product in 1/1,000,000 point. */
const SCALE = 1000;
const MICRO_PER_HUNDREDTH = BigInt(10_000);

export interface StarPointsPoints {
  byCategory: Record<StarCategory, number>;
  tools: number;
  /** Total points, rounded down to 2 decimals. */
  total: number;
  /** Total points in hundredths (integer, rounded down). Use this for comparisons. */
  totalHundredths: number;
}

export function calculatePoints(scheme: SchemeConfig, m: DealerSchemeMetrics): StarPointsPoints {
  const gt = scheme.starPoints;
  if (!gt) throw new Error(`Scheme ${scheme.tag}: starPoints configuration is missing.`);
  const lastPeriodMonth = scheme.periodMonths[scheme.periodMonths.length - 1];

  const zero = BigInt(0);
  const raw: Record<StarCategory, bigint> = { LUXURY: zero, PREMIUM: zero, ECONOMY: zero, ENAMELS: zero, OTHERS: zero };
  const monthsWithBonus: Array<[month: string, bonusMonth: string]> = [
    ...scheme.periodMonths.map((mo): [string, string] => [mo, mo]),
    ...scheme.returnWindowMonths.map((mo): [string, string] => [mo, lastPeriodMonth]),
  ];
  for (const [month, bonusMonth] of monthsWithBonus) {
    const litres = m.litresByMonth?.[month];
    if (!litres) continue;
    for (const cat of STAR_CATEGORIES) {
      const l = litres[cat] ?? 0;
      if (l === 0) continue;
      const perLitre = gt.basePerLitre[cat] + (gt.bonusPerLitre[bonusMonth]?.[cat] ?? 0);
      raw[cat] += BigInt(Math.round(l * SCALE)) * BigInt(Math.round(perLitre * SCALE));
    }
  }

  const toolsPaise = sumPaise(
    [...scheme.periodMonths, ...scheme.returnWindowMonths].map((mo) => m.toolsGsrByMonth?.[mo] ?? 0),
  );
  const stepPaise = toPaise(gt.toolsGsrStep);
  const tools = toolsPaise > 0 && stepPaise > 0 ? Math.floor(toolsPaise / stepPaise) * gt.toolsPointsPerStep : 0;

  const byCategory: Record<StarCategory, number> = { LUXURY: 0, PREMIUM: 0, ECONOMY: 0, ENAMELS: 0, OTHERS: 0 };
  let catTotal = zero;
  for (const cat of STAR_CATEGORIES) {
    catTotal += raw[cat];
    byCategory[cat] = Number(floorDiv(raw[cat], MICRO_PER_HUNDREDTH)) / 100;
  }
  const totalHundredths = Number(floorDiv(catTotal, MICRO_PER_HUNDREDTH)) + tools * 100;
  return { byCategory, tools, total: totalHundredths / 100, totalHundredths };
}

export function evaluateStarPoints(scheme: SchemeConfig, m: DealerSchemeMetrics): SchemeEvaluation {
  const gt = scheme.starPoints;
  if (!gt) throw new Error(`Scheme ${scheme.tag}: starPoints configuration is missing.`);
  const months = scheme.periodMonths;
  if (months.length === 0) throw new Error(`Scheme ${scheme.tag}: periodMonths is empty.`);
  const growthGsr = scheme.growthGsrBasis === "ALL_PRODUCTS" && m.totalGsrByMonth ? m.totalGsrByMonth : m.gsrByMonth;
  const gsr = (month: string) => growthGsr[month] ?? 0;
  const anyQ1Sales = hadAnyBaseSales(m, scheme.baseMonths);
  const basisNote = scheme.growthGsrBasis === "ALL_PRODUCTS" ? " (all products)" : "";

  const q1Paise = sumPaise(scheme.baseMonths.map(gsr));
  const windowPaise = sumPaise(scheme.returnWindowMonths.map(gsr));
  const monthPaise = months.map((mo) => toPaise(gsr(mo)));
  monthPaise[monthPaise.length - 1] += windowPaise;
  const q3Paise = monthPaise.reduce((a, b) => a + b, 0);
  const growthDisplay = displayGrowthPct(q3Paise, 1, q1Paise, 1);
  const mrvPaise = sumPaise([...months, ...scheme.returnWindowMonths].map((mo) => m.mrvByMonth[mo] ?? 0));

  const points = calculatePoints(scheme, m);
  const pointsH = points.totalHundredths;
  const periodName = fiscalQuarterLabel(months);
  const baseName = fiscalQuarterLabel(scheme.baseMonths);

  const metrics: Metric[] = months.map((mo, i) => ({
    key: `${monthKey(mo)}_gsr`,
    label: `${monthLabel(mo)} GSR`,
    value: fromPaise(monthPaise[i]),
    unit: "INR",
  }));
  metrics.push({ key: "q3_gsr", label: `${periodName} GSR${basisNote}`, value: fromPaise(q3Paise), unit: "INR" });
  metrics.push({ key: "growth_pct", label: "Growth", value: growthDisplay, unit: "PERCENT" });
  // GSR required and still needed for the Slab 1 growth % (Mayur, 23-10-2026): mid-quarter the growth compares part
  // of Q3 with all of Q1, so the % alone looks low. Not shown when the Q1 base is zero (growth follows the zero-base rule).
  const firstGrowthPct = scheme.slabs[0]?.growthPct;
  if (firstGrowthPct != null && q1Paise > 0) {
    metrics.push({
      key: "growth_gsr_required",
      label: `GSR required for ${firstGrowthPct}% growth`,
      value: fromPaise(growthGsrRequiredPaise(1, q1Paise, 1, firstGrowthPct)),
      unit: "INR",
    });
    metrics.push({
      key: "growth_gsr_needed",
      label: `GSR still needed for ${firstGrowthPct}% growth`,
      value: fromPaise(growthGsrNeededPaise(q3Paise, 1, q1Paise, 1, firstGrowthPct)),
      unit: "INR",
    });
  }
  metrics.push({ key: "points_earned", label: "Points earned", value: points.total, unit: "POINTS" });
  for (const cat of STAR_CATEGORIES) {
    metrics.push({
      key: `points_${cat.toLowerCase()}`,
      label: `${CATEGORY_LABEL[cat]} points`,
      value: points.byCategory[cat],
      unit: "POINTS",
    });
  }
  metrics.push({ key: "points_tools", label: "Tools points", value: points.tools, unit: "POINTS" });
  if (mrvPaise !== 0) {
    metrics.push({ key: "mrv_total", label: "Material returns", value: fromPaise(mrvPaise), unit: "INR" });
  }

  const slabConditions: Condition[][] = scheme.slabs.map((slab) => {
    const conditions: Condition[] = [];
    if (slab.pointsRequired != null) {
      conditions.push({
        key: "points",
        label: "Points earned",
        required: slab.pointsRequired,
        actual: points.total,
        met: pointsH >= toHundredths(slab.pointsRequired),
      });
    }
    if (slab.growthPct != null) {
      conditions.push({
        key: "growth_pct",
        label: `Growth over ${baseName} GSR${basisNote}`,
        required: slab.growthPct,
        actual: growthDisplay,
        met: growthMet(q3Paise, 1, q1Paise, 1, slab.growthPct, scheme.zeroBaseGrowthRule, anyQ1Sales),
      });
    }
    return conditions;
  });

  // Extra benefits need the dealer in the rule's slab (Slab 6 / 7), and those slabs already need their growth %.
  // The circular note "Beyond Slab 7, growth required is 5%" is an open item (see src/config/schemes.ts).
  const extraBenefits = (currentSlabNo: number | null): ExtraBenefitStatus[] => {
    if (currentSlabNo == null) return [];
    const out: ExtraBenefitStatus[] = [];
    for (const rule of gt.extraBenefits) {
      if (currentSlabNo < rule.fromSlabNo) continue;
      const excessH = pointsH - toHundredths(rule.beyondPoints);
      if (excessH <= 0) continue;
      const extraTickets = rule.tripEveryPoints > 0 ? Math.floor(excessH / toHundredths(rule.tripEveryPoints)) : 0;
      const cnSteps = rule.cnEveryPoints > 0 ? Math.floor(excessH / toHundredths(rule.cnEveryPoints)) : 0;
      const status: ExtraBenefitStatus = {
        description: rule.tripDescription,
        destination: rule.destination ?? null,
        extra_tickets: extraTickets,
        extra_ticket_cn_value: extraTickets * rule.tripCnValue,
        cn_option_value: cnSteps * rule.cnPerStep,
      };
      if (status.extra_tickets > 0 || status.cn_option_value > 0) out.push(status);
    }
    return out;
  };

  return {
    q1Paise,
    q1MonthlyAvg: round2(fromPaise(q1Paise) / scheme.baseMonthCount),
    metrics,
    slabConditions,
    extraBenefits,
  };
}
