/**
 * Phase 1 scheme configuration – the ONE place where the three circulars are hard-coded.
 *
 * Source: circulars ACME/SALES/Oct-Nov'26-FY27-GIFT SCHEME/1st Oct 2026 (Festive Bonanza, two variants) and
 * ACME/SALES/Q3-FY27-SCHEME/1st Oct '26 (Star Points). The PDFs are outside the repository.
 * Circular terms that are not in this file: docs/scheme-rules-reference.md.
 * The seed script writes this data to PostgreSQL. The engine reads it from the database.
 * The later Excel upload (template v3.0) must write the same tables.
 *
 * Amounts: the circulars give GSR slabs in ₹ lakh. Values here are in INR (1 lakh = 100,000).
 * Scheme tags: only here (not in the environment). The tag keys the stored data, so a rename needs a migration
 * (example: drizzle/0002_rename_scheme_tags.sql).
 */
import type { SchemeConfig, SlabConfig } from "@/engine/types";

const LAKH = 100_000;

export const SCHEME_TAGS = {
  festiveBonanzaPan: "FB-PAN",
  festiveBonanzaTnHpJk: "FB-TNHPJK",
  starPoints: "SP-Q3",
} as const;

/** Festive Bonanza Table I (both variants). Growth applies to the Pan India variant only. */
const FB_TABLE: Array<[slab: number, gsrLakh: number, minOctLakh: number, growthPct: number, gold: number, cn: number]> = [
  [1, 2.5, 1, 20, 5000, 4500], // CLAUDE.md §11: meeting said ₹4,000; circular says ₹5,000. Circular used.
  [2, 4.0, 1.5, 20, 8000, 7200],
  [3, 6.0, 2.5, 15, 12000, 10800],
  [4, 8.0, 3, 15, 18000, 16200],
  [5, 10.0, 4, 15, 24000, 21600],
  [6, 12.0, 5, 10, 30000, 27000],
  [7, 15.0, 6, 10, 40000, 36000],
];

function fbSlabs(withGrowth: boolean): SlabConfig[] {
  return FB_TABLE.map(([slabNo, gsrLakh, minOctLakh, growthPct, gold, cn]) => ({
    slabNo,
    label: `Slab ${slabNo}`,
    periodGsrRequired: Math.round(gsrLakh * LAKH),
    minFirstMonthGsr: Math.round(minOctLakh * LAKH),
    growthPct: withGrowth ? growthPct : undefined,
    // Circular p1 footnote: "GV will be of Jeweller A/Jeweller B/reputed brand".
    gift: { description: "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", value: gold },
    cnAlternative: cn,
  }));
}

const FB_COMMON = {
  type: "FESTIVE_BONANZA" as const,
  circularRef: "ACME/SALES/Oct-Nov'26-FY27-GIFT SCHEME/1st Oct 2026",
  fromDate: "2026-10-01",
  toDate: "2026-11-30",
  periodMonths: ["2026-10", "2026-11"],
  baseFromDate: "2026-04-01",
  baseToDate: "2026-06-30",
  baseMonths: ["2026-04", "2026-05", "2026-06"],
  baseMonthCount: 3,
  returnWindowMonths: ["2026-12"], // returns up to 1 month after 30-11-2026
  odCheckDate: "2026-11-30",
  finalOn: "2026-12-31",
  exclusivityGroup: "FESTIVE_BONANZA",
  classificationRule: "STOP_AT_FIRST_FAIL" as const,
  // Zero (or negative) Q1 scheme GSR: growth is met only when the dealer had Q1 sales of ANY product (BA,
  // 19-10-2026: a dealer with no Q1 sales of any product is not eligible). Only FB-PAN has a growth condition.
  zeroBaseGrowthRule: "MET_IF_ANY_BASE_SALES" as const,
};

/**
 * Region scope. Circular codes → `customer_attributes.region_name` values in BigQuery
 * (checked 16-10-2026: "TN North", "TN South", "HP & JK"; HP and JK are one region in the data).
 */
export const REGION_ALIASES: Record<string, string[]> = {
  TNN: ["TN North"],
  TNS: ["TN South"],
  HP: ["HP & JK"],
  JK: ["HP & JK"],
};

