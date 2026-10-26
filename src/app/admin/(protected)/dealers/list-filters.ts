/**
 * List state of the Dealers page: one parser and one query writer, used by the list (page links, tabs, forms) and by
 * the dealer page ("Back to dealers"), so that the two pages cannot drift.
 *
 * Report filters: the count links of the report open the list with these filters, so that the list shows the same
 * number of dealers as the report:
 *   slab=N    only the dealers in Slab N (a slab row of the report)
 *   scope=in  only the dealers that the report counts as "In scope" (without the region-unknown dealers and the
 *             dealers enrolled in the other scheme, which the Locked and All tabs also list)
 */
import type { DealerListStatus } from "@/server/types";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface DealerListFilters {
  slabNo: number | null;
  inScopeOnly: boolean;
}

export interface DealerListState extends DealerListFilters {
  schemeTag: string;
  status: DealerListStatus;
  q: string;
  page: number;
}

export const LIST_STATUSES: readonly DealerListStatus[] = ["UNLOCKED", "LOCKED", "ALL"];
// Unlocked first and the default (Mayur, 22-10-2026): the dealers in a slab are the ones the business looks at.
export const DEFAULT_STATUS: DealerListStatus = "UNLOCKED";
export const MAX_QUERY = 64;
const MAX_SLAB_NO = 99;

/** First value of a query parameter ("" when missing). */
export const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseListFilters(sp: SearchParams): DealerListFilters {
  const raw = first(sp.slab);
  const n = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
  return {
    slabNo: n >= 1 && n <= MAX_SLAB_NO ? n : null,
    inScopeOnly: first(sp.scope) === "in",
  };
}

/**
 * Reads the list state. Unknown values fall back to the defaults: the first active tag (FB-PAN), Unlocked, no
 * search, page 1, no report filter.
 */
export function parseListState(sp: SearchParams, activeTags: readonly string[]): DealerListState {
  const scheme = first(sp.scheme);
  const status = first(sp.status);
  const page = Number.parseInt(first(sp.page), 10);
  return {
    schemeTag: activeTags.includes(scheme) ? scheme : (activeTags[0] ?? ""),
    status: LIST_STATUSES.includes(status as DealerListStatus) ? (status as DealerListStatus) : DEFAULT_STATUS,
    q: first(sp.q).trim().slice(0, MAX_QUERY),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    ...parseListFilters(sp),
  };
}

/** Writes the filters into a list query (nothing for a filter that is off). */
export function setListFilters(u: URLSearchParams, f: DealerListFilters): URLSearchParams {
  if (f.slabNo != null) u.set("slab", String(f.slabNo));
  if (f.inScopeOnly) u.set("scope", "in");
  return u;
}

/** List query in a fixed order (scheme, status, q, slab, scope, page). Default values are left out. */
export function listQuery(s: DealerListState): string {
  const u = new URLSearchParams({ scheme: s.schemeTag });
  if (s.status !== DEFAULT_STATUS) u.set("status", s.status);
  if (s.q) u.set("q", s.q);
  setListFilters(u, s);
  if (s.page > 1) u.set("page", String(s.page));
  return u.toString();
}
