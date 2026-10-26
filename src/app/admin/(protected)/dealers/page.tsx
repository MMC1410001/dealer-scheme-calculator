import type { Metadata } from "next";
import Link from "next/link";
import { listActiveSchemeTags, listSchemeDealers } from "@/server/repo";
import type { DealerListRow, DealerListStatus } from "@/server/types";
import { requireAdmin } from "@/lib/auth/admin-server";
import { LockBadge } from "@/components/dealer-view/Badges";
import { schemeConfigFor } from "@/components/dealer-view/helpers";
import { MessagePanel } from "@/components/MessagePanel";
import { AutoSubmitSelect } from "@/components/admin/AutoSubmitSelect";
import { DropQueryParams } from "@/components/admin/DropQueryParams";
import { EMPTY_VALUE } from "@/components/format";
import { ChevronDownIcon } from "@/components/icons";
import { DEFAULT_STATUS, MAX_QUERY, listQuery, parseListState, type DealerListFilters, type DealerListState } from "./list-filters";

export const metadata: Metadata = { title: "Dealers | Scheme Calculator" };

const PAGE_SIZE = 50;
// Tab order: Unlocked first (the default, see list-filters.ts).
const STATUSES: Array<{ value: DealerListStatus; label: string }> = [
  { value: "UNLOCKED", label: "Unlocked" },
  { value: "LOCKED", label: "Locked" },
  { value: "ALL", label: "All" },
];
const nf = new Intl.NumberFormat("en-IN");

/** Slab of the dealer, linked to the dealer page of the scheme; OD hold shown next to it. */
function SlabLink({ row, href }: { row: DealerListRow; href: string }) {
  return (
    <span>
      <Link href={href} className="text-gray-900 underline-offset-2 hover:underline">
        {row.slab ?? (row.slabNo != null ? `Slab ${row.slabNo}` : "No slab")}
        <span className="sr-only">, view slabs</span>
      </Link>
      {row.benefitBlocked ? <span className="ml-2 text-xs font-medium text-amber-800">On hold (overdue)</span> : null}
    </span>
  );
}

const PAGE_WINDOW = 10;
const pageLink = "grid h-8 min-w-8 place-items-center rounded-md px-2 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50";
const navButton = `${pageLink} border border-gray-300 bg-white px-3 font-medium text-brand-green-dark shadow-sm hover:border-brand-green hover:bg-brand-green/10`;

/**
 * Page numbers: a window of 10 pages around the current page (1–10 at the start), the first and the last page
 * outside the window after "…", and Previous / Next.
 */