const TN_HP_JK = ["TNN", "TNS", "HP", "JK"];

/** Circular region codes → distinct dealer-master region names. */
export function resolveRegionNames(codes: string[]): string[] {
  return [...new Set(codes.flatMap((c) => REGION_ALIASES[c] ?? [c]))];
}

/** Star Points Table I. Gift value is null for trips. */
const SP_TABLE: Array<[slab: number, points: number, gift: string, giftValue: number | null, cn: number]> = [
  [1, 85_000, "Gold Voucher ₹65,000 (Jeweller A / Jeweller B)", 65_000, 55_000],
  // Circular p2 footnote 1: "Cruise Venue will be Island/equivalent".
  [2, 110_400, "1 Ticket for 4N5D Island Cruise (or equivalent)", null, 78_000],
  [3, 136_000, "1 Ticket for 4N5D Island Cruise (or equivalent) + ₹18,000 CN", null, 96_000],
  [4, 161_000, "1 Ticket for 4N5D Island Cruise (or equivalent) + ₹36,000 CN", null, 114_000],
  [5, 187_000, "1 Ticket for 4N5D Island Cruise (or equivalent) + ₹54,000 CN", null, 132_000],
  [6, 217_000, "2 Tickets for 4N5D Island Cruise (or equivalent)", null, 156_000],
  [7, 225_000, "1 Ticket for 4N5D Overseas Tour", null, 162_000],
];

export const SCHEMES: SchemeConfig[] = [
  {
    ...FB_COMMON,
    tag: SCHEME_TAGS.festiveBonanzaPan,
    name: "Festive Bonanza Oct-Nov'26 (Pan India except TNN, TNS, HP & JK)",
    regionScope: { mode: "EXCLUDE", regionNames: resolveRegionNames(TN_HP_JK) },
    slabs: fbSlabs(true),
  },
  {
    ...FB_COMMON,
    tag: SCHEME_TAGS.festiveBonanzaTnHpJk,
    name: "Festive Bonanza Oct-Nov'26 (TNN, TNS, HP & JK)",
    regionScope: { mode: "INCLUDE", regionNames: resolveRegionNames(TN_HP_JK) },
    slabs: fbSlabs(false),
  },
  {
    tag: SCHEME_TAGS.starPoints,
    type: "STAR_POINTS",
    name: "Star Points Q3 FY 2026-27 (Pan India)",
    regionScope: null, // Pan India
    circularRef: "ACME/SALES/Q3-FY27-SCHEME/1st Oct '26",
    fromDate: "2026-10-01",
    toDate: "2026-12-31",
    periodMonths: ["2026-10", "2026-11", "2026-12"],
    baseFromDate: "2026-04-01",
    baseToDate: "2026-06-30",
    baseMonths: ["2026-04", "2026-05", "2026-06"],
    baseMonthCount: 3,
    returnWindowMonths: ["2027-01"],
    odCheckDate: "2026-12-31",
    finalOn: "2027-01-31",
    exclusivityGroup: "STAR_POINTS",
    classificationRule: "STOP_AT_FIRST_FAIL",
    // Growth uses the dealer's total GSR of all products (BA, 19-10-2026; the circular names no products for
    // growth). No Q1 sales of any product → growth not met → not eligible.
    growthGsrBasis: "ALL_PRODUCTS",
    zeroBaseGrowthRule: "MET_IF_ANY_BASE_SALES",
    slabs: SP_TABLE.map(([slabNo, points, gift, giftValue, cn]) => ({
      slabNo,
      label: `Slab ${slabNo}`,
      pointsRequired: points,
      growthPct: 10,
      gift: { description: gift, value: giftValue },
      cnAlternative: cn,
    })),
    starPoints: {
      basePerLitre: { LUXURY: 14, PREMIUM: 6, ECONOMY: 3, ENAMELS: 3, OTHERS: 2.5 },
      bonusPerLitre: {
        "2026-10": { LUXURY: 16, PREMIUM: 7, ECONOMY: 3, ENAMELS: 3, OTHERS: 0 },
        // Nov and Dec bonus points are announced at the start of each month. Default 0 (CLAUDE.md §11).
        "2026-11": { LUXURY: 0, PREMIUM: 0, ECONOMY: 0, ENAMELS: 0, OTHERS: 0 },
        "2026-12": { LUXURY: 0, PREMIUM: 0, ECONOMY: 0, ENAMELS: 0, OTHERS: 0 },
      },
      toolsGsrStep: 15_000,
      toolsPointsPerStep: 400,
      // Circular, Table I note: "Beyond Slab 7, growth required is 5%". OPEN ITEM: not applied. The extra benefits
      // below need the dealer in Slab 6 / 7, which already need 10% growth, so a 5% value could never change a
      // result. The client must say what the 5% means (for example: extras with 5% growth only). Then add it here.
      // The two rules are alternatives, not additive: the dealer selects only 1 trip destination (circular p2).
      // In each rule, the trip option and the CN option are also alternatives. See docs/scheme-rules-reference.md 5.2.
      extraBenefits: [
        {
          fromSlabNo: 6,
          beyondPoints: 217_000,
          tripEveryPoints: 106_000,
          tripDescription: "Extra tickets for 4N5D Island Cruise (or equivalent), beyond 2,17,000 points",
          tripCnValue: 78_000,
          cnEveryPoints: 26_000,
          cnPerStep: 18_500,
          destination: "CRUISE",
        },
        {
          fromSlabNo: 7,
          beyondPoints: 225_000,
          tripEveryPoints: 211_000,
          tripDescription: "Extra tickets for 4N5D Overseas Tour, beyond 2,25,000 points",
          tripCnValue: 162_000,
          cnEveryPoints: 26_000,
          cnPerStep: 18_500,
          destination: "OVERSEAS",
        },
      ],
    },
  },
];

