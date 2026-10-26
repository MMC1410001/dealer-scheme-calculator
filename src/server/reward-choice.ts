/**
 * Dealer reward choice: gift or CN for a scheme, and the trip destination of the Star Points extra tickets.
 * Pure rules (no database). The store (src/server/reward-choice-store.ts) applies them for the admin area (one choice
 * on the dealer page, or a file upload) and the API (POST /api/v1/dealer-reward-choice). The iframe only shows the
 * choice (Mayur, 22-10-2026: Acme sends the choices by Excel or API; no sales officer ID).
 *
 * Rules (Mayur, 22-10-2026; docs/assumptions.md 2.7):
 * - The dealer can choose only after reaching a slab (participation IN_SCHEME and a current slab).
 * - The choice never locks. A later choice replaces the earlier one.
 * - The destination applies only to the extra tickets above the top slab (decision 1a). It can be chosen only when
 *   extra-benefit rules of more than one destination apply to the dealer's slab (Star Points Slab 7).
 */
import type { RewardChoice, RewardChoiceValue, SchemeConfig, SchemeStatus, TripDestination } from "@/engine/types";

export const REWARD_CHOICE_VALUES: readonly RewardChoiceValue[] = ["GIFT", "CN"];
export const TRIP_DESTINATIONS: readonly TripDestination[] = ["CRUISE", "OVERSEAS"];
/** User ID (admin user name or API chosen_by): letters, digits, ".", "_", "@" and "-", 1 to 64 characters. */
export const CHOSEN_BY_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;

export const DESTINATION_LABELS: Record<TripDestination, string> = {
  CRUISE: "Island Cruise (or equivalent)",
  OVERSEAS: "Overseas Tour",
};

export interface RewardChoiceInput {
  dealerCode: string;
  schemeTag: string;
  choice: RewardChoiceValue;
  destination: TripDestination | null;
  chosenBy: string | null;
}

export type ChoiceErrorCode = "UNKNOWN_SCHEME_TAG" | "DEALER_NOT_FOUND" | "NOT_IN_SLAB" | "DESTINATION_NOT_ALLOWED" | "DUPLICATE";

export type ChoiceCheck = { ok: true } | { ok: false; code: ChoiceErrorCode; message: string };

/** "GIFT" or "CN" (case and spaces ignored). Null for any other value. */
export function parseChoiceValue(raw: unknown): RewardChoiceValue | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return (REWARD_CHOICE_VALUES as readonly string[]).includes(v) ? (v as RewardChoiceValue) : null;
}

/** Destination: null when empty or absent, the value for "CRUISE" / "OVERSEAS" (case ignored), undefined when not valid. */
export function parseDestination(raw: unknown): TripDestination | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const v = raw.trim().toUpperCase();
  if (!v) return null;
  return (TRIP_DESTINATIONS as readonly string[]).includes(v) ? (v as TripDestination) : undefined;
}

/** Destinations of the extra-benefit rules that apply to the slab, in configuration order. */
export function destinationOptions(config: SchemeConfig | null | undefined, currentSlabNo: number | null | undefined): TripDestination[] {
  if (!config?.starPoints || currentSlabNo == null) return [];
  const out: TripDestination[] = [];
  for (const rule of config.starPoints.extraBenefits) {
    if (rule.destination && currentSlabNo >= rule.fromSlabNo && !out.includes(rule.destination)) out.push(rule.destination);
  }
  return out;
}

/** True when the dealer can choose a destination at this slab (more than one destination applies). */
export function canChooseDestination(config: SchemeConfig | null | undefined, currentSlabNo: number | null | undefined): boolean {
  return destinationOptions(config, currentSlabNo).length > 1;
}

/** Checks a choice against the dealer's stored status for the scheme. */
export function checkChoiceAllowed(
  status: SchemeStatus | undefined,
  config: SchemeConfig | null | undefined,
  input: Pick<RewardChoiceInput, "destination">,
): ChoiceCheck {
  if (!status || status.participation !== "IN_SCHEME") {
    return { ok: false, code: "NOT_IN_SLAB", message: "The dealer is not in this scheme." };
  }
  if (status.current_slab_no == null) {
    return { ok: false, code: "NOT_IN_SLAB", message: "The dealer has not reached a slab in this scheme yet." };
  }
  if (input.destination !== null) {
    const options = destinationOptions(config, status.current_slab_no);
    if (options.length < 2 || !options.includes(input.destination)) {
      return {
        ok: false,
        code: "DESTINATION_NOT_ALLOWED",
        message: `No destination choice at ${status.current_slab ?? `Slab ${status.current_slab_no}`}. Leave the destination empty.`,
      };
    }
  }
  return { ok: true };
}

/** True when the stored choice already has these values (a re-send writes nothing). */
export function sameChoice(
  stored: { choice: string; destination: string | null } | undefined,
  input: Pick<RewardChoiceInput, "choice" | "destination">,
): boolean {
  return !!stored && stored.choice === input.choice && (stored.destination ?? null) === input.destination;
}

/** The API / iframe shape of a stored row. updatedAt is already formatted (IST ISO 8601). */
export function toRewardChoice(row: {
  choice: string;
  destination: string | null;
  source: string | null;
  chosenBy: string | null;
  updatedAt: string;
}): RewardChoice {
  return {
    choice: row.choice as RewardChoiceValue,
    destination: (row.destination as TripDestination | null) ?? null,
    source: (row.source as RewardChoice["source"]) ?? null,
    chosen_by: row.chosenBy,
    updated_at: row.updatedAt,
  };
}

/** Short text for the dealer view and the admin pages: "Gift", "CN", plus the destination. */
export function choiceText(c: Pick<RewardChoice, "choice" | "destination">): string {
  const base = c.choice === "GIFT" ? "Gift" : "CN";
  return c.destination ? `${base} · destination: ${DESTINATION_LABELS[c.destination]}` : base;
}

/** State of the choice form on the admin dealer page. */
export interface ChoiceFormState {
  status: "idle" | "saved" | "error";
  message: string | null;
}

/** A refused row of the admin upload. */
export interface UploadRowError {
  row: number;
  dealerCode: string;
  schemeTag: string;
  message: string;
}

/** CSV text of the errors (for the download on the upload page). */
export function errorsToCsv(errors: UploadRowError[]): string {
  const q = (v: string | number) => {
    const s = String(v);
    // A leading = + - @ would run as a formula in Excel: prefix with an apostrophe.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return ["row,dealer_code,scheme_tag,error", ...errors.map((e) => [e.row, e.dealerCode, e.schemeTag, e.message].map(q).join(","))].join("\r\n");
}
