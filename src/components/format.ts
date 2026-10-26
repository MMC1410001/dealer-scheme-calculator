/** Display formatting for the dealer view and the admin report (en-IN, INR). Pure functions. */

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const LAKH = 100_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Shown for a missing value. No dash in UI text (Mayur, 22-10-2026). */
export const EMPTY_VALUE = "N/A";

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** ₹1,10,400 (rounded to the rupee). */
export function formatInr(v: number | null | undefined): string {
  return isNum(v) ? INR.format(Math.round(v)) : EMPTY_VALUE;
}

/** "₹3.60 lakh" for values of 1 lakh or more, else null. Helps dealers who think in lakh. */
export function formatLakh(v: number | null | undefined): string | null {
  if (!isNum(v) || Math.abs(v) < LAKH) return null;
  return `₹${(v / LAKH).toFixed(2)} lakh`;
}

/** 1,10,400 or 1,10,400.5 */
export function formatPoints(v: number | null | undefined): string {
  return isNum(v) ? NUM.format(v) : EMPTY_VALUE;
}

export function formatCount(v: number | null | undefined): string {
  return isNum(v) ? INT.format(v) : EMPTY_VALUE;
}

/** 20.0% */
export function formatPercent(v: number | null | undefined): string {
  return isNum(v) ? `${v.toFixed(1)}%` : EMPTY_VALUE;
}

export type ValueUnit = "INR" | "PERCENT" | "POINTS";

export function formatByUnit(v: number | null | undefined, unit: ValueUnit): string {
  if (unit === "INR") return formatInr(v);
  if (unit === "PERCENT") return formatPercent(v);
  return formatPoints(v);
}

/** Round down at the display precision (INR: rupee, %: 0.1, points: 0.1). The tiny epsilon absorbs float noise. */
function floorAt(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.floor(v * f + 1e-6) / f;
}

/**
 * Format the dealer's ACTUAL value of a slab condition. It is rounded DOWN at the display precision, so that a value
 * just below the required value never shows as equal to it (₹2,49,999.60 shows ₹2,49,999, not ₹2,50,000;
 * 19.99% shows 19.9%). A met value still shows >= the required value, because the required values are whole
 * at the display precision.
 */
export function formatActualByUnit(v: number | null | undefined, unit: ValueUnit): string {
  if (!isNum(v)) return EMPTY_VALUE;
  if (unit === "INR") return formatInr(floorAt(v, 0));
  if (unit === "PERCENT") return formatPercent(floorAt(v, 1));
  return formatPoints(floorAt(v, 1));
}

/** Unit of a slab condition, from its key. */
export function conditionUnit(key: string): ValueUnit {
  if (key === "growth_pct") return "PERCENT";
  if (key === "points") return "POINTS";
  return "INR";
}

/** "2026-10-01" -> "01 Oct 2026". Date-only values are not shifted by time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return EMPTY_VALUE;
  if (iso.length > 10) return formatDateTime(iso);
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : EMPTY_VALUE;
}

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
});

/** "16 Oct 2026, 05:30 IST" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_VALUE;
  return `${DATE_TIME.format(d)} IST`;
}

/**
 * What is still missing for a condition. Null when it is met or the actual value is unknown.
 * growth_pct: percentage points. Others: same unit as the condition.
 */
export function conditionGap(c: { key: string; required: number; actual: number | null; met: boolean }): string | null {
  if (c.met || !isNum(c.actual)) return null;
  const gap = c.required - c.actual;
  if (gap <= 0) return null;
  const unit = conditionUnit(c.key);
  // Round the gap UP at the display precision, so that a small gap never shows as 0.
  if (unit === "PERCENT") return `${(Math.ceil(gap * 10 - 1e-6) / 10).toFixed(1)} percentage points`;
  if (unit === "POINTS") return `${formatPoints(Math.ceil(gap))} points`;
  return formatInr(Math.ceil(gap));
}