/**
 * Distribution channel codes (BigQuery `distribution_channel`, names from test_customer.distch_name, 16-10-2026):
 * 11 = Direct Dealer (Trade), 21 = Franchise, 12 = Institutional (Channel 12).
 */
export const CHANNELS = { TRADE: "11", FRANCHISE: "21", INSTITUTIONAL: "12" } as const;

export const SCHEME_CHANNELS: Record<string, string[]> = {
  [SCHEME_TAGS.festiveBonanzaPan]: [CHANNELS.TRADE, CHANNELS.FRANCHISE],
  [SCHEME_TAGS.festiveBonanzaTnHpJk]: [CHANNELS.TRADE, CHANNELS.FRANCHISE],
  // Channel 12 counts only for Acme One Emulsions topcoats (see star-points-products.ts, channel12Eligible).
  [SCHEME_TAGS.starPoints]: [CHANNELS.TRADE, CHANNELS.FRANCHISE, CHANNELS.INSTITUTIONAL],
};

/**
 * Festive Bonanza product exclusions ("Distemper, Colorants, Style Aluminium Paint and Venture 15/25/Roller").
 * Matched to the product master `Testdb.test_product` on 16-10-2026 (see docs/assumptions.md).
 */
export const FB_EXCLUSIONS = {
  /** test_product.categoryname values excluded as a whole. */
  categoryNames: ["Colorants"],
  /** test_product.productgrp values excluded as a whole. */
  productGroups: ["DISTEMPER"],
  /** Base product codes (zsd_sales.product_code = test_product.baseproduct). */
  productCodes: [
    "962006", // ALUMINIUM PAINT, sub-brand Style
    "930001", // EXPLORE 15
    "930004", // EXPLORE 25
    "930002", // EXPLORE ROLLER
  ],
};

/** Star Points tools (Rollers, Sandpapers, Masking Tapes). Base product codes from test_product, 16-10-2026. */
export const SP_TOOLS_PRODUCT_CODES: string[] = [
  // Rollers
  "972200", "972211", "972212", "972215", "972302", "972310",
  // Sandpapers
  "972102", "972103", "972104", "972105", "972106", "972122", "972123", "972124", "972125", "972126",
  // Masking tapes ("PAINTER S MT")
  "972001", "972002", "972003", "972004",
];

/** Material return billing types (zsd_sales.billing_type). Other negative types (cancellations) net into GSR. */
export const RETURN_BILLING_TYPES = ["ZRET", "ZEXR", "ZNCR", "ZEPR"];
