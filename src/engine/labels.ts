/** Display labels derived from the scheme configuration (months, quarters, dates). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseMonth(month: string): { year: number; month: number } {
  const [y, m] = month.split("-").map(Number);
  return { year: y, month: m };
}

/** "2026-10" → "Oct" */
export function monthShort(month: string): string {
  return MONTHS[parseMonth(month).month - 1] ?? month;
}

/** "2026-10" → "Oct'26" */
export function monthLabel(month: string): string {
  const { year } = parseMonth(month);
  return `${monthShort(month)}'${String(year).slice(-2)}`;
}

/** "2026-10" → "oct" (metric key prefix). */
export function monthKey(month: string): string {
  return monthShort(month).toLowerCase();
}

/** ["2026-10","2026-11"] → "Oct + Nov'26" */
export function periodLabel(months: string[]): string {
  if (months.length === 0) return "";
  const last = months[months.length - 1];
  return [...months.slice(0, -1).map(monthShort), monthLabel(last)].join(" + ");
}

/** Indian fiscal quarter of the first month: "2026-04" → "Q1 FY 2026-27" (FY starts in April). */
export function fiscalQuarterLabel(months: string[]): string {
  if (months.length === 0) return "base period";
  const { year, month } = parseMonth(months[0]);
  const fy = month >= 4 ? year + 1 : year;
  const q = Math.floor(((month - 4 + 12) % 12) / 3) + 1;
  return `Q${q} FY ${fy - 1}-${String(fy).slice(-2)}`;
}

/** "2026-11-30" → "30-11-2026" */
export function displayDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}
