import { describe, expect, it } from "vitest";
import { evaluateDealerScheme } from "./index";
import { calculatePoints } from "./star-points";
import type { DealerSchemeMetrics, StarCategory } from "./types";
import { SP_Q3, OPTS, dealer, withRule } from "./test-helpers";

type Litres = Record<string, Partial<Record<StarCategory, number>>>;

function spMetrics(
  q1: number,
  gsr: Record<string, number>,
  litres: Litres = {},
  tools: Record<string, number> = {},
  totalGsrByMonth?: Record<string, number>,
): DealerSchemeMetrics {
  return {
    gsrByMonth: { "2026-04": q1, ...gsr },
    mrvByMonth: {},
    litresByMonth: litres,
    toolsGsrByMonth: tools,
    ...(totalGsrByMonth ? { totalGsrByMonth } : {}),
  };
}

const metric = (s: ReturnType<typeof evaluateDealerScheme>, key: string) =>
  s.header!.metrics.find((m) => m.key === key)?.value;

describe("Star Points points", () => {
  it("1,000 L Luxury in Oct = 30,000 points (base 14 + bonus 16)", () => {
    const p = calculatePoints(SP_Q3, spMetrics(0, {}, { "2026-10": { LUXURY: 1000 } }));
    expect(p.byCategory.LUXURY).toBe(30000);
    expect(p.total).toBe(30000);
  });

  it("Nov and Dec use base only while bonus is 0 (config default)", () => {
    const p = calculatePoints(SP_Q3, spMetrics(0, {}, { "2026-11": { LUXURY: 1000, OTHERS: 3 }, "2026-12": { PREMIUM: 10 } }));
    expect(p.byCategory).toMatchObject({ LUXURY: 14000, OTHERS: 7.5, PREMIUM: 60 });
    expect(p.total).toBe(14067.5);
  });

  it("tools: 29,999 GSR → 400 points; 30,000 → 800; negative → 0", () => {
    expect(calculatePoints(SP_Q3, spMetrics(0, {}, {}, { "2026-10": 29999 })).tools).toBe(400);
    expect(calculatePoints(SP_Q3, spMetrics(0, {}, {}, { "2026-10": 15000, "2026-11": 15000 })).tools).toBe(800);
    expect(calculatePoints(SP_Q3, spMetrics(0, {}, {}, { "2026-10": 14999.99 })).tools).toBe(0);
    expect(calculatePoints(SP_Q3, spMetrics(0, {}, {}, { "2026-10": 10000, "2027-01": -20000 })).tools).toBe(0);
  });

  it("tools floor is on the period total incl. return window", () => {
    expect(calculatePoints(SP_Q3, spMetrics(0, {}, {}, { "2026-10": 30000, "2027-01": -0.01 })).tools).toBe(400);
  });

  it("return-window litres use the last period month's bonus", () => {
    const cfg = withRule(SP_Q3, {
      starPoints: {
        ...SP_Q3.starPoints!,
        bonusPerLitre: { ...SP_Q3.starPoints!.bonusPerLitre, "2026-12": { LUXURY: 5 } },
      },
    });
    const p = calculatePoints(cfg, spMetrics(0, {}, { "2026-12": { LUXURY: 1000 }, "2027-01": { LUXURY: -100 } }));
    expect(p.byCategory.LUXURY).toBe(19000 - 1900);
  });
});

