import { describe, expect, it } from "vitest";
import { SCHEMES, SCHEME_TAGS } from "@/config/schemes";
import { prepareParams } from "./bigquery-client";
import {
  buildDealerMasterQuery,
  buildFestiveBonanzaMetricsQuery,
  buildStarPointsMetricsQuery,
  buildInspectSchemaQuery,
  lastDayOfMonth,
  rangesFromScheme,
  rangesKey,
  table,
  type DateRanges,
} from "./queries";

const T = { projectId: "example-project", dataset: "Testdb" };
const RANGES: DateRanges = {
  baseFrom: "2026-04-01",
  baseTo: "2026-06-30",
  periodFrom: "2026-10-01",
  periodTo: "2026-11-30",
  windowTo: "2026-12-31",
};
const FB_SCOPE = {
  channels: ["11", "21"],
  excludedCodes: ["962006", "930001"],
  excludedCategories: ["Colorants"],
  excludedGroups: ["DISTEMPER"],
  returnTypes: ["ZRET", "ZEXR", "ZNCR", "ZEPR"],
};
const SP_SCOPE = {
  fullChannels: ["11", "21"],
  restrictedChannels: ["12"],
  products: [
    { code: "940001", cat: "LUXURY", ch12: true },
    { code: "972200", cat: "TOOLS", ch12: false },
  ],
  returnTypes: ["ZRET"],
};

/** Every @name in the SQL must have a value and a type. */
function expectParamsComplete(spec: { sql: string; params: Record<string, unknown>; types: unknown }) {
  const used = new Set([...spec.sql.matchAll(/@([A-Za-z_]\w*)/g)].map((m) => m[1]));
  const types = spec.types as Record<string, unknown>;
  for (const name of used) {
    expect(spec.params, `param ${name}`).toHaveProperty(name);
    expect(types, `type of ${name}`).toHaveProperty(name);
  }
}

