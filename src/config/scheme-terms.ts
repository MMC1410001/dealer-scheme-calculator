/**
 * Circular terms shown in the "Scheme terms and conditions" section below each scheme (dealer view and admin report).
 * Only the terms that affect the calculation or the payout (Mayur, 22-10-2026). Left out: TDS, gift brand and voucher
 * company, travel arrangements and documents, withdrawal of the offer, ambiguity and jurisdiction.
 * Text: as in the circulars, without dashes (no-dash UI rule). The Star Points points per litre come from the
 * scheme configuration, so that a new monthly bonus shows here too.
 */
import type { SchemeConfig } from "@/engine/types";
import { SCHEME_TAGS, SCHEMES } from "./schemes";

export interface TermsSection {
  title: string;
  items: string[];
}

const FB_PRODUCTS = [
  "Channel: Trade & Franchise channel only.",
  "Products included: all Trade products except Distemper, Colorants, Style Aluminium Paint and Venture 15/25/Roller.",
  "Any new products launched or introduced during the scheme period will be intimated as and when the product is launched in the market.",
  "A channel partner can participate either in Acme Paints Festive Bonanza Oct-Nov'26 or in Acme Paints Star Points Q3 FY27, not in both.",
];

const odCriteria = (onDate: string, payoutTime: string): TermsSection => ({
  title: "OD (overdue) criteria",
  items: [
    `Scheme benefit will not be extended to any Channel Partner having OD (overdue / outstanding) in any account as on ${onDate} and at the time of ${payoutTime}.`,
  ],
});

const calculation = (period: string): TermsSection => ({
  title: "Calculation",
  items: [
    "The value of the product purchased is the Gross Sales Revenue (GSR): GSR = DPL minus in-bill discounts.",
    "Achievement of all basic qualification criteria and sub criteria is necessary for qualification in the scheme.",
    "There is no monetization of points / volumes at or above the qualifying or intermediate slabs.",
    `Material Return Value (MRV) sales from any time of the year will be subtracted from the total achievement of slab for the scheme period of ${period}.`,
    "Material returns up to 1 month after the scheme end date will be deducted from the scheme calculation for payout.",
  ],
});

const FB_OD = odCriteria("30th Nov'26", "Gold Voucher disbursement / time of Credit Note (CN) settlement");
const FB_CALCULATION = calculation("1st Oct'26 to 30th Nov'26");

const CATEGORY_LABELS: Array<[key: "LUXURY" | "PREMIUM" | "ECONOMY" | "ENAMELS" | "OTHERS", label: string]> = [
  ["LUXURY", "Luxury"],
  ["PREMIUM", "Premium"],
  ["ECONOMY", "Economy"],
  ["ENAMELS", "Enamels"],
  ["OTHERS", "Others"],
];
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** "Oct'26" from "2026-10". */
function shortMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const name = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-IN", { month: "short", timeZone: "UTC" });
  return `${name}'${y.slice(2)}`;
}

/** Points per litre lines from the configuration: base, then each month with an announced bonus. */
function pointsPerLitre(config: SchemeConfig | undefined): string[] {
  const gt = config?.starPoints;
  if (!gt) return [];
  const list = (values: Record<string, number>) => CATEGORY_LABELS.map(([k, label]) => `${label} ${nf.format(values[k] ?? 0)}`).join(", ");
  const lines = [`Base points per litre (whole scheme period): ${list(gt.basePerLitre)}.`];
  for (const [month, bonus] of Object.entries(gt.bonusPerLitre)) {
    // A month with no bonus in the configuration is not announced yet (CLAUDE.md section 11: default 0).
    if (!Object.values(bonus).some((v) => v > 0)) continue;
    const total = Object.fromEntries(CATEGORY_LABELS.map(([k]) => [k, (gt.basePerLitre[k] ?? 0) + (bonus[k] ?? 0)]));
    lines.push(`Bonus points per litre, ${shortMonth(month)}: ${list(bonus)}. Total ${shortMonth(month)}: ${list(total)}.`);
  }
  lines.push(
    `Tools (Rollers, Sandpapers, Masking Tapes): ${nf.format(gt.toolsPointsPerStep)} points for every Rs. ${nf.format(gt.toolsGsrStep)} GSR billed.`,
  );
  return lines;
}

