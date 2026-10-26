/**
 * Exact money and growth arithmetic for the scheme engine.
 *
 * Amounts arrive in INR as JavaScript numbers. The engine converts them to integer paise
 * before it adds or compares them, so that floating-point noise cannot flip a slab condition.
 * Growth conditions are compared by cross-multiplication with BigInt (no division).
 */
import type { DealerSchemeMetrics, ZeroBaseGrowthRule } from "./types";

/** INR → integer paise. */
export function toPaise(inr: number | null | undefined): number {
  if (inr == null || !Number.isFinite(inr)) return 0;
  return Math.round(inr * 100);
}

/** Integer paise → INR. */
export function fromPaise(paise: number): number {
  return paise / 100;
}

/** Round to 2 decimals (half away from zero for positive values, as Math.round). */
export function round2(x: number): number {
  const r = Math.round((x + Number.EPSILON * Math.sign(x)) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

/** Sum INR amounts exactly. Returns paise. */
export function sumPaise(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += toPaise(v);
  return total;
}

/** a >= b, compared in paise. */
export function gteInr(a: number, b: number): boolean {
  return toPaise(a) >= toPaise(b);
}

/** Growth % → integer basis points (hundredths of a percent). 17.5 → 1750. */
function toBasisPoints(pct: number): bigint {
  return BigInt(Math.round(pct * 100));
}

/**
 * Growth condition, exact.
 *
 * Met iff  (periodTotal / periodMonths) >= (baseTotal / baseMonths) × (1 + growthPct / 100)
 * <=>      periodTotal × baseMonths × 10000 >= baseTotal × periodMonths × (10000 + growthBp)
 *
 * Use periodMonths = baseMonths = 1 to compare totals (Star Points: Q3 GSR >= Q1 GSR × 1.10).
 * When the base is zero or less, the result follows `zeroBaseRule` (MET_IF_ANY_BASE_SALES: `hadAnyBaseSales`).
 */
export function growthMet(
  periodTotalPaise: number,
  periodMonths: number,
  baseTotalPaise: number,
  baseMonths: number,
  growthPct: number,
  zeroBaseRule: ZeroBaseGrowthRule,
  hadAnyBaseSales = false,
): boolean {
  if (baseTotalPaise <= 0) return zeroBaseRule === "MET" || (zeroBaseRule === "MET_IF_ANY_BASE_SALES" && hadAnyBaseSales);
  const lhs = BigInt(periodTotalPaise) * BigInt(baseMonths) * BigInt(10000);
  const rhs = BigInt(baseTotalPaise) * BigInt(periodMonths) * (BigInt(10000) + toBasisPoints(growthPct));
  return lhs >= rhs;
}

/**
 * Period GSR total (paise) that meets the growth condition, exactly as `growthMet` checks it:
 * ceil(baseTotal × periodMonths × (10000 + growthBp) / (baseMonths × 10000)).
 * Call it only when the base is greater than zero.
 */
export function growthGsrRequiredPaise(periodMonths: number, baseTotalPaise: number, baseMonths: number, growthPct: number): number {
  const num = BigInt(baseTotalPaise) * BigInt(periodMonths) * (BigInt(10000) + toBasisPoints(growthPct));
  const den = BigInt(baseMonths) * BigInt(10000);
  return Number(-floorDiv(-num, den));
}

/** GSR (paise) still needed in the period to meet the growth condition. 0 when the growth is already met. */
export function growthGsrNeededPaise(
  periodTotalPaise: number,
  periodMonths: number,
  baseTotalPaise: number,
  baseMonths: number,
  growthPct: number,
): number {
  return Math.max(0, growthGsrRequiredPaise(periodMonths, baseTotalPaise, baseMonths, growthPct) - periodTotalPaise);
}

/** True when the dealer had base-period sales of any product (totalGsrByMonth, else gsrByMonth). */
export function hadAnyBaseSales(m: DealerSchemeMetrics, baseMonths: string[]): boolean {
  const byMonth = m.totalGsrByMonth ?? m.gsrByMonth;
  return sumPaise(baseMonths.map((mo) => byMonth[mo] ?? 0)) > 0;
}

/** Floor division for BigInt (BigInt "/" truncates toward zero). `den` must be > 0. */
export function floorDiv(num: bigint, den: bigint): bigint {
  const q = num / den;
  return num % den !== BigInt(0) && num < BigInt(0) ? q - BigInt(1) : q;
}

/**
 * Display growth %: (periodMonthlyAvg / baseMonthlyAvg − 1) × 100, rounded DOWN to 2 decimals, exactly (BigInt).
 * Rounded down, so that a growth that is not met never shows as equal to the required %
 * (19.995% shows 19.99%, not 20%). A met growth still shows >= the required % (required has at most 2 decimals).
 * Null when the base is zero or less.
 */
export function displayGrowthPct(
  periodTotalPaise: number,
  periodMonths: number,
  baseTotalPaise: number,
  baseMonths: number,
): number | null {
  if (baseTotalPaise <= 0 || periodMonths <= 0 || baseMonths <= 0) return null;
  const num = BigInt(Math.round(periodTotalPaise)) * BigInt(baseMonths) * BigInt(10000);
  const den = BigInt(Math.round(baseTotalPaise)) * BigInt(periodMonths);
  const hundredths = floorDiv(num, den) - BigInt(10000);
  return Number(hundredths) / 100;
}
