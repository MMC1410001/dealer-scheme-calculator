import { describe, expect, it } from "vitest";
import { evaluateDealerScheme } from "./index";
import { FB_PAN, FB_TNHPJK, OPTS, dealer, fbMetrics, withRule } from "./test-helpers";

const TN = dealer({ regionName: "TN North" });

describe("Festive Bonanza FB-PAN – circular example", () => {
  it("Q1 4.5L, Oct 1.6L + Nov 2.0L = 3.6L → Slab 1, ₹5,000 / CN ₹4,500", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(450000, 160000, 200000), OPTS);
    expect(s.participation).toBe("IN_SCHEME");
    expect(s.current_slab).toBe("Slab 1");
    expect(s.current_slab_no).toBe(1);
    expect(s.header?.q1_monthly_avg_gsr).toBe(150000);
    const slab1 = s.details![0];
    expect(slab1.lock_status).toBe("UNLOCKED");
    expect(slab1.gift).toEqual({ description: "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", value: 5000 });
    expect(slab1.cn_alternative).toBe(4500);
    expect(slab1.conditions).toEqual([
      { key: "period_gsr", label: "GSR Oct + Nov'26", required: 250000, actual: 360000, met: true },
      { key: "min_first_month_gsr", label: "Min GSR in Oct'26", required: 100000, actual: 160000, met: true },
      { key: "growth_pct", label: "Growth over Q1 monthly avg", required: 20, actual: 20, met: true },
    ]);
    expect(s.details!.slice(1).every((d) => d.lock_status === "LOCKED")).toBe(true);
    const metrics = Object.fromEntries(s.header!.metrics.map((m) => [m.key, m.value]));
    expect(metrics).toMatchObject({ oct_gsr: 160000, nov_gsr: 200000, period_gsr: 360000, growth_pct: 20 });
    expect(metrics.mrv_total).toBeUndefined();
  });

  it("growth 19.995 % → not met, and the actual shows 19.99 (never equal to the required 20)", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(300000, 100000, 139990), OPTS);
    const g = s.details![0].conditions.find((c) => c.key === "growth_pct")!;
    expect(g).toEqual({ key: "growth_pct", label: "Growth over Q1 monthly avg", required: 20, actual: 19.99, met: false });
    expect(s.current_slab).toBeNull();
  });

  it("Nov 1.99L → no slab, growth fails", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(450000, 160000, 199000), OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.current_slab_no).toBeNull();
    expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
    expect(s.details!.every((d) => d.lock_status === "LOCKED")).toBe(true);
  });

  it("Min Oct GSR fails → no slab", () => {
    const s = evaluateDealerScheme(FB_TNHPJK, TN, fbMetrics(0, 99999.99, 300000), OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_MIN_FIRST_MONTH_GSR_NOT_MET");
  });

  it("Period GSR fails → reason SLAB1_PERIOD_GSR_NOT_MET", () => {
    const s = evaluateDealerScheme(FB_TNHPJK, TN, fbMetrics(0, 100000, 149999.99), OPTS);
    expect(s.reason_code).toBe("SLAB1_PERIOD_GSR_NOT_MET");
  });
});

describe("Festive Bonanza FB-TNHPJK – no growth condition", () => {
  it("has no growth_pct condition and ignores a fall from Q1", () => {
    const s = evaluateDealerScheme(FB_TNHPJK, TN, fbMetrics(3_000_000, 160000, 200000), OPTS);
    expect(s.current_slab).toBe("Slab 1");
    for (const d of s.details!) expect(d.conditions.map((c) => c.key)).toEqual(["period_gsr", "min_first_month_gsr"]);
  });
});

describe("CLAUDE.md section 11 – lower growth % in higher slabs", () => {
  // Oct 3L + Nov 3.5L = 6.5L → avg 3.25L. Q1 = 833,333 → avg 277,777.67 → growth 17.00%.
  const m = fbMetrics(833333, 300000, 350000);

  it("growth is 17%", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), m, OPTS);
    expect(s.header!.metrics.find((x) => x.key === "growth_pct")!.value).toBe(17);
  });

  it("STOP_AT_FIRST_FAIL → no slab", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), m, OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
  });

  it("HIGHEST_ALL_MET → Slab 3", () => {
    const s = evaluateDealerScheme(withRule(FB_PAN, { classificationRule: "HIGHEST_ALL_MET" }), dealer(), m, OPTS);
    expect(s.current_slab).toBe("Slab 3");
    expect(s.details!.map((d) => d.lock_status)).toEqual([
      "LOCKED", "LOCKED", "UNLOCKED", "LOCKED", "LOCKED", "LOCKED", "LOCKED",
    ]);
  });
});