const spConfig = SCHEMES.find((s) => s.tag === SCHEME_TAGS.starPoints);

export const SCHEME_TERMS: Record<string, TermsSection[]> = {
  [SCHEME_TAGS.festiveBonanzaPan]: [
    {
      title: "Key terms and conditions",
      items: [
        "Both criteria, Min GSR required in Oct'26 and Growth in Avg GSR of Oct & Nov'26 over Q1 Monthly Avg, need to be fulfilled to be eligible for the scheme.",
        "Example (Slab 1): a channel partner with Rs. 4.5 lakhs in Q1 FY 27 has average Q1 sales of Rs. 1.5 lakhs a month. With the growth criteria of 20%, the dealer must bill Rs. 1.8 lakhs a month: Rs. 3.6 lakhs in Oct + Nov'26 (with min Rs. 1 lakh in Oct'26) to qualify for Slab 1 and get a Gold Voucher worth Rs. 5000.",
        ...FB_PRODUCTS,
      ],
    },
    FB_OD,
    FB_CALCULATION,
  ],
  [SCHEME_TAGS.festiveBonanzaTnHpJk]: [
    {
      title: "Key terms and conditions",
      items: ["The criteria of Min GSR required in Oct'26 needs to be fulfilled to be eligible for the scheme.", ...FB_PRODUCTS],
    },
    FB_OD,
    FB_CALCULATION,
  ],
  [SCHEME_TAGS.starPoints]: [
    {
      title: "Key terms and conditions",
      items: [
        "Channel: both Trade (including Franchise stores) & Channel 12 (Institutional).",
        "In Channel 12 billing (Institutional): only Trade products of Acme One Emulsions topcoats as mentioned in the product list are included.",
        "Only the products of the 5 categories (Luxury, Premium, Economy, Enamels, Others; Table III of the circular) count for the points. Beyond these products, no other product is considered.",
        "GSR growth criteria: Q3 over Q1 FY 27, as in the slab table. Beyond Slab 7, growth required is 5%.",
        "Any new products launched or introduced during the scheme period will be intimated as and when the product is launched in the market.",
        "A channel partner can participate either in Acme Paints Star Points Q3 FY27 or in Festive Bonanza Oct-Nov'26, not in both.",
      ],
    },
    {
      title: "Points earning",
      items: [
        "Points are awarded per litre purchased, only on the listed product categories, during the scheme period.",
        "The total cumulative points at the end of the scheme period decide the slab.",
        "Base points are fixed for the whole scheme period. Bonus points change every month and are announced at the start of each month.",
        ...pointsPerLitre(spConfig),
        "Additional bonus points may also be announced from time to time. They are added to the overall points earned.",
      ],
    },
    {
      title: "Additional Trip / CN criteria",
      items: [
        "Beyond 2,17,000 points: for every 1,06,000 points, 1 Ticket for 4N5D Island Cruise (or equivalent) or CN Rs. 78,000, OR Rs. 18,500 CN for every 26,000 points.",
        "Beyond 2,25,000 points: for every 2,11,000 points, 1 Ticket for 4N5D Overseas Tour or CN Rs. 1,62,000, OR Rs. 18,500 CN for every 26,000 points.",
        "A dealer can select only 1 trip destination: Overseas Tour or Island (or equivalent) Cruise.",
        "A channel partner who qualifies for more tickets but travels on fewer gets the CN of the base slab of the trip for each ticket not used: Rs. 78,000 for a Island Cruise ticket, Rs. 1,62,000 for a Overseas Tour ticket.",
      ],
    },
    odCriteria("31st December'26", "travel or at the time of Credit Note (CN) settlement"),
    calculation("1st Oct'26 to 31st Dec'26"),
  ],
};
