import type { Metadata } from "next";
import Link from "next/link";
import { getAdminReport } from "@/server/repo";
import type { SchemeReport, SlabReportRow, SyncRunSummary } from "@/server/types";
import { requireAdmin } from "@/lib/auth/admin-server";
import { EMPTY_VALUE, formatCount, formatDate, formatDateTime } from "@/components/format";
import { GOLD_VOUCHER_NOTE, schemeConfigFor } from "@/components/dealer-view/helpers";
import { fiscalQuarterLabel, monthLabel, periodLabel } from "@/engine/labels";
import { SyncStatusBadge } from "@/components/admin/SyncStatusBadge";
import { CalendarIcon, SyncIcon } from "@/components/icons";
import { SchemeTerms } from "@/components/dealer-view/SchemeTerms";

export const metadata: Metadata = { title: "Report | Scheme Calculator" };

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
/** INR → lakh as in the circular: 250000 → "2.5". `fixed` keeps one decimal (circular GSR column: "4.0"). */
const lakh = (v: number | null, fixed = false) => (v == null ? EMPTY_VALUE : fixed ? (v / 100_000).toFixed(1) : nf.format(v / 100_000));
const num = (v: number | null) => (v == null ? EMPTY_VALUE : nf.format(v));
const pct = (v: number | null) => (v == null ? EMPTY_VALUE : `${nf.format(v)}%`);

type Column = { header: string; cell: (r: SlabReportRow) => string; align?: "center" };

/**
 * Slab table columns as in the circular's Table I of each scheme (client lead and Mayur, 22-10-2026), plus the dealer count.
 * Labels of months and quarters come from the scheme configuration.
 */
function circularColumns(s: SchemeReport): Column[] {
  const cfg = schemeConfigFor(s.tag);
  const months = cfg?.periodMonths ?? [];
  const hasGrowth = s.slabs.some((r) => r.growthPct != null);
  if (s.type === "STAR_POINTS") {
    // Circular: "GSR Growth Criteria (Q3 over Q1-FY 27)"; FY written as "FY 2026-27".
    const growth = `GSR Growth Criteria (${fiscalQuarterLabel(months).split(" ")[0]} over ${fiscalQuarterLabel(cfg?.baseMonths ?? [])})`;
    return [
      { header: "Points Required", cell: (r) => num(r.pointsRequired), align: "center" },
      { header: "Benefit for Channel Partner", cell: (r) => r.giftDescription },
      ...(hasGrowth ? [{ header: growth, cell: (r: SlabReportRow) => pct(r.growthPct), align: "center" as const }] : []),
      { header: "CN Alternative (in Rs)", cell: (r) => num(r.cnAlternative), align: "center" },
    ];
  }
  const period = periodLabel(months);
  const first = months[0] ? monthLabel(months[0]) : "first month";
  return [
    { header: `GSR Slabs (in Rs lacs)-${period}`, cell: (r) => lakh(r.periodGsrRequired, true), align: "center" },
    { header: `Min GSR required in ${first}`, cell: (r) => lakh(r.minFirstMonthGsr), align: "center" },
    ...(hasGrowth
      ? [{ header: `Growth in Avg GSR of ${period.replace(" + ", " & ")} over Q1 Monthly Avg`, cell: (r: SlabReportRow) => pct(r.growthPct), align: "center" as const }]
      : []),
    { header: "Gold Voucher Worth* (Rs)", cell: (r) => num(r.giftValue), align: "center" },
    { header: "CN Alternative (in Rs)", cell: (r) => num(r.cnAlternative), align: "center" },
  ];
}

type CountKey = "gift" | "cn" | "notChosen" | "destinationCruise" | "destinationOverseas" | "benefitBlocked";

/**
 * Dealers list behind a report count (Mayur, 22-10-2026). The filters make the list show the same number:
 * a slab row opens that slab, "In scope" counts open the in-scope dealers only (see dealers/list-filters.ts).
 */
function dealersHref(tag: string, p: { status?: "LOCKED" | "ALL"; slabNo?: number; inScope?: boolean } = {}): string {
  const u = new URLSearchParams({ scheme: tag });
  if (p.status) u.set("status", p.status);
  if (p.slabNo != null) u.set("slab", String(p.slabNo));
  if (p.inScope) u.set("scope", "in");
  return `/admin/dealers?${u.toString()}`;
}

