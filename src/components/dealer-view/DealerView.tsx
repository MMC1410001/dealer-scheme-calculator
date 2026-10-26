/**
 * Dealer scheme view. One component for the iframe (/embed) and the admin support view (/admin/dealers/[code]).
 * Server component: renders the stored DealerStatus. The only client part is the reward choice form
 * (RewardChoiceForm), shown on the admin dealer page.
 * Data shape: src/engine/types.ts (same object as the API, docs/api-contract.md).
 */
import type { DealerStatus, SchemeStatus } from "@/engine/types";
import { formatDate, formatDateTime } from "@/components/format";
import { InfoIcon } from "@/components/icons";
import { SchemeCard } from "./SchemeCard";
import { NotInScopeCard } from "./NotInScopeCard";
import { schemeConfigFor } from "./helpers";
import type { ChoiceEdit } from "./RewardChoicePanel";

export type DealerViewAudience = "dealer" | "admin";

/** Latest final_on of the provisional schemes, or null. */
function provisionalUntil(schemes: SchemeStatus[]): string | null {
  let latest: string | null = null;
  for (const s of schemes) {
    if (s.participation === "IN_SCHEME" && s.provisional && s.final_on) {
      if (!latest || s.final_on > latest) latest = s.final_on;
    }
  }
  return latest;
}

export function DealerView({
  status,
  audience,
  choiceEdit = null,
}: {
  status: DealerStatus;
  audience: DealerViewAudience;
  /** Reward choice form (admin dealer page). Null = read-only. */
  choiceEdit?: ChoiceEdit | null;
}) {
  const until = provisionalUntil(status.schemes);
  const inScheme = status.schemes.filter((s) => s.participation === "IN_SCHEME");
  const notInScope = status.schemes.filter((s) => s.participation !== "IN_SCHEME");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-5 flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">
          {audience === "dealer" ? "My Schemes" : "Dealer scheme view"}
        </h1>
        <p className="text-sm text-gray-600">
          {status.dealer_name ? <span className="font-medium text-gray-800">{status.dealer_name}</span> : null}
          {status.dealer_name ? " · " : null}
          <span>Dealer code {status.dealer_code}</span>
        </p>
        <p className="text-sm text-gray-600">Data as of {formatDateTime(status.data_as_of)}</p>
        {until ? (
          <p className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Provisional until {formatDate(until)}. The result can change until then.
            </span>
          </p>
        ) : null}
      </header>

      {status.schemes.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">No scheme data for your dealer code yet.</p>
      ) : null}

      <div className="flex flex-col gap-5">
        {inScheme.map((s) => (
          <SchemeCard key={s.scheme_tag} scheme={s} config={schemeConfigFor(s.scheme_tag)} choiceEdit={choiceEdit} />
        ))}
        {notInScope.length > 0 ? (
          <section aria-label="Schemes you are not part of" className="flex flex-col gap-3">
            {inScheme.length > 0 ? <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Other schemes</h2> : null}
            {notInScope.map((s) => (
              <NotInScopeCard key={s.scheme_tag} scheme={s} name={schemeConfigFor(s.scheme_tag)?.name ?? null} />
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
