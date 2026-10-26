import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/auth/admin-server";
import { EMPTY_VALUE, formatDate, formatDateTime } from "@/components/format";
import { DownloadIcon } from "@/components/icons";
import { historyDownloadHref, listChoiceHistory, type HistoryEntry } from "@/server/reward-choice-history";
import { UPLOAD_MAX_ROWS } from "@/server/reward-choice-upload";
import { REWARD_CHOICE_LOG_RETENTION_MONTHS } from "@/sync/cleanup";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = { title: "Reward choices | Scheme Calculator" };

// Example rows for reference: dealer_code starts with "#", so the upload skips them (EXAMPLE_ROW_PREFIX).
// The dealer codes are made up. Never put a real dealer code here.
const TEMPLATE_CSV = [
  "dealer_code,scheme_tag,choice,destination,chosen_by",
  "# Example rows: the upload skips every row whose dealer_code starts with #. Delete them or keep them.,,,,",
  "#1234567890,FB-PAN,GIFT,,SO1234",
  "#1234567891,FB-TNHPJK,CN,,",
  "#1234567892,SP-Q3,GIFT,OVERSEAS,SO5678",
  "#1234567893,SP-Q3,CN,,",
].join("\r\n") + "\r\n";
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE_CSV)}`;

const COLUMNS: Array<[string, string]> = [
  ["dealer_code", "Required. The dealer code (a child code is saved under its parent)."],
  ["scheme_tag", "Required. For example FB-PAN, FB-TNHPJK or SP-Q3."],
  ["choice", "Required. GIFT or CN."],
  ["destination", "Star Points only: CRUISE or OVERSEAS for the extra tickets. Only for a dealer in Slab 7. Else leave empty."],
  ["chosen_by", "Optional. Who recorded the choice (for example the user in SAP or SFA). Empty = your user name."],
];

const SOURCE_LABELS: Record<string, string> = { UPLOAD: "File upload", API: "API", ADMIN: "Dealer page", DEMO: "Demo data" };
const nf = new Intl.NumberFormat("en-IN");

function entryWhen(e: HistoryEntry): string {
  return e.kind === "upload" ? formatDateTime(e.at) : formatDate(e.day);
}

function entryDetails(e: HistoryEntry): string {
  // e.at is an IST ISO string: "2026-10-22T19:06:05+05:30" → "19:06".
  if (e.kind === "day") return e.source === "UPLOAD" ? "Upload before the history started (no file name)" : `Changes of the day, last at ${e.at.slice(11, 16)} IST`;
  return `${nf.format(e.rowCount)} rows: ${nf.format(e.changed)} changed, ${nf.format(e.unchanged)} unchanged, ${nf.format(e.refused)} refused`;
}

/** Download of the changed rows, or a note when nothing changed. */
function DownloadLink({ e }: { e: HistoryEntry }) {
  const href = historyDownloadHref(e);
  if (!href) return <span className="text-xs text-gray-500">No changes</span>;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium whitespace-nowrap text-brand-green-dark hover:bg-gray-50"
    >
      <DownloadIcon className="h-3.5 w-3.5" />
      Download
    </a>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  const key = (e: HistoryEntry) => (e.kind === "upload" ? `u${e.id}` : `d${e.source}${e.day}${e.actor ?? ""}`);
  return (
    <section aria-labelledby="history" className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="px-4 pt-4 sm:px-5">
        <h2 id="history" className="text-sm font-semibold text-gray-900">
          History
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Each file upload, and the changes from the API and the dealer page (one entry for each day and sender). Download gives the
          choices that the entry changed. Kept for {REWARD_CHOICE_LOG_RETENTION_MONTHS} months. The uploaded file is not kept.
        </p>
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-600 sm:px-5">No reward choice saved yet.</p>
      ) : (
        <>
          {/* Table from 768 px, cards below. "relative": keeps the sr-only caption inside the scroll box. */}
          <div className="relative mt-3 hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Reward choice history</caption>
              <thead>
                <tr className="border-y border-gray-200 bg-gray-50 text-left text-[0.9375rem] leading-snug text-gray-900">
                  <th scope="col" className="px-4 py-2 font-bold sm:pl-5">When</th>
                  <th scope="col" className="px-3 py-2 font-bold">Source</th>
                  <th scope="col" className="px-3 py-2 font-bold whitespace-nowrap">Sent by</th>
                  <th scope="col" className="w-full px-3 py-2 font-bold">Details</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Changed</th>
                  <th scope="col" className="px-4 py-2 font-bold sm:pr-5">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={key(e)} className="border-b border-gray-100 align-top last:border-0">
                    <td className="px-4 py-2.5 whitespace-nowrap sm:pl-5">{entryWhen(e)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{SOURCE_LABELS[e.kind === "upload" ? "UPLOAD" : e.source] ?? (e.kind === "day" ? e.source : "")}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{e.actor ?? EMPTY_VALUE}</td>
                    <td className="px-3 py-2.5 text-gray-700">
                      {e.kind === "upload" ? <span className="block font-medium break-all text-gray-900">{e.fileName}</span> : null}
                      {entryDetails(e)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{nf.format(e.changed)}</td>
                    <td className="px-4 py-2.5 sm:pr-5">
                      <DownloadLink e={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-200 md:hidden" aria-label="Reward choice history">
            {entries.map((e) => (
              <li key={key(e)} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">
                    {SOURCE_LABELS[e.kind === "upload" ? "UPLOAD" : e.source] ?? (e.kind === "day" ? e.source : "")}
                  </span>
                  <DownloadLink e={e} />
                </div>
                <span className="text-xs text-gray-500">
                  {entryWhen(e)} · {e.actor ?? EMPTY_VALUE}
                </span>
                {e.kind === "upload" ? <span className="break-all text-gray-900">{e.fileName}</span> : null}
                <span className="text-gray-700">{entryDetails(e)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default async function ChoicesPage() {
  await requireAdmin();
  const history = await listChoiceHistory(getDb());
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Reward choices</h1>
        <p className="text-sm text-gray-600">
          Upload the dealers&apos; choice of gift or CN for many dealers at one time. A new choice replaces the saved choice. To
          enter the choice of one dealer, open the dealer in{" "}
          <Link href="/admin/dealers" className="text-brand-green-dark underline">
            Dealers
          </Link>
          .
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-900">File format</h2>
        <p className="mb-2 text-sm text-gray-700">
          Row 1 has the column names. One row for each dealer and scheme. Up to {UPLOAD_MAX_ROWS.toLocaleString("en-IN")} rows. Use
          the <span className="font-medium">Download template</span> button next to <span className="font-medium">Upload</span>. The
          template has example rows. Their dealer code starts with <code className="font-mono text-xs">#</code>, so the upload skips
          them: you can delete them or keep them.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {COLUMNS.map(([name, text]) => (
              <tr key={name} className="border-b border-gray-100 align-top">
                <th scope="row" className="py-1.5 pr-3 text-left font-mono text-xs font-medium text-gray-900">
                  {name}
                </th>
                <td className="py-1.5 text-gray-700">{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-gray-700">
          A row is refused when the dealer is not in a slab of the scheme, when a value is not valid, or when the same dealer and scheme
          are in more than one row. The other rows are saved.
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <UploadForm templateHref={TEMPLATE_HREF} />
      </section>

      <History entries={history} />
    </div>
  );
}