function expectSalesSafety(sql: string, mode: "BASE" | "PERIOD" = "PERIOD") {
  if (mode === "PERIOD") {
    // Routine: scheme period + return window only. Never the NULL partition, never the base period.
    expect(sql).toContain("WHERE billing_date BETWEEN @periodFrom AND @windowTo");
    expect(sql).not.toContain("IS NULL AND invoice_date");
    expect(sql).not.toContain("@baseFrom");
  } else {
    // Base: base period in the dated partitions and in the NULL partition. Never the scheme period.
    expect(sql).toContain("billing_date BETWEEN @baseFrom AND @baseTo");
    expect(sql).toContain("OR (billing_date IS NULL AND invoice_date BETWEEN @baseFrom AND @baseTo)");
    expect(sql).not.toContain("@periodFrom");
    expect(sql).not.toContain("@windowTo");
  }
  // Dedup of duplicate loads.
  expect(sql).toContain("QUALIFY ROW_NUMBER() OVER (PARTITION BY inv_no, line_item ORDER BY data_month DESC");
  // Parent roll-up and month.
  expect(sql).toContain("COALESCE(pc.parent, l.customer_code) AS dealer_code");
  expect(sql).toContain("FORMAT_DATE('%Y-%m', l.bill_date) AS month");
  expect(sql).toContain("SAFE_CAST(gross_sales_revenue AS NUMERIC)");
  // Return window: returns only.
  expect(sql).toContain("(in_base OR in_period OR is_return)");
  // No literal dates or codes in the SQL: values come from parameters.
  expect(sql).not.toMatch(/'20\d\d-\d\d-\d\d'/);
  expect(sql).not.toMatch(/IN \('/);
}

describe("table()", () => {
  it("quotes a valid name", () => {
    expect(table(T, "zsd_sales")).toBe("`example-project.Testdb.zsd_sales`");
  });
  it("rejects an injected identifier", () => {
    expect(() => table({ projectId: "p`; DROP", dataset: "d" }, "x")).toThrow();
    expect(() => table(T, "zsd_sales` --")).toThrow();
  });
});

describe("date ranges", () => {
  it("last day of month", () => {
    expect(lastDayOfMonth("2026-11")).toBe("2026-11-30");
    expect(lastDayOfMonth("2026-12")).toBe("2026-12-31");
    expect(lastDayOfMonth("2027-02")).toBe("2027-02-28");
  });
  it("Festive Bonanza ranges from the configuration", () => {
    const abc1 = SCHEMES.find((s) => s.tag === SCHEME_TAGS.festiveBonanzaPan)!;
    expect(rangesFromScheme(abc1)).toEqual(RANGES);
  });
  it("Star Points return window ends 31-01-2027", () => {
    const gt = SCHEMES.find((s) => s.tag === SCHEME_TAGS.starPoints)!;
    expect(rangesFromScheme(gt).windowTo).toBe("2027-01-31");
  });
  it("FB-PAN and FB-TNHPJK share one ranges key (one query)", () => {
    const [a, b] = SCHEMES.filter((s) => s.type === "FESTIVE_BONANZA");
    expect(rangesKey(rangesFromScheme(a))).toBe(rangesKey(rangesFromScheme(b)));
  });
  it("rejects a base period that overlaps the scheme period", () => {
    expect(() => buildFestiveBonanzaMetricsQuery(T, { ...RANGES, baseTo: "2026-10-05" }, FB_SCOPE)).toThrow();
  });
});

describe("buildFestiveBonanzaMetricsQuery", () => {
  const spec = buildFestiveBonanzaMetricsQuery(T, RANGES, FB_SCOPE);
  const base = buildFestiveBonanzaMetricsQuery(T, RANGES, FB_SCOPE, { mode: "BASE" });

  it("PERIOD (default): partition filter on the scheme period only, dedup, parent roll-up and parameters", () => {
    expect(spec.name).toBe("festive_bonanza_period");
    expectSalesSafety(spec.sql, "PERIOD");
    expectParamsComplete(spec);
    expect(spec.params).toEqual(
      expect.objectContaining({ periodFrom: "2026-10-01", periodTo: "2026-11-30", windowTo: "2026-12-31", channels: ["11", "21"] }),
    );
    expect(spec.params).not.toHaveProperty("baseFrom");
    expect((spec.types as Record<string, unknown>).periodFrom).toBe("DATE");
    expect(spec.sql).toContain("FALSE AS in_base");
  });

  it("BASE: reads the base period incl. the NULL partition, and only base parameters", () => {
    expect(base.name).toBe("festive_bonanza_base");
    expectSalesSafety(base.sql, "BASE");
    expectParamsComplete(base);
    expect(base.params).toMatchObject({ baseFrom: "2026-04-01", baseTo: "2026-06-30" });
    expect(base.params).not.toHaveProperty("periodFrom");
    expect(base.sql).toContain("TRUE AS in_base");
    expect(base.sql).toContain("FALSE AS in_period");
  });

  it("excludes at base-product level and does not read litres", () => {
    expect(spec.sql).toContain("categoryname IN UNNEST(@excludedCategories) OR productgrp IN UNNEST(@excludedGroups)");
    expect(spec.sql).toContain("UNNEST(@excludedCodes)");
    expect(spec.sql).toContain("x.product_code IS NULL AS in_scope");
    expect(spec.sql).toContain("SUM(IF(in_scope, gsr, 0)), 2) AS STRING) AS gsr");
    // total_gsr: all products in the channels, excluded products included (zero-Q1 rule).
    expect(spec.sql).toContain("CAST(ROUND(SUM(gsr), 2) AS STRING) AS total_gsr");
    expect(spec.sql).not.toContain("inv_vol");
  });

  it("adds the dealer filter only when asked", () => {
    expect(spec.sql).not.toContain("@dealerCodes");
    const limited = buildFestiveBonanzaMetricsQuery(T, RANGES, FB_SCOPE, { dealerCodes: ["DEMO0001"] });
    expect(limited.sql).toContain("TRIM(customer_code) IN UNNEST(@dealerCodes)");
    expectParamsComplete(limited);
  });

  it("converts DATE parameters for the client", () => {
    const p = prepareParams(spec);
    expect(p.periodFrom).toMatchObject({ value: "2026-10-01" });
    expect(p.channels).toEqual(["11", "21"]);
  });
});

describe("buildStarPointsMetricsQuery", () => {
  const spec = buildStarPointsMetricsQuery(T, { ...RANGES, periodTo: "2026-12-31", windowTo: "2027-01-31" }, SP_SCOPE);

  it("has the partition filter, dedup, parent roll-up and parameters (both modes)", () => {
    expectSalesSafety(spec.sql, "PERIOD");
    expectParamsComplete(spec);
    const base = buildStarPointsMetricsQuery(T, { ...RANGES, periodTo: "2026-12-31", windowTo: "2027-01-31" }, SP_SCOPE, { mode: "BASE" });
    expectSalesSafety(base.sql, "BASE");
    expectParamsComplete(base);
    expect(spec.params.channels).toEqual(["11", "21", "12"]);
    expect((spec.types as Record<string, unknown>).spProducts).toEqual([{ code: "STRING", cat: "STRING", ch12: "BOOL" }]);
  });

  it("restricts Channel 12 to ch12 products and outputs litres per category and tools GSR", () => {
    expect(spec.sql).toMatch(
      /s\.channel IN UNNEST\(@fullChannels\)\s+OR \(s\.channel IN UNNEST\(@restrictedChannels\) AND IF\(gp\.product_code IS NOT NULL, gp\.ch12, gc\.ch12\)\)/,
    );
    expect(spec.sql).toContain("SAFE_CAST(inv_vol AS NUMERIC) AS litres");
    for (const c of ["LUXURY", "PREMIUM", "ECONOMY", "ENAMELS", "OTHERS"]) expect(spec.sql).toContain(`AS litres_${c}`);
    expect(spec.sql).toContain("AS tools_gsr");
  });

  it("matches Table III on the SKU prefix first, then on product_code", () => {
    // Example (review, Oct 2026): Woodcraft PU Thinner SKUs have prefix 517179 (Table III OTHERS) but product_code
    // 953004 (Table III PREMIUM). The line must score as OTHERS: the prefix match wins.
    expect(spec.sql).toContain("NULLIF(SUBSTR(l.sku, 1, 6), '') AS sku_prefix");
    expect(spec.sql).toContain("LEFT JOIN sp_products AS gp ON gp.product_code = s.sku_prefix");
    expect(spec.sql).toContain("LEFT JOIN sp_products AS gc ON gc.product_code = s.product_code");
    expect(spec.sql).toContain("COALESCE(gp.cat, gc.cat) AS listed_cat");
    expect(spec.sql).toContain("COALESCE(gp.cat, gc.cat) IS NOT NULL");
    expect(spec.sql).toContain("IF(in_scope, listed_cat, NULL) AS cat");
    expect(spec.sql).not.toMatch(/\bJOIN sp_products AS g ON/);
  });

  it("total_gsr counts all products; gsr, mrv and points only the listed products", () => {
    expect(spec.sql).toContain("CAST(ROUND(SUM(gsr), 2) AS STRING) AS total_gsr");
    expect(spec.sql).toContain("SUM(IF(in_scope, gsr, 0)), 2) AS STRING) AS gsr");
    expect(spec.sql).toContain("SUM(IF(in_scope AND is_return AND NOT in_base, gsr, 0))");
    // Channel 12 lines of a product that is not ch12-eligible get no category, so no litres or tools.
    expect(spec.sql).toMatch(/AND \(s\.channel IN UNNEST\(@fullChannels\)\s+OR \(s\.channel IN UNNEST\(@restrictedChannels\)/);
  });

  it("gives no litres for free packs (test_product.paidfree = Free)", () => {
    // Example (Acme update, 20-10-2026): "XNSS White Lumina Neo Star Shine-1L" is a free pack with GSR 0. Acme
    // gives it no points; counting it added 627 Premium litres (8,151 points) to one dealer.
    expect(spec.sql).toContain("WHERE skucode IS NOT NULL AND UPPER(TRIM(paidfree)) = 'FREE'");
    expect(spec.sql).toContain("LEFT JOIN free_skus AS fs ON fs.sku = s.sku");
    for (const c of ["LUXURY", "PREMIUM", "ECONOMY", "ENAMELS", "OTHERS"]) {
      expect(spec.sql).toContain(`SUM(IF(cat = '${c}' AND NOT in_base AND NOT is_free, litres, 0))`);
    }
    // GSR, tools GSR and returns are not changed (free packs have GSR 0).
    expect(spec.sql).toContain("SUM(IF(cat = 'TOOLS' AND NOT in_base, gsr, 0))");
  });

  it("refuses an empty product list", () => {
    expect(() => buildStarPointsMetricsQuery(T, RANGES, { ...SP_SCOPE, products: [] })).toThrow();
  });
});

describe("buildDealerMasterQuery / buildInspectSchemaQuery", () => {
  it("dealer master uses the latest loads", () => {
    const spec = buildDealerMasterQuery(T);
    expect(spec.sql).toContain("SELECT MAX(data_month) FROM `example-project.Testdb.customer_attributes`");
    expect(spec.sql).toContain("SELECT MAX(data_month) FROM `example-project.Testdb.parent_child`");
    expect(spec.sql).toContain("pc.parent AS parent_code");
  });
  it("dealer master adds parent_child children that are not in customer_attributes", () => {
    const spec = buildDealerMasterQuery(T);
    expect(spec.sql).toContain("UNION ALL");
    expect(spec.sql).toContain("pc.child AS code");
    expect(spec.sql).toContain("WHERE pc.child NOT IN (SELECT TRIM(dealer_code) FROM ca)");
  });
  it("inspect query uses a parameter for the table list", () => {
    const spec = buildInspectSchemaQuery(T, ["zsd_sales"]);
    expect(spec.sql).toContain("`example-project.Testdb.INFORMATION_SCHEMA.COLUMNS`");
    expectParamsComplete(spec);
  });
});
