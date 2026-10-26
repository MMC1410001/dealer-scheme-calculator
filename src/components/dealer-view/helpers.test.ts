import { describe, expect, it } from "vitest";
import { SCHEMES } from "@/config/schemes";
import type { RewardChoice, SchemeStatus } from "@/engine/types";
import { finalBenefitText } from "./helpers";

const FB_PAN = SCHEMES.find((s) => s.tag === "FB-PAN")!;
const SP_Q3 = SCHEMES.find((s) => s.tag === "SP-Q3")!;
const choice = (c: "GIFT" | "CN", destination: RewardChoice["destination"] = null): RewardChoice => ({
  choice: c,
  destination,
  source: "UPLOAD",
  chosen_by: "ops1",
  updated_at: "2026-10-22T12:00:00+05:30",
});
const slab = (no: number, gift: string, value: number | null, cn: number) => ({
  slab: `Slab ${no}`,
  slab_no: no,
  lock_status: "UNLOCKED" as const,
  gift: { description: gift, value },
  cn_alternative: cn,
  conditions: [],
});
// DEMO0008: 4,80,000 points, Slab 7 (as in src/engine/star-points.test.ts and the demo data).
const gt = (rc: RewardChoice | null, withDestination = true): SchemeStatus => ({
  scheme_tag: "SP-Q3",
  participation: "IN_SCHEME",
  current_slab_no: 7,
  current_slab: "Slab 7",
  details: [slab(6, "2 Tickets for 4N5D Island Cruise (or equivalent)", null, 156_000), slab(7, "1 Ticket for 4N5D Overseas Tour", null, 162_000)],
  extra_benefits: [
    { description: SP_Q3.starPoints!.extraBenefits[0].tripDescription, ...(withDestination ? { destination: "CRUISE" as const } : {}), extra_tickets: 2, extra_ticket_cn_value: 156_000, cn_option_value: 185_000 },
    { description: SP_Q3.starPoints!.extraBenefits[1].tripDescription, ...(withDestination ? { destination: "OVERSEAS" as const } : {}), extra_tickets: 1, extra_ticket_cn_value: 162_000, cn_option_value: 166_500 },
  ],
  reward_choice: rc,
});

describe("finalBenefitText (circular p2; CN choice: Mayur, 22-10-2026)", () => {
  it("ticket: the slab ticket plus the extra tickets of the destination (or their CN, as in the circular)", () => {
    expect(finalBenefitText(gt(choice("GIFT", "OVERSEAS")), SP_Q3)).toBe(
      "1 Ticket for 4N5D Overseas Tour + 1 extra Overseas Tour ticket (or CN ₹1,62,000 in place of the extra ticket)",
    );
    expect(finalBenefitText(gt(choice("GIFT", "CRUISE")), SP_Q3)).toBe(
      "1 Ticket for 4N5D Overseas Tour + 2 extra Island Cruise (or equivalent) tickets (or CN ₹1,56,000 in place of the extra tickets)",
    );
  });

  it("CN: the slab CN plus ₹18,500 CN for every 26,000 points", () => {
    expect(finalBenefitText(gt(choice("CN", "OVERSEAS")), SP_Q3)).toBe(
      "CN ₹3,28,500 (slab CN ₹1,62,000 + extra CN ₹1,66,500: ₹18,500 for each 26,000 points)",
    );
  });

  it("asks for the destination at Slab 7, and matches results stored without a destination", () => {
    expect(finalBenefitText(gt(choice("CN")), SP_Q3)).toBe("CN ₹1,62,000 + extra benefit: destination not chosen yet");
    expect(finalBenefitText(gt(choice("CN", "CRUISE"), false), SP_Q3)).toBe(
      "CN ₹3,47,000 (slab CN ₹1,62,000 + extra CN ₹1,85,000: ₹18,500 for each 26,000 points)",
    );
  });

  it("is the slab benefit only without extras, and null without a choice or a slab", () => {
    const dm: SchemeStatus = {
      scheme_tag: "FB-PAN",
      participation: "IN_SCHEME",
      current_slab_no: 1,
      details: [slab(1, "Gold Voucher (Jeweller A / Jeweller B / reputed brand)", 5000, 4500)],
      reward_choice: choice("GIFT"),
    };
    expect(finalBenefitText(dm, FB_PAN)).toBe("Gift ₹5,000");
    expect(finalBenefitText({ ...dm, reward_choice: choice("CN") }, FB_PAN)).toBe("CN ₹4,500");
    expect(finalBenefitText({ ...dm, reward_choice: null }, FB_PAN)).toBeNull();
    expect(finalBenefitText({ ...dm, current_slab_no: null }, FB_PAN)).toBeNull();
  });
});
