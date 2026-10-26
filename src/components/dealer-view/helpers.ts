import type { Gift, SchemeConfig, SchemeStatus } from "@/engine/types";
import { SCHEMES } from "@/config/schemes";
import { formatInr, formatPoints } from "@/components/format";
import { DESTINATION_LABELS, destinationOptions } from "@/server/reward-choice";

/** Report footnote of the Festive Bonanza gold voucher (circular p1 footnote). */
export const GOLD_VOUCHER_NOTE = "* Gold voucher of Jeweller A / Jeweller B / reputed brand.";

/**
 * Gift of a slab. A gift with a value and no amount in its description (Festive Bonanza gold voucher) shows the amount
 * only, as in the admin report (Mayur, 26-10-2026). The brand goes to GOLD_VOUCHER_NOTE.
 */
export function giftLabel(gift: Gift): string {
  if (gift.value == null) return gift.description;
  const value = formatInr(gift.value);
  // Some descriptions already carry the amount ("Gold Voucher ₹65,000 (Jeweller A / Jeweller B)").
  return gift.description.includes(value) ? gift.description : value;
}

/** giftLabel for text outside the slab table: an amount only gets the word "Gift" ("Gift ₹5,000"). */
export function namedGiftLabel(gift: Gift): string {
  const label = giftLabel(gift);
  return label === gift.description ? label : `Gift ${label}`;
}

/**
 * Final benefit of the saved reward choice at the current slab. Null when there is no choice or no slab.
 * Star Points extra benefit (circular p2, "Additional Trip/CN criteria": the extra tickets, each with its CN
 * alternative, OR ₹18,500 CN for every 26,000 points; only one trip destination):
 * - Gift (ticket): the slab gift, plus the extra tickets of the chosen destination (or their CN, as in the circular).
 * - CN: the slab CN, plus ₹18,500 CN for every 26,000 points (Mayur, 22-10-2026).
 * The destination picks the rule (Slab 7). With one rule only (Slab 6), that rule applies.
 */
export function finalBenefitText(scheme: SchemeStatus, config: SchemeConfig | null): string | null {
  const rc = scheme.reward_choice;
  const slab = scheme.details?.find((d) => d.slab_no === scheme.current_slab_no);
  if (!rc || !slab) return null;
  const base = rc.choice === "GIFT" ? namedGiftLabel(slab.gift) : `CN ${formatInr(slab.cn_alternative)}`;
  const extras = scheme.extra_benefits ?? [];
  if (extras.length === 0) return base;

  const options = destinationOptions(config, slab.slab_no);
  const dest = options.length === 1 ? options[0] : rc.destination;
  if (!dest) return `${base} + extra benefit: destination not chosen yet`;
  const rule = config?.starPoints?.extraBenefits.find((r) => r.destination === dest);
  // Results stored before 22-10-2026 have no destination on the extra benefit: match the rule text.
  const extra = extras.find((e) => (e.destination ? e.destination === dest : e.description === rule?.tripDescription));
  if (!extra) return base;

  if (rc.choice === "GIFT") {
    if (extra.extra_tickets <= 0) return base;
    const tickets = `${formatPoints(extra.extra_tickets)} extra ${DESTINATION_LABELS[dest]} ticket${extra.extra_tickets === 1 ? "" : "s"}`;
    return `${base} + ${tickets} (or CN ${formatInr(extra.extra_ticket_cn_value)} in place of the extra ticket${extra.extra_tickets === 1 ? "" : "s"})`;
  }
  if (extra.cn_option_value <= 0) return base;
  const rate = rule ? `${formatInr(rule.cnPerStep)} for each ${formatPoints(rule.cnEveryPoints)} points` : "extra points";
  return `CN ${formatInr(slab.cn_alternative + extra.cn_option_value)} (slab CN ${formatInr(slab.cn_alternative)} + extra CN ${formatInr(extra.cn_option_value)}: ${rate})`;
}

export function schemeConfigFor(tag: string) {
  return SCHEMES.find((s) => s.tag === tag) ?? null;
}

/** Fallback text when the stored status has a reason code but no reason text. */
const REASON_TEXT: Record<string, string> = {
  REGION_NOT_IN_SCOPE: "Your region is not in the scope of this scheme.",
  REGION_UNKNOWN: "Your region is not known yet. Contact your sales officer.",
  ENROLLED_IN_OTHER_SCHEME: "You are enrolled in another scheme. A dealer can join only one of these schemes.",
  NO_DATA: "No sales data for this scheme yet.",
};

export function reasonText(s: Pick<SchemeStatus, "reason" | "reason_code">): string {
  return s.reason ?? (s.reason_code ? REASON_TEXT[s.reason_code] : undefined) ?? "You are not part of this scheme.";
}
