"use client";

/** Form to enter or change a dealer's reward choice (admin dealer page). The server checks the rules again. */
import { useActionState } from "react";
import type { RewardChoice, TripDestination } from "@/engine/types";
import { CheckIcon } from "@/components/icons";
import { DESTINATION_LABELS, type ChoiceFormState } from "@/server/reward-choice";

const INITIAL: ChoiceFormState = { status: "idle", message: null };

export function RewardChoiceForm({
  dealerCode,
  schemeTag,
  action,
  current,
  giftText,
  cnText,
  destinations,
}: {
  dealerCode: string;
  schemeTag: string;
  action: (prev: ChoiceFormState, form: FormData) => Promise<ChoiceFormState>;
  current: RewardChoice | null;
  giftText: string;
  cnText: string;
  destinations: TripDestination[];
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3 text-sm">
      <input type="hidden" name="dealer_code" value={dealerCode} />
      <input type="hidden" name="scheme_tag" value={schemeTag} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-gray-500">Benefit</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="choice" value="GIFT" defaultChecked={current?.choice === "GIFT"} required className="mt-0.5" />
          <span>Gift: {giftText}</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="choice" value="CN" defaultChecked={current?.choice === "CN"} className="mt-0.5" />
          <span>CN: {cnText}</span>
        </label>
      </fieldset>
      {destinations.length > 1 ? (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs text-gray-500">Destination of the extra benefit (select only one)</legend>
          {destinations.map((d) => (
            <label key={d} className="flex items-start gap-2">
              <input type="radio" name="destination" value={d} defaultChecked={current?.destination === d} className="mt-0.5" />
              <span>{DESTINATION_LABELS[d]}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-green-dark px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-green disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save choice"}
        </button>
        {state.status === "saved" ? (
          <span role="status" className="inline-flex items-center gap-1 text-brand-green-dark">
            <CheckIcon className="h-4 w-4" />
            {state.message}
          </span>
        ) : null}
        {state.status === "error" ? (
          <span role="alert" className="text-rose-700">
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
