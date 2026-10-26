import type { Metadata } from "next";
import Link from "next/link";
import { getDealerStatus, listActiveSchemeTags } from "@/server/repo";
import { requireAdmin } from "@/lib/auth/admin-server";
import { DEALER_CODE_PATTERN } from "@/lib/auth/embed-token";
import { DealerView } from "@/components/dealer-view/DealerView";
import { MessagePanel } from "@/components/MessagePanel";
import { saveAdminChoiceAction } from "./actions";
import { first, listQuery, parseListState } from "../list-filters";

export const metadata: Metadata = { title: "Dealer | Scheme Calculator" };

export default async function AdminDealerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { code: rawCode } = await params;
  const sp = await searchParams;
  // ?scheme=<tag>: opened from the dealer list of one scheme. Show only that scheme.
  const rawScheme = first(sp.scheme);
  const tags = rawScheme ? await listActiveSchemeTags() : [];
  const schemeTag = tags.includes(rawScheme) ? rawScheme : null;
  let code = rawCode;
  try {
    code = decodeURIComponent(rawCode);
  } catch {
    // keep raw value; the pattern check below rejects it
  }

  // "Back to dealers" opens the list as it was: the search, tab, page and report filters come from the list link
  // (the same parser and writer as the list, see list-filters.ts).
  const backHref = schemeTag ? `/admin/dealers?${listQuery(parseListState(sp, tags))}` : "/admin/dealers";

  const back = (
    <Link
      href={backHref}
      className="text-sm text-brand-green-dark underline-offset-2 hover:underline"
    >
      ← Back to dealers
    </Link>
  );

  if (!DEALER_CODE_PATTERN.test(code)) {
    return (
      <div className="flex flex-col gap-3">
        {back}
        <MessagePanel title="Dealer code is not valid" />
      </div>
    );
  }

  const status = await getDealerStatus(code, schemeTag ? [schemeTag] : undefined);
  return (
    <div className="flex flex-col gap-3">
      {back}
      <p className="text-xs text-gray-500">
        Support view: this is the same view that the dealer sees in DMS / SFA. Here you can also enter the dealer&apos;s reward
        choice for a scheme where the dealer is in a slab.
        {schemeTag ? (
          <>
            {" "}
            Scheme {schemeTag} only.{" "}
            <Link href={`/admin/dealers/${encodeURIComponent(code)}`} className="text-brand-green-dark underline-offset-2 hover:underline">
              Show all schemes
            </Link>
          </>
        ) : null}
      </p>
      {status ? (
        <div className="rounded-xl border border-gray-200 bg-white">
          <DealerView status={status} audience="admin" choiceEdit={{ dealerCode: status.dealer_code, action: saveAdminChoiceAction }} />
        </div>
      ) : (
        <MessagePanel title={`No scheme data for dealer ${code} yet`} />
      )}
    </div>
  );
}
