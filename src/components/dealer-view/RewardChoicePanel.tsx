/**
 * Reward choice of a scheme in the dealer view: the saved choice (gift or CN, and the destination of the Star Points
 * extra tickets) and the final benefit at the current slab.
 * - Iframe (DMS / SFA) and read-only admin views: the saved choice only. Acme sends the choices by file or API.
 * - Admin dealer page (`edit` set): also the form to enter or change the choice (RewardChoiceForm).
 */
import type { RewardChoice, TripDestination } from "@/engine/types";
import { formatDateTime } from "@/components/format";
import { choiceText, type ChoiceFormState } from "@/server/reward-choice";
import { RewardChoiceForm } from "./RewardChoiceForm";

/** Edit settings of the admin dealer page. */
export interface ChoiceEdit {
  /** The dealer code the choice is saved under (the status dealer_code: the parent for a child dealer). */
  dealerCode: string;
  action: (prev: ChoiceFormState, form: FormData) => Promise<ChoiceFormState>;
}

const SOURCE_LABELS: Record<string, string> = { ADMIN: "admin", UPLOAD: "file upload", API: "API", DEMO: "test data" };

function SavedLine({ choice }: { choice: RewardChoice | null }) {
  if (!choice) return <p className="text-sm text-gray-600">Not chosen yet.</p>;
  const by = choice.chosen_by ? ` by ${choice.chosen_by}` : "";
  const via = choice.source ? ` (${SOURCE_LABELS[choice.source] ?? choice.source})` : "";
  return (
    <p className="text-sm text-gray-800">
      <span className="font-medium">{choiceText(choice)}</span>
      <span className="text-gray-500">
        {" "}
        · saved{by} on {formatDateTime(choice.updated_at)}
        {via}
      </span>
    </p>
  );
}

export function RewardChoicePanel({
  schemeTag,
  current,
  finalBenefit,
  giftText,
  cnText,
  destinations,
  inSlab,
  edit,
}: {
  schemeTag: string;
  current: RewardChoice | null;
  /** The benefit of the saved choice at the current slab (finalBenefitText). Null = none. */
  finalBenefit: string | null;
  giftText: string;
  cnText: string;
  /** Destinations the dealer can choose between. Fewer than 2 = no destination choice. */
  destinations: TripDestination[];
  inSlab: boolean;
  edit: ChoiceEdit | null;
}) {
  return (
    <section aria-label="Reward choice" className="rounded-md border border-gray-200 px-3 py-3">
      <h3 className="text-sm font-semibold text-gray-900">Reward choice</h3>
      <div className="mt-1">
        <SavedLine choice={current} />
      </div>
      {finalBenefit ? (
        <p className="mt-1 text-sm text-gray-800">
          <span className="text-gray-500">Benefit: </span>
          {finalBenefit}
        </p>
      ) : null}
      {edit && inSlab ? (
        <RewardChoiceForm
          dealerCode={edit.dealerCode}
          schemeTag={schemeTag}
          action={edit.action}
          current={current}
          giftText={giftText}
          cnText={cnText}
          destinations={destinations}
        />
      ) : null}
    </section>
  );
}
