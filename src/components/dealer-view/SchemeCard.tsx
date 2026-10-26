import type { SchemeConfig, SchemeStatus, SlabStatus } from "@/engine/types";
import { EMPTY_VALUE, formatActualByUnit, formatDate, formatInr, formatLakh, formatPoints } from "@/components/format";
import { AlertIcon, CheckIcon, GiftIcon, InfoIcon } from "@/components/icons";
import { destinationOptions } from "@/server/reward-choice";
import { LockBadge } from "./Badges";
import { finalBenefitText, giftLabel, GOLD_VOUCHER_NOTE, namedGiftLabel } from "./helpers";
import { RewardChoicePanel, type ChoiceEdit } from "./RewardChoicePanel";
import { SchemeTerms } from "./SchemeTerms";

/** Header metrics not shown in the view: material returns (client lead and Mayur, 22-10-2026). The API still returns them. */
const HIDDEN_METRICS = new Set(["mrv_total"]);

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-gray-900 tabular-nums">{value}</dd>
      {sub ? <dd className="text-xs text-gray-500 tabular-nums">{sub}</dd> : null}
    </div>
  );
}

function OdNote({ scheme, config }: { scheme: SchemeStatus; config: SchemeConfig | null }) {
  const date = config ? formatDate(config.odCheckDate) : null;
  const on = date ? ` on ${date}` : " on the scheme end date";
  if (scheme.benefit_blocked || scheme.od_status === "OD") {
    return (
      <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="note">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Overdue amount{on}. No benefit is given for this scheme while an amount is overdue.</span>
      </p>
    );
  }
  if (scheme.od_status === "NO_OD") {
    return (
      <p className="flex items-start gap-2 text-sm text-gray-700">
        <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-green-dark" />
        <span>No overdue amount{on}.</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm text-gray-600">
      <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Overdue check{on}: pending. There must be no overdue amount{on} to get the benefit.</span>
    </p>
  );
}

/** Gift column name: the Festive Bonanza gift shows the amount only, as in the report column "Gold Voucher Worth*". */
function giftHeader(config: SchemeConfig | null): string {
  return config?.type === "FESTIVE_BONANZA" ? "Gold voucher worth*" : "Gift";
}

/**
 * Slab list: slab, gift, CN and lock status. The conditions (met / not met) are not shown (client lead and Mayur,
 * 22-10-2026). They stay in the stored status and in the API response.
 */
function SlabTable({
  details,
  currentSlabNo,
  caption,
  giftTitle,
}: {
  details: SlabStatus[];
  currentSlabNo: number | null;
  caption: string;
  giftTitle: string;
}) {
  return (
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-gray-200 text-left align-bottom text-xs text-gray-500">
            <th scope="col" className="py-2 pr-3 font-medium">
              Slab
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {giftTitle}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              CN alternative
            </th>
            <th scope="col" className="py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {details.map((slab) => {
            const current = slab.slab_no === currentSlabNo;
            return (
              <tr
                key={slab.slab_no}
                className={`border-b border-gray-100 align-top ${current ? "bg-brand-green/8" : ""}`}
                aria-current={current ? "true" : undefined}
              >
                <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-gray-900">
                  {slab.slab}
                  {current ? <span className="block text-xs font-medium text-brand-green-dark">Your slab</span> : null}
                </th>
                <td className="py-2.5 pr-3 text-gray-900 tabular-nums">{giftLabel(slab.gift)}</td>
                <td className="py-2.5 pr-3 text-gray-900 tabular-nums">{formatInr(slab.cn_alternative)}</td>
                <td className="py-2.5">
                  <LockBadge status={slab.lock_status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SlabCards({ details, currentSlabNo, giftTitle }: { details: SlabStatus[]; currentSlabNo: number | null; giftTitle: string }) {
  return (
    <ol className="flex flex-col gap-3 sm:hidden" aria-label="Slabs">
      {details.map((slab) => {
        const current = slab.slab_no === currentSlabNo;
        return (
          <li
            key={slab.slab_no}
            className={`rounded-lg border px-3 py-3 ${current ? "border-brand-green bg-brand-green/8" : "border-gray-200 bg-white"}`}
            aria-current={current ? "true" : undefined}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-gray-900">
                {slab.slab}
                {current ? <span className="ml-2 text-xs font-medium text-brand-green-dark">Your slab</span> : null}
              </p>
              <LockBadge status={slab.lock_status} />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2 text-sm">
              <div>
                <dt className="text-xs text-gray-500">{giftTitle}</dt>
                <dd className="text-gray-900 tabular-nums">{giftLabel(slab.gift)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">CN alternative</dt>
                <dd className="text-gray-900 tabular-nums">{formatInr(slab.cn_alternative)}</dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

export function SchemeCard({
  scheme,
  config,
  choiceEdit = null,
}: {
  scheme: SchemeStatus;
  config: SchemeConfig | null;
  /** Set on the admin dealer page: the reward choice form is shown. */
  choiceEdit?: ChoiceEdit | null;
}) {
  const header = scheme.header;
  const details = scheme.details ?? [];
  const name = header?.scheme_name ?? config?.name ?? scheme.scheme_tag;
  const fromDate = header?.from_date ?? config?.fromDate;
  const toDate = header?.to_date ?? config?.toDate;
  const currentNo = scheme.current_slab_no ?? details.filter((d) => d.lock_status === "UNLOCKED").at(-1)?.slab_no ?? null;
  const currentSlab = details.find((d) => d.slab_no === currentNo);
  const titleId = `scheme-${scheme.scheme_tag}-title`;

  return (
    <article aria-labelledby={titleId} className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-4 sm:px-5">
        <span className="w-fit rounded bg-brand-violet/10 px-2 py-0.5 text-xs font-semibold text-brand-violet">{scheme.scheme_tag}</span>
        <h2 id={titleId} className="text-lg font-semibold leading-snug text-gray-900">
          {name}
        </h2>
        <p className="text-sm text-gray-600">
          {formatDate(fromDate)} to {formatDate(toDate)}
          {scheme.provisional && scheme.final_on ? <span> · Provisional until {formatDate(scheme.final_on)}</span> : null}
        </p>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
        {/* Current slab */}
        <div className="flex flex-wrap items-center gap-2">
          {currentSlab ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green-dark px-3 py-1 text-sm font-semibold text-white">
                <GiftIcon className="h-4 w-4" />
                Current: {currentSlab.slab}
              </span>
              <span className="text-sm text-gray-700">
                {namedGiftLabel(currentSlab.gift)} <span className="text-gray-500">or CN {formatInr(currentSlab.cn_alternative)}</span>
              </span>
              {scheme.benefit_blocked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                  <AlertIcon className="h-3.5 w-3.5" />
                  Benefit on hold (overdue)
                </span>
              ) : null}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-sm font-semibold text-gray-700 ring-1 ring-gray-200 ring-inset">
              No slab yet
            </span>
          )}
        </div>

        {/* Header metrics */}
        {header ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MetricTile label="Q1 FY 2026-27 monthly avg GSR" value={formatInr(header.q1_monthly_avg_gsr)} sub={formatLakh(header.q1_monthly_avg_gsr)} />
            {header.metrics.filter((m) => !HIDDEN_METRICS.has(m.key)).map((m) => (
              <MetricTile
                key={m.key}
                label={m.label}
                value={formatActualByUnit(m.value, m.unit)}
                sub={m.unit === "INR" ? formatLakh(m.value) : m.unit === "POINTS" ? "points" : null}
              />
            ))}
          </dl>
        ) : null}

        <OdNote scheme={scheme} config={config} />

        {currentSlab || scheme.reward_choice ? (
          <RewardChoicePanel
            schemeTag={scheme.scheme_tag}
            current={scheme.reward_choice ?? null}
            finalBenefit={finalBenefitText(scheme, config)}
            giftText={currentSlab ? giftLabel(currentSlab.gift) : EMPTY_VALUE}
            cnText={currentSlab ? formatInr(currentSlab.cn_alternative) : EMPTY_VALUE}
            destinations={destinationOptions(config, currentSlab?.slab_no ?? null)}
            inSlab={currentSlab != null}
            edit={choiceEdit}
          />
        ) : null}

        {details.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">Slabs</h3>
            <SlabTable
              details={details}
              currentSlabNo={currentSlab?.slab_no ?? null}
              caption={`Slabs of ${name}`}
              giftTitle={giftHeader(config)}
            />
            <SlabCards details={details} currentSlabNo={currentSlab?.slab_no ?? null} giftTitle={giftHeader(config)} />
            {config?.type === "FESTIVE_BONANZA" ? <p className="mt-2 text-xs text-gray-500">{GOLD_VOUCHER_NOTE}</p> : null}
          </div>
        ) : null}

        {scheme.extra_benefits && scheme.extra_benefits.length > 0 ? (
          <div className="rounded-md border border-brand-green/30 bg-brand-green/5 px-3 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Extra benefits above the top slab: choose one option</h3>
            {/* Circular p2: the dealer selects only 1 trip destination. The options are alternatives, never a total. */}
            <p className="mt-1 text-xs text-gray-600">
              These options are alternatives. You get only one of them. The values are not added together. You can select only one
              trip destination.
            </p>
            <ul className="mt-2 flex flex-col gap-2 text-sm text-gray-800">
              {scheme.extra_benefits.map((b, i) => (
                <li key={i}>
                  <p className="font-medium">{b.description}</p>
                  <p className="text-gray-700">
                    {b.extra_tickets > 0
                      ? `Trip: ${formatPoints(b.extra_tickets)} extra ticket(s) (or ${formatInr(b.extra_ticket_cn_value)} CN in place of the tickets)`
                      : "Trip: no extra ticket yet"}
                  </p>
                  {b.cn_option_value > 0 ? (
                    <p className="text-gray-700">Or CN option: {formatInr(b.cn_option_value)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <SchemeTerms tag={scheme.scheme_tag} circularRef={config?.circularRef} />
      </div>
    </article>
  );
}