describe("Star Points growth (10%) boundary", () => {
  const litres = { "2026-10": { LUXURY: 3000 } }; // 90,000 points → Slab 1 by points

  it("Q1 1,000,000, Q3 1,100,000 → met → Slab 1", () => {
    const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(1_000_000, { "2026-10": 1_100_000 }, litres), OPTS);
    expect(s.current_slab).toBe("Slab 1");
    expect(metric(s, "growth_pct")).toBe(10);
    expect(metric(s, "q3_gsr")).toBe(1_100_000);
    expect(metric(s, "points_earned")).toBe(90000);
    expect(s.details![0].gift).toEqual({ description: "Gold Voucher ₹65,000 (Jeweller A / Jeweller B)", value: 65000 });
  });

  it("Q3 1,099,999.99 → not met → no slab", () => {
    const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(1_000_000, { "2026-10": 1_099_999.99 }, litres), OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
    expect(s.extra_benefits).toEqual([]);
  });

  it("return window GSR counts in Q3 and is deducted from Dec", () => {
    const s = evaluateDealerScheme(
      SP_Q3,
      dealer(),
      spMetrics(1_000_000, { "2026-10": 600_000, "2026-12": 500_000, "2027-01": -1 }, litres),
      OPTS,
    );
    expect(metric(s, "dec_gsr")).toBe(499_999);
    expect(metric(s, "q3_gsr")).toBe(1_099_999);
    expect(s.current_slab).toBeNull();
  });

  it("a fractional shortfall does not unlock a slab: 33,999.998 L Others in Oct = 84,999.995 points", () => {
    const m = spMetrics(1_000_000, { "2026-10": 2_000_000 }, { "2026-10": { OTHERS: 33_999.998 } });
    const p = calculatePoints(SP_Q3, m);
    expect(p.totalHundredths).toBe(8_499_999);
    expect(p.total).toBe(84_999.99);
    const s = evaluateDealerScheme(SP_Q3, dealer(), m, OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_POINTS_NOT_MET");
    expect(s.details![0].conditions.find((c) => c.key === "points")).toMatchObject({ required: 85_000, actual: 84_999.99, met: false });
    // 34,000 L exactly → 85,000 points → Slab 1.
    const exact = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(1_000_000, { "2026-10": 2_000_000 }, { "2026-10": { OTHERS: 34_000 } }), OPTS);
    expect(exact.current_slab_no).toBe(1);
  });

  describe("GSR still needed for growth", () => {
    it("is 0 when the growth is met (Q3 1,100,000 over Q1 1,000,000); growth_pct stays, before the new metric", () => {
      const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(1_000_000, { "2026-10": 1_100_000 }, litres), OPTS);
      const keys = s.header!.metrics.map((x) => x.key);
      expect(keys.slice(0, 8)).toEqual([
        "oct_gsr", "nov_gsr", "dec_gsr", "q3_gsr", "growth_pct", "growth_gsr_required", "growth_gsr_needed", "points_earned",
      ]);
      expect(s.header!.metrics.find((x) => x.key === "growth_gsr_required")).toEqual({
        key: "growth_gsr_required",
        label: "GSR required for 10% growth",
        value: 1_100_000,
        unit: "INR",
      });
      expect(s.header!.metrics.find((x) => x.key === "growth_pct")).toEqual({ key: "growth_pct", label: "Growth", value: 10, unit: "PERCENT" });
      expect(s.header!.metrics.find((x) => x.key === "growth_gsr_needed")).toEqual({
        key: "growth_gsr_needed",
        label: "GSR still needed for 10% growth",
        value: 0,
        unit: "INR",
      });
    });

    it("is the exact gap in paise: Q3 1,099,999.99 → 0.01 more", () => {
      const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(1_000_000, { "2026-10": 1_099_999.99 }, litres), OPTS);
      expect(metric(s, "growth_gsr_needed")).toBe(0.01);
    });

    it("mid-quarter: Oct only, Q1 82,70,134.47 and Q3 70,35,893 → 20,61,254.92 more (rounded up to the paisa)", () => {
      const total = { "2026-04": 4_398_973.49, "2026-05": 1_403_524.76, "2026-06": 2_467_636.22, "2026-10": 7_035_893 };
      const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(0, {}, litres, {}, total), OPTS);
      expect(metric(s, "growth_pct")).toBe(-14.93);
      expect(metric(s, "growth_gsr_required")).toBe(9_097_147.92);
      expect(metric(s, "growth_gsr_needed")).toBe(2_061_254.92);
      expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
    });
  });

  it("zero Q1 GSR (no total data) → growth not met → no slab", () => {
    const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(0, { "2026-10": 2_000_000 }, litres), OPTS);
    expect(s.header!.metrics.some((x) => x.key === "growth_gsr_needed" || x.key === "growth_gsr_required")).toBe(false);
    expect(metric(s, "growth_pct")).toBeNull();
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
  });

  describe("growth on total GSR of all products (BA, 19-10-2026)", () => {
    // BA example: Q1 ₹10 L total (₹4 L Table III), Q3 ₹12 L total (₹5 L Table III).
    const total = { "2026-04": 1_000_000, "2026-10": 1_200_000 };

    it("uses total GSR: 12 L over 10 L = 20% → met → Slab 1", () => {
      const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(400_000, { "2026-10": 500_000 }, litres, {}, total), OPTS);
      expect(metric(s, "growth_pct")).toBe(20);
      expect(metric(s, "q3_gsr")).toBe(1_200_000);
      expect(s.header!.q1_monthly_avg_gsr).toBeCloseTo(333_333.33, 2);
      expect(s.current_slab).toBe("Slab 1");
      expect(s.details![0].conditions.find((c) => c.key === "growth_pct")!.label).toBe("Growth over Q1 FY 2026-27 GSR (all products)");
    });

    it("Table III growth is not used: Table III up 25% but total only up 5% → not met", () => {
      const m = spMetrics(400_000, { "2026-10": 500_000 }, litres, {}, { "2026-04": 1_000_000, "2026-10": 1_050_000 });
      expect(evaluateDealerScheme(SP_Q3, dealer(), m, OPTS).reason_code).toBe("SLAB1_GROWTH_NOT_MET");
    });

    it("no Table III sales in Q1 but other Q1 sales → growth from the total, eligible", () => {
      const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(0, { "2026-10": 500_000 }, litres, {}, total), OPTS);
      expect(s.current_slab).toBe("Slab 1");
    });

    it("no Q1 sales of any product → not eligible", () => {
      const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(0, { "2026-10": 500_000 }, litres, {}, { "2026-10": 1_200_000 }), OPTS);
      expect(metric(s, "growth_pct")).toBeNull();
      expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
    });

    it("SCHEME_PRODUCTS basis keeps the old Table III comparison", () => {
      const cfg = withRule(SP_Q3, { growthGsrBasis: "SCHEME_PRODUCTS" });
      const m = spMetrics(400_000, { "2026-10": 500_000 }, litres, {}, { "2026-04": 1_000_000, "2026-10": 1_050_000 });
      expect(metric(evaluateDealerScheme(cfg, dealer(), m, OPTS), "growth_pct")).toBe(25);
    });
  });

  it("points below Slab 1 → SLAB1_POINTS_NOT_MET", () => {
    const s = evaluateDealerScheme(SP_Q3, dealer(), spMetrics(1_000_000, { "2026-10": 2_000_000 }, { "2026-10": { LUXURY: 2833 } }), OPTS);
    expect(metric(s, "points_earned")).toBe(84990);
    expect(s.reason_code).toBe("SLAB1_POINTS_NOT_MET");
  });
});

