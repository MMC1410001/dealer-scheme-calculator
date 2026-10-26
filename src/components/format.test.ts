import { describe, expect, it } from "vitest";
import { conditionGap, formatActualByUnit, formatByUnit, formatDate, formatDateTime, formatInr, formatLakh, formatPercent, formatPoints } from "./format";

describe("format", () => {
  it("formats INR with en-IN grouping", () => {
    expect(formatInr(110400)).toBe("₹1,10,400");
    expect(formatInr(4500)).toBe("₹4,500");
    expect(formatInr(1234567.6)).toBe("₹12,34,568");
    expect(formatInr(null)).toBe("N/A");
    expect(formatInr(Number.NaN)).toBe("N/A");
  });

  it("adds a lakh hint from 1 lakh", () => {
    expect(formatLakh(360000)).toBe("₹3.60 lakh");
    expect(formatLakh(99999)).toBeNull();
  });

  it("formats points and percent", () => {
    expect(formatPoints(110400)).toBe("1,10,400");
    expect(formatPoints(2.5)).toBe("2.5");
    expect(formatPercent(20)).toBe("20.0%");
    expect(formatPercent(-3.456)).toBe("-3.5%");
    expect(formatByUnit(85000, "POINTS")).toBe("85,000");
  });

  it("formats dates without a time-zone shift", () => {
    expect(formatDate("2026-10-01")).toBe("01 Oct 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatDate(null)).toBe("N/A");
    expect(formatDateTime("2026-10-16T00:00:00Z")).toBe("16 Oct 2026, 05:30 IST");
  });

  it("computes the gap for unmet conditions", () => {
    expect(conditionGap({ key: "period_gsr", required: 250000, actual: 200000, met: false })).toBe("₹50,000");
    expect(conditionGap({ key: "growth_pct", required: 20, actual: 17, met: false })).toBe("3.0 percentage points");
    expect(conditionGap({ key: "points", required: 85000, actual: 80000.5, met: false })).toBe("5,000 points");
    expect(conditionGap({ key: "period_gsr", required: 1, actual: 2, met: true })).toBeNull();
    expect(conditionGap({ key: "period_gsr", required: 1, actual: null, met: false })).toBeNull();
  });
});

describe("near-boundary display (actual just below required)", () => {
  it("rounds the actual value down, so it never shows as equal to the required value", () => {
    expect(formatActualByUnit(249999.6, "INR")).toBe("₹2,49,999");
    expect(formatByUnit(250000, "INR")).toBe("₹2,50,000");
    expect(formatActualByUnit(19.99, "PERCENT")).toBe("19.9%");
    expect(formatActualByUnit(20, "PERCENT")).toBe("20.0%");
    expect(formatActualByUnit(84999.99, "POINTS")).toBe("84,999.9");
    expect(formatActualByUnit(85000, "POINTS")).toBe("85,000");
    expect(formatActualByUnit(null, "INR")).toBe("N/A");
  });
  it("shows a small gap as at least the display step", () => {
    expect(conditionGap({ key: "growth_pct", required: 20, actual: 19.995, met: false })).toBe("0.1 percentage points");
    expect(conditionGap({ key: "period_gsr", required: 250000, actual: 249999.6, met: false })).toBe("₹1");
  });
});
