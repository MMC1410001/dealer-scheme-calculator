/**
 * Development only: a fake host page that embeds /embed in an iframe, with a token minted on the server.
 * The page signs a valid token for any dealer code, so it needs the same switch as the plain dealer_code test
 * parameter: NODE_ENV is not production AND ALLOW_DEV_DEALER_PARAM=true. Otherwise it returns 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DEALER_CODE_PATTERN, isDevDealerParamAllowed, parseSchemeTags, signEmbedToken } from "@/lib/auth/embed-token";
import { AutoHeightFrame } from "./AutoHeightFrame";

export const metadata: Metadata = { title: "Dev iframe host" };

const TTL_SECONDS = 60 * 60;

export default async function DevHostPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isDevDealerParamAllowed()) notFound();
  const sp = await searchParams;

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const dealerCode = first(sp.dealer_code).trim();
  const tagsRaw = first(sp.tags).trim();
  const tags = parseSchemeTags(tagsRaw);

  let src: string | null = null;
  let error: string | null = null;
  if (dealerCode) {
    if (!DEALER_CODE_PATTERN.test(dealerCode)) {
      error = "Dealer code: use 1 to 32 letters, digits, '_' or '-'.";
    } else {
      try {
        const token = signEmbedToken({ dealerCode, ttlSeconds: TTL_SECONDS });
        const qs = new URLSearchParams({ token });
        if (tags.length > 0) qs.set("tags", tags.join(","));
        src = `/embed?${qs.toString()}`;
      } catch (err) {
        error = err instanceof Error ? err.message : "Could not sign the token.";
      }
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">Dev iframe host</h1>
        <p className="text-sm text-gray-600">Development only. Simulates SAP Commerce / SFA: signs a token (1 hour), embeds /embed and sizes the iframe from its height message.</p>
      </div>
      <form method="get" className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          Dealer code
          <input name="dealer_code" defaultValue={dealerCode} required className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Scheme tags (optional, comma-separated)
          <input name="tags" defaultValue={tagsRaw} placeholder="FB-PAN,SP-Q3" className="rounded-md border border-gray-300 px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-brand-green-dark px-4 py-2 text-sm font-semibold text-white">
          Open
        </button>
      </form>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
      {src ? (
        <div className="flex flex-col gap-6 lg:flex-row">
          <section className="flex-1">
            <h2 className="mb-1 text-sm font-semibold text-gray-700">Desktop</h2>
            <AutoHeightFrame title="Dealer schemes (desktop)" src={src} className="w-full rounded-lg border border-gray-300" />
          </section>
          <section>
            <h2 className="mb-1 text-sm font-semibold text-gray-700">Mobile (375 px)</h2>
            <AutoHeightFrame title="Dealer schemes (mobile)" src={src} className="w-[375px] max-w-full rounded-lg border border-gray-300" />
          </section>
        </div>
      ) : null}
    </main>
  );
}
