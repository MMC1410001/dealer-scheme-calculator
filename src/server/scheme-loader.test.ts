import { describe, expect, it } from "vitest";
import { CHANNELS, FB_EXCLUSIONS, SP_TOOLS_PRODUCT_CODES, SCHEME_CHANNELS, SCHEME_TAGS, SCHEMES } from "@/config/schemes";
import { buildGtProductRows, buildScopeRules, buildSlabRows } from "./scheme-loader";

const inputs = { schemeChannels: SCHEME_CHANNELS, fbExclusions: FB_EXCLUSIONS, institutionalChannel: CHANNELS.INSTITUTIONAL };
const byTag = (tag: string) => {
  const s = SCHEMES.find((x) => x.tag === tag);
  if (!s) throw new Error(`no scheme ${tag}`);
  return s;
};

/** Number of filled value columns in a scope row (template v3.0: one value per cell). */
const filled = (r: Record<string, unknown>) =>
  ["channel", "zone", "region", "area", "depot", "productCode", "skuCode", "productCategory", "productGroup"].filter(
    (k) => r[k] !== null,
  ).length;

describe("buildScopeRules", () => {
  it("FB-PAN: channel INCLUDE rows, region EXCLUDE rows, product EXCLUDE rows, one value per row", () => {
    const rows = buildScopeRules(byTag(SCHEME_TAGS.festiveBonanzaPan), inputs);
    const inc = rows.filter((r) => r.ruleType === "INCLUDE");
    expect(inc.map((r) => r.channel)).toEqual([CHANNELS.TRADE, CHANNELS.FRANCHISE]);
    const regions = rows.filter((r) => r.region !== null);
    expect(regions.every((r) => r.ruleType === "EXCLUDE")).toBe(true);
    expect(regions.map((r) => r.region).sort()).toEqual(["HP & JK", "TN North", "TN South"]);
    expect(rows.filter((r) => r.productCategory).map((r) => r.productCategory)).toEqual(FB_EXCLUSIONS.categoryNames);
    expect(rows.filter((r) => r.productGroup).map((r) => r.productGroup)).toEqual(FB_EXCLUSIONS.productGroups);
    expect(rows.filter((r) => r.productCode).map((r) => r.productCode)).toEqual(FB_EXCLUSIONS.productCodes);
    expect(rows.filter((r) => r.productCode || r.productCategory || r.productGroup).every((r) => r.ruleType === "EXCLUDE")).toBe(true);
    expect(rows.every((r) => filled(r as unknown as Record<string, unknown>) === 1)).toBe(true);
    expect(rows).toHaveLength(2 + 3 + FB_EXCLUSIONS.categoryNames.length + FB_EXCLUSIONS.productGroups.length + FB_EXCLUSIONS.productCodes.length);
  });

  it("FB-TNHPJK: region INCLUDE rows (HP and JK map to one region value)", () => {
    const rows = buildScopeRules(byTag(SCHEME_TAGS.festiveBonanzaTnHpJk), inputs);
    const regions = rows.filter((r) => r.region !== null);
    expect(regions.every((r) => r.ruleType === "INCLUDE")).toBe(true);
    expect(regions).toHaveLength(3);
  });

  it("SP-Q3: Pan India (no region rows), 3 channels, no product exclusions, Channel 12 remark", () => {
    const rows = buildScopeRules(byTag(SCHEME_TAGS.starPoints), inputs);
    expect(rows.map((r) => r.channel)).toEqual([CHANNELS.TRADE, CHANNELS.FRANCHISE, CHANNELS.INSTITUTIONAL]);
    expect(rows.every((r) => r.ruleType === "INCLUDE" && r.region === null && r.productCode === null)).toBe(true);
    expect(rows.find((r) => r.channel === CHANNELS.INSTITUTIONAL)?.remarks).toMatch(/channel12_eligible/);
  });
});

describe("buildSlabRows", () => {
  it("stores INR amounts as numeric strings and null for trip gift values", () => {
    const dm = buildSlabRows(byTag(SCHEME_TAGS.festiveBonanzaPan));
    expect(dm[0]).toMatchObject({ slabNo: 1, periodGsrRequired: "250000", minFirstMonthGsr: "100000", growthPct: "20", giftValue: "5000", cnAlternative: "4500" });
    expect(buildSlabRows(byTag(SCHEME_TAGS.festiveBonanzaTnHpJk))[0].growthPct).toBeNull();
    const gt = buildSlabRows(byTag(SCHEME_TAGS.starPoints));
    expect(gt[1]).toMatchObject({ slabNo: 2, pointsRequired: "110400", giftValue: null, cnAlternative: "78000" });
  });
});

describe("buildGtProductRows", () => {
  it("adds tools as TOOLS, one row per product code, Table III wins", () => {
    const rows = buildGtProductRows(
      "SP-Q3",
      [
        { productCode: "100001", productName: "P1", productCategory: "Interior Emulsions", brand: "One", starCategory: "LUXURY", channel12Eligible: true },
        { productCode: "100001", productName: "dup", productCategory: "", brand: "", starCategory: "OTHERS", channel12Eligible: false },
        { productCode: SP_TOOLS_PRODUCT_CODES[0], productName: "P2", productCategory: "X", brand: "", starCategory: "OTHERS", channel12Eligible: false },
      ],
      SP_TOOLS_PRODUCT_CODES,
    );
    expect(rows).toHaveLength(1 + SP_TOOLS_PRODUCT_CODES.length);
    expect(rows[0]).toMatchObject({ productCode: "100001", productName: "P1", starCategory: "LUXURY", channel12Eligible: true });
    expect(rows.find((r) => r.productCode === SP_TOOLS_PRODUCT_CODES[0])?.starCategory).toBe("OTHERS");
    expect(rows.filter((r) => r.starCategory === "TOOLS")).toHaveLength(SP_TOOLS_PRODUCT_CODES.length - 1);
    expect(rows.find((r) => r.starCategory === "TOOLS")?.brand).toBeNull();
  });
});
