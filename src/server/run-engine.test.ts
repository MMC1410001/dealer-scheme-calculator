import { describe, expect, it } from "vitest";
import { addMetric, emptyMetrics, groupMetrics, todayInKolkata, toResultRow, type MetricRow } from "./run-engine";

describe("groupMetrics", () => {
  it("groups rows by dealer and scheme into DealerSchemeMetrics", () => {
    const rows: MetricRow[] = [
      { dealerCode: "D1", schemeTag: "FB-PAN", metric: "gsr", month: "2026-10", value: 160000 },
      { dealerCode: "D1", schemeTag: "FB-PAN", metric: "gsr", month: "2026-11", value: 200000 },
      { dealerCode: "D1", schemeTag: "FB-PAN", metric: "mrv", month: "2026-12", value: -5000 },
      { dealerCode: "D1", schemeTag: "SP-Q3", metric: "litres_LUXURY", month: "2026-10", value: 100 },
      { dealerCode: "D1", schemeTag: "SP-Q3", metric: "litres_PREMIUM", month: "2026-10", value: 50 },
      { dealerCode: "D1", schemeTag: "SP-Q3", metric: "tools_gsr", month: "2026-11", value: 30000 },
      { dealerCode: "D2", schemeTag: "FB-PAN", metric: "gsr", month: "2026-04", value: 1 },
    ];
    const g = groupMetrics(rows);
    expect([...g.keys()].sort()).toEqual(["D1", "D2"]);
    expect(g.get("D1")?.get("FB-PAN")).toEqual({
      gsrByMonth: { "2026-10": 160000, "2026-11": 200000 },
      mrvByMonth: { "2026-12": -5000 },
    });
    expect(g.get("D1")?.get("SP-Q3")).toEqual({
      gsrByMonth: {},
      mrvByMonth: {},
      litresByMonth: { "2026-10": { LUXURY: 100, PREMIUM: 50 } },
      toolsGsrByMonth: { "2026-11": 30000 },
    });
    expect(g.get("D2")?.get("SP-Q3")).toBeUndefined();
  });

  it("sums duplicate dealer x scheme x metric x month rows", () => {
    const g = groupMetrics([
      { dealerCode: "D1", schemeTag: "FB-PAN", metric: "gsr", month: "2026-10", value: 100 },
      { dealerCode: "D1", schemeTag: "FB-PAN", metric: "gsr", month: "2026-10", value: 50.5 },
    ]);
    expect(g.get("D1")?.get("FB-PAN")?.gsrByMonth["2026-10"]).toBe(150.5);
  });

  it("reads total_gsr into totalGsrByMonth", () => {
    const m = emptyMetrics();
    expect(addMetric(m, "total_gsr", "2026-04", 500)).toBe(true);
    expect(addMetric(m, "total_gsr", "2026-04", 25)).toBe(true);
    expect(m.totalGsrByMonth).toEqual({ "2026-04": 525 });
  });

  it("accepts lower-case category suffix and ignores unknown metrics and non-finite values", () => {
    const m = emptyMetrics();
    expect(addMetric(m, "litres_luxury", "2026-10", 10)).toBe(true);
    expect(addMetric(m, "litres_TOOLS", "2026-10", 10)).toBe(false);
    expect(addMetric(m, "foo", "2026-10", 10)).toBe(false);
    expect(addMetric(m, "gsr", "2026-10", Number.NaN)).toBe(false);
    expect(m).toEqual({ gsrByMonth: {}, mrvByMonth: {}, litresByMonth: { "2026-10": { LUXURY: 10 } } });
  });
});

describe("todayInKolkata", () => {
  it("uses the India date (UTC+05:30)", () => {
    expect(todayInKolkata(new Date("2026-10-15T18:29:59Z"))).toBe("2026-10-15");
    expect(todayInKolkata(new Date("2026-10-15T18:30:00Z"))).toBe("2026-10-16");
  });
});

describe("toResultRow", () => {
  it("maps a SchemeStatus to result columns", () => {
    const row = toResultRow(
      "D1",
      { scheme_tag: "FB-PAN", participation: "IN_SCHEME", current_slab_no: 2, benefit_blocked: true, provisional: false, reason_code: "OD_ON_CHECK_DATE" },
      7,
    );
    expect(row).toMatchObject({
      dealerCode: "D1",
      schemeTag: "FB-PAN",
      participation: "IN_SCHEME",
      currentSlabNo: 2,
      benefitBlocked: true,
      provisional: false,
      reasonCode: "OD_ON_CHECK_DATE",
      syncRunId: 7,
    });
    const notIn = toResultRow("D2", { scheme_tag: "FB-TNHPJK", participation: "NOT_IN_SCOPE", reason_code: "NO_DATA" }, null);
    expect(notIn).toMatchObject({ currentSlabNo: null, benefitBlocked: false, reasonCode: "NO_DATA", syncRunId: null });
  });
});