describe("Star Points Slab 7 and extra benefits", () => {
  // 14,000 L Luxury in Oct = 420,000 + tools 600,000 GSR = 40 × 400 = 16,000 → 436,000 points.
  const m = spMetrics(1_000_000, { "2026-10": 1_100_000 }, { "2026-10": { LUXURY: 14000 } }, { "2026-10": 600_000 });

  it("is in Slab 7 with both extra-benefit rules", () => {
    const s = evaluateDealerScheme(SP_Q3, dealer(), m, OPTS);
    expect(metric(s, "points_earned")).toBe(436000);
    expect(metric(s, "points_tools")).toBe(16000);
    expect(s.current_slab).toBe("Slab 7");
    expect(s.details!.map((d) => d.lock_status)).toEqual(["LOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED", "UNLOCKED"]);
    expect(s.details![6].gift.value).toBeNull();
    expect(s.extra_benefits).toEqual([
      // beyond 217,000: 219,000 → 2 cruise tickets (2 × 78,000) or 8 × 18,500 CN
      { description: SP_Q3.starPoints!.extraBenefits[0].tripDescription, destination: "CRUISE", extra_tickets: 2, extra_ticket_cn_value: 156000, cn_option_value: 148000 },
      // beyond 225,000: 211,000 → 1 Overseas Tour ticket (162,000) or 8 × 18,500 CN
      { description: SP_Q3.starPoints!.extraBenefits[1].tripDescription, destination: "OVERSEAS", extra_tickets: 1, extra_ticket_cn_value: 162000, cn_option_value: 148000 },
    ]);
  });

  it("Slab 6 dealer gets only the Slab 6 rule", () => {
    // 220,000 points: 7,000 L Luxury Oct = 210,000 + tools 375,000 GSR = 25 × 400 = 10,000.
    const m6 = spMetrics(1_000_000, { "2026-10": 1_100_000 }, { "2026-10": { LUXURY: 7000 } }, { "2026-10": 375_000 });
    const s = evaluateDealerScheme(SP_Q3, dealer(), m6, OPTS);
    expect(s.current_slab).toBe("Slab 6");
    // 3,000 points beyond 217,000: no ticket, no CN step → no entries
    expect(s.extra_benefits).toEqual([]);
  });
});
