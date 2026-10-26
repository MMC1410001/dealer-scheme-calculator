/**
 * Iframe dealer view, embedded in SAP Commerce (DMS) / SFA.
 * Identity: ?token=<signed embed token> (see src/lib/auth/embed-token.ts).
 * Development only: ?dealer_code=<code> when ALLOW_DEV_DEALER_PARAM=true and NODE_ENV is not production.
 * Optional: ?tags=FB-PAN,SP-Q3 to show only these schemes.
 * The page reads stored results only. It never queries BigQuery.
 * The page sends its content height to the host page (src/components/EmbedAutoHeight.tsx).
 */
import type { Metadata } from "next";
import { getDealerStatus } from "@/server/repo";
import { parseSchemeTags, resolveEmbedIdentity } from "@/lib/auth/embed-token";
import { DealerView } from "@/components/dealer-view/DealerView";
import { EmbedAutoHeight } from "@/components/EmbedAutoHeight";
import { MessagePanel } from "@/components/MessagePanel";
import { parseAllowedOrigins } from "@/lib/auth/frame-policy";

export const metadata: Metadata = {
  title: "My Schemes",
  referrer: "no-referrer",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function EmbedPage({ searchParams }: { searchParams: SearchParams }) {
  const { origins } = parseAllowedOrigins(process.env.EMBED_ALLOWED_ORIGINS);
  return <EmbedAutoHeight origins={origins}>{await embedContent(await searchParams)}</EmbedAutoHeight>;
}

async function embedContent(sp: Awaited<SearchParams>) {
  const identity = resolveEmbedIdentity({ token: first(sp.token), dealerCode: first(sp.dealer_code) });

  if (!identity.ok) {
    if (identity.error === "CONFIG") console.error("[embed] EMBED_SIGNING_SECRET is not configured.");
    return (
      <main className="flex-1">
        <MessagePanel title="Session expired" tone="warning">
          <p>Please close this page and open My Schemes again from DMS or SFA.</p>
        </MessagePanel>
      </main>
    );
  }

  const tags = parseSchemeTags(first(sp.tags));
  let status: Awaited<ReturnType<typeof getDealerStatus>>;
  try {
    status = await getDealerStatus(identity.dealerCode, tags.length > 0 ? tags : undefined);
  } catch (err) {
    console.error("[embed] getDealerStatus failed:", err instanceof Error ? err.message : err);
    return (
      <main className="flex-1">
        <MessagePanel title="Scheme data is not available right now" tone="warning">
          <p>Please try again in a few minutes.</p>
        </MessagePanel>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="flex-1">
        <MessagePanel title="No scheme data for your dealer code yet">
          <p>Your scheme status shows here after the next data update.</p>
        </MessagePanel>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <DealerView status={status} audience="dealer" />
    </main>
  );
}