/** A count that opens the dealers behind it; a zero stays plain text. */
function CountLink({ n, href, label, className = "" }: { n: number; href: string | null; label: string; className?: string }) {
  if (!href || n === 0) return <>{formatCount(n)}</>;
  return (
    <Link
      href={href}
      aria-label={`${formatCount(n)} dealers: ${label}. Open the list`}
      title="Open these dealers in the Dealers list"
      className={`rounded text-brand-green-dark underline decoration-brand-green-dark/30 underline-offset-4 outline-none hover:decoration-brand-green-dark focus-visible:ring-2 focus-visible:ring-brand-green/50 ${className}`}
    >
      {formatCount(n)}
    </Link>
  );
}

function SchemeSection({ s, showChoices }: { s: SchemeReport; showChoices: boolean }) {
  const sum = (k: CountKey | "dealers") => s.slabs.reduce((n, r) => n + r[k], 0);
  const inSlab = sum("dealers");
  const noSlab = s.noSlab.reduce((n, r) => n + r.count, 0);
  const notInScope = s.notInScope.reduce((n, r) => n + r.count, 0);
  const cols = circularColumns(s);
  // Reward choice, destination (Star Points) and OD split: hidden by default, the client sends this data later.
  const extra: Array<{ header: string; key: CountKey }> = showChoices
    ? [
        { header: "Chose gift", key: "gift" },
        { header: "Chose CN", key: "cn" },
        { header: "Not chosen", key: "notChosen" },
        ...(s.type === "STAR_POINTS"
          ? [
              { header: "Cruise", key: "destinationCruise" as const },
              { header: "Overseas Tour", key: "destinationOverseas" as const },
            ]
          : []),
        { header: "On hold (overdue)", key: "benefitBlocked" },
      ]
    : [];
  // Header cells: bold and one size bigger than the data (text-sm) (Mayur, 22-10-2026).
  const th = "px-2 py-2.5 align-middle text-[0.9375rem] leading-snug font-bold";
  return (
    <section aria-labelledby={`r-${s.tag}`} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-1">
        <span className="w-fit rounded bg-brand-violet/10 px-2 py-0.5 text-xs font-semibold text-brand-violet">{s.tag}</span>
        <h3 id={`r-${s.tag}`} className="text-lg font-semibold text-gray-900">{s.name}</h3>
        <p className="text-sm text-gray-600">
          {formatDate(s.fromDate)} to {formatDate(s.toDate)}
        </p>
      </div>
      <dl className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* "Not in scope" has no link: the Dealers list leaves out most of these dealers (no data, other region). */}
        {(
          [
            ["In scope", s.inScope, dealersHref(s.tag, { status: "ALL", inScope: true })],
            ["In a slab", inSlab, dealersHref(s.tag)],
            ["In scope, no slab", noSlab, dealersHref(s.tag, { status: "LOCKED", inScope: true })],
            ["Not in scope", notInScope, null],
          ] as const
        ).map(([label, v, href]) => (
          <div key={label} className="rounded-md border border-gray-200 px-3 py-2">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">
              <CountLink n={v} href={href} label={`${label}, ${s.tag}`} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="mb-2 text-left text-sm font-semibold text-gray-900">Dealers per slab</caption>
          <thead>
            <tr className="border-y border-gray-300 bg-gray-100 text-left text-gray-900">
              <th scope="col" className={th}>Slabs</th>
              {cols.map((c) => (
                <th key={c.header} scope="col" className={`${th} ${c.align === "center" ? "text-center" : ""}`}>
                  {c.header}
                </th>
              ))}
              <th scope="col" className={`${th} bg-brand-green/15 text-center text-brand-green-dark`}>Dealers</th>
              {extra.map((c) => (
                <th key={c.key} scope="col" className={`${th} text-center`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.slabs.map((r) => (
              <tr key={r.slabNo} className="border-b border-gray-100">
                <th scope="row" className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{r.label}</th>
                {cols.map((c) => (
                  <td key={c.header} className={`px-2 py-1.5 tabular-nums ${c.align === "center" ? "text-center" : ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
                <td className="bg-brand-green/5 px-2 py-1.5 text-center font-semibold tabular-nums">
                  <CountLink n={r.dealers} href={dealersHref(s.tag, { slabNo: r.slabNo })} label={`${r.label}, ${s.tag}`} />
                </td>
                {extra.map((c) => (
                  <td key={c.key} className="px-2 py-1.5 text-center tabular-nums">{formatCount(r[c.key])}</td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" colSpan={cols.length + 1} className="px-2 py-1.5 text-left font-semibold">Total</th>
              <td className="bg-brand-green/10 px-2 py-1.5 text-center font-semibold tabular-nums">
                <CountLink n={inSlab} href={dealersHref(s.tag)} label={`all slabs, ${s.tag}`} />
              </td>
              {extra.map((c) => (
                <td key={c.key} className="px-2 py-1.5 text-center font-semibold tabular-nums">{formatCount(sum(c.key))}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {s.type === "FESTIVE_BONANZA" ? <p className="mt-2 text-xs text-gray-500">{GOLD_VOUCHER_NOTE}</p> : null}
      <div className="mt-4">
        <SchemeTerms tag={s.tag} circularRef={schemeConfigFor(s.tag)?.circularRef} />
      </div>
    </section>
  );
}

const chip = "inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700";

/** "Data as of" is a day boundary (IST ISO string): the date is enough. */
const dataDate = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : "no data yet");

/** Last sync: a small secondary line under "Data as of". */
function LastSync({ run }: { run: SyncRunSummary | null }) {
  if (!run) return <p className="text-xs text-gray-500">No sync run yet</p>;
  const at = run.finishedAt ?? run.startedAt;
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-1 text-xs text-gray-500"
      title={`Started ${formatDateTime(run.startedAt)}${run.finishedAt ? `, finished ${formatDateTime(run.finishedAt)}` : ""}`}
    >
      <SyncIcon className="h-3.5 w-3.5 text-gray-400" />
      <span className="whitespace-nowrap">
        Last sync #{run.id} · {run.source}
      </span>
      <SyncStatusBadge status={run.status} />
      <span className="whitespace-nowrap">{formatDateTime(at)}</span>
    </p>
  );
}

/** Switch-style toggle (a link: the state is in the address, so it can be bookmarked). */
function ChoicesToggle({ on }: { on: boolean }) {
  return (
    <Link
      href={on ? "/admin" : "/admin?choices=1"}
      aria-label={on ? "Hide the reward choice columns" : "Show the reward choice columns"}
      title="Chose gift, chose CN, not chosen, destination (Star Points) and on hold (overdue)"
      className="inline-flex w-fit items-center gap-3 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-800 shadow-sm outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-green/50"
    >
      Reward choice columns
      <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-brand-green-dark" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-[#fff] shadow transition-all ${on ? "left-[1.125rem]" : "left-0.5"}`} />
      </span>
    </Link>
  );
}

export default async function AdminReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin(["ADMIN"]);
  const sp = await searchParams;
  // ?choices=1: show the reward choice, destination and OD columns (off by default until the client sends the data).
  const showChoices = (Array.isArray(sp.choices) ? sp.choices[0] : sp.choices) === "1";
  const report = await getAdminReport();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Scheme report</h1>
          <div className="flex flex-col items-start gap-1.5">
            <span className={chip}>
              <CalendarIcon className="h-4 w-4 text-gray-400" />
              Data as of <span className="font-medium text-gray-900">{dataDate(report.dataAsOf)}</span>
            </span>
            <LastSync run={report.lastSync} />
          </div>
          {report.lastSync?.status === "FAILED" && report.lastSync.message ? (
            <p className="text-sm text-rose-700">Last sync failed: {report.lastSync.message}</p>
          ) : null}
        </div>
        <ChoicesToggle on={showChoices} />
      </div>
      {report.schemes.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
          No results yet. Run the database seed, the data sync and the engine first.
        </p>
      ) : (
        report.schemes.map((s) => <SchemeSection key={s.tag} s={s} showChoices={showChoices} />)
      )}
    </div>
  );
}
