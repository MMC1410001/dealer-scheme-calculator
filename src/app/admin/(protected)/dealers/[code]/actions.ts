"use server";

/** Enter or change one reward choice on the admin dealer page (roles ADMIN and CHOICES). */
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { getAdminSession } from "@/lib/auth/admin-server";
import { DEALER_CODE_PATTERN } from "@/lib/auth/embed-token";
import { parseChoiceValue, parseDestination, type ChoiceFormState } from "@/server/reward-choice";
import { saveRewardChoices } from "@/server/reward-choice-store";

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export async function saveAdminChoiceAction(_prev: ChoiceFormState, form: FormData): Promise<ChoiceFormState> {
  const fail = (message: string): ChoiceFormState => ({ status: "error", message });
  const session = await getAdminSession();
  if (!session) return fail("Your session has ended. Log in again.");

  const dealerCode = field(form, "dealer_code");
  const schemeTag = field(form, "scheme_tag");
  const choice = parseChoiceValue(field(form, "choice"));
  const destination = parseDestination(field(form, "destination"));
  if (!DEALER_CODE_PATTERN.test(dealerCode) || !/^[A-Za-z0-9_-]{1,32}$/.test(schemeTag)) return fail("The request is not valid.");
  if (!choice) return fail("Select Gift or CN.");
  if (destination === undefined) return fail("Select a valid destination.");

  try {
    const [r] = await saveRewardChoices(getDb(), [{ dealerCode, schemeTag, choice, destination, chosenBy: session.username }], {
      source: "ADMIN",
      actor: session.username,
    });
    if (!r.ok) return fail(r.message);
    console.log(
      JSON.stringify({ evt: "reward_choice_saved", source: "ADMIN", dealer_code: r.dealerCode, scheme_tag: r.schemeTag, changed: r.changed, user: session.username }),
    );
    revalidatePath(`/admin/dealers/${encodeURIComponent(dealerCode)}`);
    if (r.changed) revalidatePath("/admin/choices");
    return { status: "saved", message: r.changed ? "Choice saved." : "No change: this choice is already saved." };
  } catch (err) {
    console.error("[admin] saveRewardChoices failed:", err instanceof Error ? err.message : err);
    return fail("The choice could not be saved. Try again in a few minutes.");
  }
}
