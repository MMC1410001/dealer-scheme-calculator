import { describe, expect, it } from "vitest";
import { displayGrowthPct, floorDiv, growthMet, round2, sumPaise, toPaise } from "./money";

describe("money", () => {
  it("converts to paise and sums exactly", () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(sumPaise([0.1, 0.2, -0.3])).toBe(0);
    expect(toPaise(null)).toBe(0);
  });

  it("round2", () => {
    expect(round2(19.999999999999996)).toBe(20);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-0.001)).toBe(0);
  });

  it("growth by cross-multiplication is exact at the boundary", () => {
    // (360000/2) vs (450000/3) × 1.20 → 180000 = 180000
    expect(growthMet(toPaise(360000), 2, toPaise(450000), 3, 20, "MET")).toBe(true);
    expect(growthMet(toPaise(359999.99), 2, toPaise(450000), 3, 20, "MET")).toBe(false);
  });

  it("zero base follows the rule; display growth is null", () => {
    expect(growthMet(100, 1, 0, 1, 10, "MET")).toBe(true);
    expect(growthMet(100, 1, 0, 1, 10, "NOT_MET")).toBe(false);
    expect(displayGrowthPct(100, 1, 0, 1)).toBeNull();
  });

  it("display growth is rounded down exactly, so a near miss never shows as the required %", () => {
    // Q1 3,00,000 (avg 1,00,000); Oct 1,00,000 + Nov 1,39,990 → avg 1,19,995 → 19.995 %
    expect(displayGrowthPct(toPaise(239990), 2, toPaise(300000), 3)).toBe(19.99);
    expect(growthMet(toPaise(239990), 2, toPaise(300000), 3, 20, "MET")).toBe(false);
    // Exactly 20 % stays 20.
    expect(displayGrowthPct(toPaise(360000), 2, toPaise(450000), 3)).toBe(20);
    // Negative growth rounds down too: −5.555… → −5.56.
    expect(displayGrowthPct(toPaise(85000) * 2, 2, toPaise(90000) * 3, 3)).toBe(-5.56);
  });

  it("floorDiv rounds toward minus infinity", () => {
    expect(floorDiv(BigInt(7), BigInt(2))).toBe(BigInt(3));
    expect(floorDiv(BigInt(-7), BigInt(2))).toBe(BigInt(-4));
    expect(floorDiv(BigInt(-6), BigInt(2))).toBe(BigInt(-3));
  });
});
