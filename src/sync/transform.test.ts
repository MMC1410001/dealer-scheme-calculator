import { describe, expect, it } from "vitest";
import { SP_PRODUCTS, SP_PRODUCT_BY_CODE, isChannel12Eligible } from "@/config/star-points-products";
import { FB_EXCLUSIONS, SP_TOOLS_PRODUCT_CODES } from "@/config/schemes";
import {
  fbRowsToMetrics,
  spProductParams,
  spRowsToMetrics,
  maxBillDate,
  scopeFromRules,
  splitGtChannels,
  type ScopeRuleLike,
} from "./transform";

const rule = (r: Partial<ScopeRuleLike>): ScopeRuleLike => ({
  ruleType: "INCLUDE",
  channel: null,
  zone: null,
  region: null,
  area: null,
  depot: null,
  productCode: null,
  skuCode: null,
  productCategory: null,
  productGroup: null,
  ...r,
});

describe("scopeFromRules", () => {
  it("reads channels and exclusions, ignores region rules", () => {
    const s = scopeFromRules([
      rule({ channel: "21" }),
      rule({ channel: "11" }),
      rule({ ruleType: "EXCLUDE", region: "TN North" }),
      rule({ ruleType: "EXCLUDE", productCategory: "Colorants" }),
      rule({ ruleType: "EXCLUDE", productGroup: "DISTEMPER" }),
      rule({ ruleType: "EXCLUDE", productCode: "930001" }),
    ]);
    expect(s).toEqual({
      channels: ["11", "21"],
      excludedCodes: ["930001"],
      excludedCategories: ["Colorants"],
      excludedGroups: ["DISTEMPER"],
      unsupported: [],
    });
  });
  it("flags rules the sync cannot apply", () => {
    const s = scopeFromRules([rule({ ruleType: "EXCLUDE", region: "Maharashtra North", depot: "1105" }), rule({ skuCode: "X" })]);
    expect(s.unsupported).toHaveLength(2);
  });
});

describe("Star Points products (Table III)", () => {
  it("has one row per code and the circular counts (+ EV50 matched from the master)", () => {
    expect(SP_PRODUCT_BY_CODE.size).toBe(SP_PRODUCTS.length);
    const count = (c: string) => SP_PRODUCTS.filter((p) => p.starCategory === c).length;
    expect(count("LUXURY")).toBe(158);
    expect(count("PREMIUM")).toBe(24);
    expect(count("ECONOMY")).toBe(29);
    expect(count("ENAMELS")).toBe(16);
    expect(count("OTHERS")).toBe(15);
    expect(SP_PRODUCT_BY_CODE.get("917052")?.productName).toBe("EV50");
    for (const p of SP_PRODUCTS) expect(p.productCode).toMatch(/^\d{6}$/);
  });
  it("no tools code overlaps Table III", () => {
    for (const c of SP_TOOLS_PRODUCT_CODES) expect(SP_PRODUCT_BY_CODE.has(c)).toBe(false);
  });
  it("Channel 12: One emulsion topcoats only (no putty, primer, wallpaper, Prime)", () => {
    expect(isChannel12Eligible({ productName: "Pure Elegance", productCategory: "Interior Emulsions", brand: "One" })).toBe(true);
    expect(SP_PRODUCT_BY_CODE.get("941006")?.channel12Eligible).toBe(false); // Pro Smooth Putty
    expect(SP_PRODUCT_BY_CODE.get("941005")?.channel12Eligible).toBe(false); // Pro Smooth Primer
    expect(SP_PRODUCT_BY_CODE.get("960004")?.channel12Eligible).toBe(false); // Aerosol (Enamel)
    expect(SP_PRODUCT_BY_CODE.get("916070")?.channel12Eligible).toBe(false); // Prime E70
    expect(SP_PRODUCTS.filter((p) => p.channel12Eligible)).toHaveLength(22);
  });
  it("Style Aluminium Paint (FB exclusion) is not a Table III product", () => {
    // Style Aluminium Paint 962006 is not in Table III (Lumina Aluminium Paint 961006 is).
    expect(SP_PRODUCT_BY_CODE.has(FB_EXCLUSIONS.productCodes[0])).toBe(false);
  });
});

describe("spProductParams / splitGtChannels", () => {
  it("one entry per code, sorted", () => {
    const p = spProductParams([
      { productCode: "972200", starCategory: "TOOLS", channel12Eligible: false },
      { productCode: "940001", starCategory: "luxury", channel12Eligible: true },
      { productCode: "940001", starCategory: "PREMIUM", channel12Eligible: false },
    ]);
    expect(p).toEqual([
      { code: "940001", cat: "LUXURY", ch12: true },
      { code: "972200", cat: "TOOLS", ch12: false },
    ]);
  });
  it("splits Channel 12 off", () => {
    expect(splitGtChannels(["11", "21", "12"], ["12"])).toEqual({ fullChannels: ["11", "21"], restrictedChannels: ["12"] });
  });
});

describe("rows -> metrics", () => {
  it("Festive Bonanza rows go to every tag; zero values are skipped", () => {
    const m = fbRowsToMetrics(
      [
        { dealer_code: "D1", month: "2026-04", gsr: "100.50", total_gsr: "150", mrv: "0", max_bill_date: null, line_count: 2 },
        { dealer_code: "D1", month: "2026-10", gsr: "90", total_gsr: "90", mrv: "-10", max_bill_date: "2026-10-15", line_count: 3 },
        { dealer_code: "D1", month: "bad", gsr: "1", total_gsr: "1", mrv: "0", max_bill_date: null, line_count: 1 },
      ],
      ["FB-PAN", "FB-TNHPJK"],
      7,
    );
    expect(m).toHaveLength(10);
    expect(m.filter((x) => x.schemeTag === "FB-TNHPJK").map((x) => [x.metric, x.month, x.value])).toEqual([
      ["gsr", "2026-04", "100.50"],
      ["total_gsr", "2026-04", "150"],
      ["gsr", "2026-10", "90"],
      ["total_gsr", "2026-10", "90"],
      ["mrv", "2026-10", "-10"],
    ]);
    expect(m.every((x) => x.syncRunId === 7)).toBe(true);
  });
  it("Star Points rows give litres per category and tools GSR", () => {
    const m = spRowsToMetrics(
      [
        {
          dealer_code: "D2",
          month: "2026-10",
          gsr: "1000",
          total_gsr: "2500",
          mrv: "0",
          tools_gsr: "15000",
          litres_LUXURY: "10.5",
          litres_PREMIUM: "0",
          litres_ECONOMY: "0",
          litres_ENAMELS: "2",
          litres_OTHERS: "0",
          max_bill_date: "2026-10-12",
          line_count: 4,
        },
      ],
      "SP-Q3",
      null,
    );
    expect(m.map((x) => x.metric).sort()).toEqual(["gsr", "litres_ENAMELS", "litres_LUXURY", "tools_gsr", "total_gsr"]);
  });
  it("maxBillDate", () => {
    expect(maxBillDate([{ max_bill_date: null }, { max_bill_date: "2026-10-12" }, { max_bill_date: "2026-10-15" }])).toBe("2026-10-15");
    expect(maxBillDate([])).toBeNull();
  });
});