function PageLinks({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const start = Math.max(1, Math.min(page - Math.floor(PAGE_WINDOW / 2) + 1, pages - PAGE_WINDOW + 1));
  const end = Math.min(pages, start + PAGE_WINDOW - 1);
  const numbers = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const num = (p: number) =>
    p === page ? (
      <span key={p} aria-current="page" className={`${pageLink} bg-brand-green-dark font-semibold text-white`}>
        {nf.format(p)}
      </span>
    ) : (
      <Link key={p} href={href(p)} aria-label={`Page ${p}`} className={`${pageLink} text-gray-700 hover:bg-gray-100`}>
        {nf.format(p)}
      </Link>
    );
  const gap = (key: string) => (
    <span key={key} aria-hidden="true" className="px-1 text-gray-400">
      …
    </span>
  );
  return (
    <span className="flex flex-wrap items-center justify-center gap-1">
      {page > 1 ? (
        <Link href={href(page - 1)} className={navButton}>
          ‹ Previous
        </Link>
      ) : null}
      {start > 1 ? [num(1), start > 2 ? gap("gap-start") : null] : null}
      {numbers.map(num)}
      {end < pages ? [end < pages - 1 ? gap("gap-end") : null, num(pages)] : null}
      {page < pages ? (
        <Link href={href(page + 1)} className={navButton}>
          Next ›
        </Link>
      ) : null}
    </span>
  );
}

export default async function DealersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const tags = await listActiveSchemeTags();
  if (tags.length === 0) return <MessagePanel title="No active scheme" />;

  // Default scheme: the first active tag (FB-PAN).
  const state = parseListState(sp, tags);
  const { schemeTag, status, q, page } = state;
  const filters: DealerListFilters = { slabNo: state.slabNo, inScopeOnly: state.inScopeOnly };

  const query = { schemeTag, status, q, ...filters, pageSize: PAGE_SIZE };
  let list = await listSchemeDealers({ ...query, page });
  const totalOf = (l: typeof list) => (status === "UNLOCKED" ? l.counts.unlocked : status === "LOCKED" ? l.counts.locked : l.counts.all);
  // A page number above the last page (typed in "Go to page") opens the last page.
  const lastPage = Math.max(1, Math.ceil(totalOf(list) / PAGE_SIZE));
  if (page > lastPage && totalOf(list) > 0) list = await listSchemeDealers({ ...query, page: lastPage });
  const total = totalOf(list);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Links to this list keep the scheme and the search; a tab or a filter change opens page 1.
  const stateWith = (p: { status?: DealerListStatus; page?: number; filters?: DealerListFilters }): DealerListState => ({
    ...state,
    ...(p.filters ?? filters),
    status: p.status ?? status,
    page: p.page ?? 1,
  });
  const href = (p: { status?: DealerListStatus; page?: number; filters?: DealerListFilters }) => `/admin/dealers?${listQuery(stateWith(p))}`;
  const countOf = (s: DealerListStatus) => (s === "UNLOCKED" ? list.counts.unlocked : s === "LOCKED" ? list.counts.locked : list.counts.all);
  // Filters from the report links: shown as chips; each chip removes its filter.
  const chips = [
    ...(filters.slabNo != null ? [{ label: `Slab ${filters.slabNo}`, without: { ...filters, slabNo: null } }] : []),
    ...(filters.inScopeOnly ? [{ label: "In scope only", without: { ...filters, inScopeOnly: false } }] : []),
  ];
  const filterHidden = (
    <>
      {filters.slabNo != null ? <input type="hidden" name="slab" value={filters.slabNo} /> : null}
      {filters.inScopeOnly ? <input type="hidden" name="scope" value="in" /> : null}
    </>
  );
  // Empty tab: "No unlocked dealer ...", with a link to All when the other tab has dealers (a search may match only locked ones).
  const emptyKind = status === "ALL" ? "" : `${status.toLowerCase()} `;
  const emptyWhere = `${schemeTag}${chips.length ? ` (${chips.map((c) => c.label).join(", ")})` : ""}`;
  const schemeName = schemeConfigFor(schemeTag)?.name ?? schemeTag;
  // The dealer page gets the list state (search, tab, page), so that "Back to dealers" opens the same list.
  const detailHref = (code: string) => `/admin/dealers/${encodeURIComponent(code)}?${listQuery(stateWith({ page: Math.min(page, pages) }))}`;

  return (
    <div className="flex flex-col gap-5">
      {/* A reload opens Unlocked, page 1 (Mayur, 22-10-2026): the tab and the page stay out of the address bar. */}
      <DropQueryParams names={["status", "page", "slab", "scope"]} />
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Dealers</h1>

      <form method="get" className="flex flex-col gap-2 lg:flex-row lg:items-end">
        {/* min-w-0 + truncate: Safari otherwise widens the page to the full scheme name of the selected option. */}
        <div className="flex min-w-0 flex-col gap-1 lg:w-[34rem] lg:shrink-0">
          <label htmlFor="scheme" className="text-xs font-medium text-gray-600">
            Scheme
          </label>
          {/* Own arrow (appearance-none): the browser arrow sits on the border. pr-10 keeps the text clear of it. */}
          <div className="relative">
            {/* A slab number belongs to one scheme: another scheme drops the slab filter (scope=in and the search stay). */}
            <AutoSubmitSelect
              id="scheme"
              name="scheme"
              resetOnChange={["slab"]}
              defaultValue={schemeTag}
              className="w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-gray-300 bg-white py-2 pr-10 pl-3 text-sm text-gray-900 hover:border-gray-400 focus:border-brand-green-dark focus:outline-2 focus:outline-brand-green/40"
            >
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}: {schemeConfigFor(t)?.name ?? t}
                </option>
              ))}
            </AutoSubmitSelect>
            <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-gray-500" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-xs font-medium text-gray-600">
            Dealer code or name (optional)
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            maxLength={MAX_QUERY}
            placeholder="Dealer code or name"
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-green-dark focus:outline-2 focus:outline-brand-green/40"
          />
        </div>
        {status !== DEFAULT_STATUS ? <input type="hidden" name="status" value={status} /> : null}
        {filterHidden}
        <button type="submit" className="rounded-md bg-brand-green-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green">
          Show
        </button>
      </form>

      {/* The report filters sit in the tab row, next to "All", so that the user sees them (Mayur, 22-10-2026). */}
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Eligibility filter" className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const active = s.value === status;
            return (
              <Link
                key={s.value}
                href={href({ status: s.value })}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  active ? "border-brand-green-dark bg-brand-green/10 font-semibold text-brand-green-dark" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                }`}
              >
                {s.label} <span className="tabular-nums">({nf.format(countOf(s.value))})</span>
              </Link>
            );
          })}
        </nav>
        {chips.length ? (
          <div role="group" aria-label="Filters from the report" className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-gray-300 sm:block" />
            <span className="text-gray-600">Filter:</span>
            {chips.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1 rounded-lg border border-brand-green-dark bg-brand-green/10 py-1.5 pr-1.5 pl-3 font-semibold text-brand-green-dark"
              >
                {c.label}
                <Link
                  href={href({ filters: c.without })}
                  aria-label={`Remove the filter ${c.label}`}
                  title="Remove this filter"
                  className="grid h-6 w-6 place-items-center rounded-md text-brand-green-dark outline-none hover:bg-brand-green/20 focus-visible:ring-2 focus-visible:ring-brand-green/50"
                >
                  <span aria-hidden="true">✕</span>
                </Link>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {list.rows.length === 0 ? (
        <p className="text-sm text-gray-600">
          {q ? `No ${emptyKind}dealer found for “${q}” in ${emptyWhere}.` : `No ${emptyKind}dealer in ${emptyWhere}.`}
          {status !== "ALL" && list.counts.all > 0 ? (
            <>
              {" "}
              <Link href={href({ status: "ALL" })} className="font-medium text-brand-green-dark underline-offset-2 hover:underline">
                Show all ({nf.format(list.counts.all)})
              </Link>
            </>
          ) : null}
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          {/* Table from 640 px. "relative": keeps the sr-only labels inside the scroll box (no page-level scroll). */}
          <div className="relative hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Dealers of {schemeTag} ({schemeName})
              </caption>
              <thead>
                <tr className="border-b border-gray-200 text-left text-[0.9375rem] leading-snug text-gray-900">
                  <th scope="col" className="px-3 py-2 font-bold">Dealer code</th>
                  <th scope="col" className="px-3 py-2 font-bold">Name</th>
                  <th scope="col" className="px-3 py-2 font-bold">Region</th>
                  <th scope="col" className="px-3 py-2 font-bold">Eligibility</th>
                  <th scope="col" className="px-3 py-2 font-bold">Slab</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((d) => (
                  <tr key={d.code} className="border-b border-gray-100 last:border-0">
                    <td className="px-3 py-2">
                      <Link href={detailHref(d.code)} className="font-medium text-brand-green-dark underline-offset-2 hover:underline">
                        {d.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{d.name ?? EMPTY_VALUE}</td>
                    <td className="px-3 py-2">{d.regionName ?? <span className="text-gray-500">Region unknown</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <LockBadge status={d.slabNo != null ? "UNLOCKED" : "LOCKED"} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <SlabLink row={d} href={detailHref(d.code)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards below 640 px (SFA / phone): eligibility and slab stay visible without a sideways scroll. */}
          <ul className="divide-y divide-gray-100 sm:hidden" aria-label={`Dealers of ${schemeTag}`}>
            {list.rows.map((d) => (
              <li key={d.code} className="flex flex-col gap-1 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <Link href={detailHref(d.code)} className="font-medium break-all text-brand-green-dark underline-offset-2 hover:underline">
                    {d.code}
                  </Link>
                  <LockBadge status={d.slabNo != null ? "UNLOCKED" : "LOCKED"} />
                </div>
                <p className="text-gray-900">{d.name ?? EMPTY_VALUE}</p>
                <p className="text-gray-600">{d.regionName ?? "Region unknown"}</p>
                <SlabLink row={d} href={detailHref(d.code)} />
              </li>
            ))}
          </ul>

          {/* Page numbers in the middle (from 1024 px: count on the left, "Go to page" on the right); stacked and centred below. */}
          <nav
            aria-label="Pages"
            className="grid items-center justify-items-center gap-2 border-t border-gray-100 px-3 py-2 text-xs text-gray-600 lg:grid-cols-[1fr_auto_1fr]"
          >
            <span className="lg:justify-self-start">
              Page {nf.format(Math.min(page, pages))} of {nf.format(pages)} · {nf.format(total)} dealers
            </span>
            <PageLinks page={Math.min(page, pages)} pages={pages} href={(p) => href({ page: p })} />
            {pages > PAGE_WINDOW ? (
              <form method="get" className="flex items-center gap-1 lg:justify-self-end">
                <input type="hidden" name="scheme" value={schemeTag} />
                {status !== DEFAULT_STATUS ? <input type="hidden" name="status" value={status} /> : null}
                {q ? <input type="hidden" name="q" value={q} /> : null}
                {filterHidden}
                <label htmlFor="go-page">Go to page</label>
                <input
                  id="go-page"
                  name="page"
                  type="number"
                  min={1}
                  max={pages}
                  required
                  className="h-8 w-20 rounded-md border border-gray-300 bg-white px-2 tabular-nums focus:border-brand-green-dark focus:outline-2 focus:outline-brand-green/40"
                />
                <button type="submit" className={`${pageLink} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}>
                  Go
                </button>
              </form>
            ) : null}
          </nav>
        </div>
      )}
    </div>
  );
}