describe("Festive Bonanza GSR required and still needed for growth (extra metrics; growth_pct stays)", () => {
  const keys = (s: ReturnType<typeof evaluateDealerScheme>) => s.header!.metrics.map((m) => m.key);
  const values = (s: ReturnType<typeof evaluateDealerScheme>) => Object.fromEntries(s.header!.metrics.map((m) => [m.key, m.value]));

  it("circular example (exactly 20%) → 0 needed; growth_pct is still there, before the new metric", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(450000, 160000, 200000), OPTS);
    expect(keys(s)).toEqual(["oct_gsr", "nov_gsr", "period_gsr", "growth_pct", "growth_gsr_required", "growth_gsr_needed"]);
    expect(s.header!.metrics.find((m) => m.key === "growth_gsr_required")).toEqual({
      key: "growth_gsr_required",
      label: "GSR required for 20% growth",
      value: 360000,
      unit: "INR",
    });
    expect(s.header!.metrics.find((m) => m.key === "growth_pct")).toEqual({ key: "growth_pct", label: "Growth", value: 20, unit: "PERCENT" });
    expect(s.header!.metrics.find((m) => m.key === "growth_gsr_needed")).toEqual({
      key: "growth_gsr_needed",
      label: "GSR still needed for 20% growth",
      value: 0,
      unit: "INR",
    });
  });

  it("Nov 1.99L → ₹1,000 more for Oct + Nov (target 3.6L = Q1 4.5L ÷ 3 × 2 × 1.20)", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(450000, 160000, 199000), OPTS);
    expect(values(s)).toMatchObject({ growth_pct: 19.66, growth_gsr_required: 360000, growth_gsr_needed: 1000 });
  });

  it("Oct only (Nov 0) counts Nov as 0: Q1 4.5L, Oct 1.6L → 2.0L more", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(450000, 160000, 0), OPTS);
    expect(values(s)).toMatchObject({ growth_pct: -46.67, growth_gsr_required: 360000, growth_gsr_needed: 200000 });
  });

  it("FB-TNHPJK has no growth condition → no metric; growth_pct is still shown", () => {
    const s = evaluateDealerScheme(FB_TNHPJK, TN, fbMetrics(450000, 160000, 200000), OPTS);
    expect(keys(s)).toEqual(["oct_gsr", "nov_gsr", "period_gsr", "growth_pct"]);
  });

  it("zero Q1 base → no metric", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(0, 160000, 200000), OPTS);
    expect(keys(s)).not.toContain("growth_gsr_needed");
    expect(keys(s)).not.toContain("growth_gsr_required");
  });
});

describe("Return window (material returns after the end date)", () => {
  it("deducts Dec returns from Nov and the period total; Oct minimum uses Oct only", () => {
    const m = fbMetrics(0, 100000, 300000, {
      gsrByMonth: { "2026-12": -50000 },
      mrvByMonth: { "2026-12": -50000 },
    });
    const s = evaluateDealerScheme(FB_TNHPJK, TN, m, OPTS);
    const metrics = Object.fromEntries(s.header!.metrics.map((x) => [x.key, x.value]));
    expect(metrics).toMatchObject({ oct_gsr: 100000, nov_gsr: 250000, period_gsr: 350000, mrv_total: -50000 });
    expect(s.current_slab).toBe("Slab 1");
    expect(s.details![0].conditions[1]).toMatchObject({ key: "min_first_month_gsr", actual: 100000, met: true });
  });

  it("a return can push the dealer below a slab", () => {
    const m = fbMetrics(450000, 160000, 200000, { gsrByMonth: { "2026-12": -0.01 } });
    const s = evaluateDealerScheme(FB_PAN, dealer(), m, OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
  });
});

describe("Zero base (no Q1 sales)", () => {
  it("no Q1 sales of any product (config MET_IF_ANY_BASE_SALES) → no slab, growth actual null", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), fbMetrics(0, 160000, 200000), OPTS);
    expect(s.current_slab).toBeNull();
    expect(s.reason_code).toBe("SLAB1_GROWTH_NOT_MET");
    const g = s.details![0].conditions.find((c) => c.key === "growth_pct")!;
    expect(g.actual).toBeNull();
    expect(g.met).toBe(false);
    expect(s.header!.q1_monthly_avg_gsr).toBe(0);
  });

  it("Q1 sales only of excluded products (scheme Q1 = 0, total Q1 > 0) → growth met → Slab 1", () => {
    const m = fbMetrics(0, 160000, 200000, { totalGsrByMonth: { "2026-04": 50000, "2026-10": 160000, "2026-11": 200000 } });
    const s = evaluateDealerScheme(FB_PAN, dealer(), m, OPTS);
    expect(s.current_slab).toBe("Slab 1");
    expect(s.details![0].conditions.find((c) => c.key === "growth_pct")).toMatchObject({ actual: null, met: true });
  });

  it("total Q1 present but zero → still not eligible", () => {
    const m = fbMetrics(0, 160000, 200000, { totalGsrByMonth: { "2026-04": 0, "2026-10": 160000 } });
    expect(evaluateDealerScheme(FB_PAN, dealer(), m, OPTS).reason_code).toBe("SLAB1_GROWTH_NOT_MET");
  });

  it("zeroBaseGrowthRule NOT_MET → no slab even with other Q1 sales", () => {
    const m = fbMetrics(0, 160000, 200000, { totalGsrByMonth: { "2026-04": 50000 } });
    expect(evaluateDealerScheme(withRule(FB_PAN, { zeroBaseGrowthRule: "NOT_MET" }), dealer(), m, OPTS).current_slab).toBeNull();
  });

  it("zeroBaseGrowthRule MET → growth met → Slab 1", () => {
    const s = evaluateDealerScheme(withRule(FB_PAN, { zeroBaseGrowthRule: "MET" }), dealer(), fbMetrics(0, 160000, 200000), OPTS);
    expect(s.current_slab).toBe("Slab 1");
  });

  it("FB-TNHPJK (no growth condition) is not affected", () => {
    const s = evaluateDealerScheme(FB_TNHPJK, TN, fbMetrics(0, 160000, 200000), OPTS);
    expect(s.current_slab).toBe("Slab 1");
  });
});
