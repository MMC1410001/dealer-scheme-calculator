import { describe, expect, it } from "vitest";
import { SCHEME_TERMS } from "./scheme-terms";
import { SCHEME_TAGS, SCHEMES } from "./schemes";

describe("scheme terms", () => {
  it("has terms for every scheme", () => {
    for (const s of SCHEMES) expect(SCHEME_TERMS[s.tag]?.length ?? 0).toBeGreaterThan(0);
  });

  it("has no dashes in the text (UI rule)", () => {
    for (const sections of Object.values(SCHEME_TERMS)) {
      for (const s of sections) for (const text of [s.title, ...s.items]) expect(text).not.toMatch(/–|—| - /);
    }
  });

  it("keeps only the calculation and payout terms", () => {
    const all = Object.values(SCHEME_TERMS).flat().flatMap((s) => s.items).join(" ");
    expect(all).not.toMatch(/TDS|Mumbai|passport|ambiguity/i);
  });

  it("shows the Star Points points per litre from the configuration (Oct'26 bonus only while Nov and Dec are 0)", () => {
    const points = SCHEME_TERMS[SCHEME_TAGS.starPoints].find((s) => s.title === "Points earning")!.items;
    expect(points).toContain("Base points per litre (whole scheme period): Luxury 14, Premium 6, Economy 3, Enamels 3, Others 2.5.");
    expect(points).toContain(
      "Bonus points per litre, Oct'26: Luxury 16, Premium 7, Economy 3, Enamels 3, Others 0. Total Oct'26: Luxury 30, Premium 13, Economy 6, Enamels 6, Others 2.5.",
    );
    expect(points.some((p) => p.includes("Nov'26") || p.includes("Dec'26"))).toBe(false);
    expect(points).toContain("Tools (Rollers, Sandpapers, Masking Tapes): 400 points for every Rs. 15,000 GSR billed.");
  });

  it("gives FB-TNHPJK no growth term", () => {
    const text = SCHEME_TERMS[SCHEME_TAGS.festiveBonanzaTnHpJk].flatMap((s) => s.items).join(" ");
    expect(text).not.toMatch(/growth/i);
  });
});
