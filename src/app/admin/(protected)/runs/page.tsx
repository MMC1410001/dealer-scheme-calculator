import type { Metadata } from "next";
import { listSyncRuns } from "@/server/repo";
import { requireAdmin } from "@/lib/auth/admin-server";
import { EMPTY_VALUE, formatCount, formatDate, formatDateTime } from "@/components/format";
import type { SyncRunSummary } from "@/server/types";
import { SyncStatusBadge } from "@/components/admin/SyncStatusBadge";

export const metadata: Metadata = { title: "Sync runs | Scheme Calculator" };

function formatBytes(n: number | null): string {
  if (n == null) return EMPTY_VALUE;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Run duration: "45 s", "2 min 5 s", "1 h 3 min". Null while running. */
function formatDuration(startedAt: string, finishedAt: string | null): string | null {
  if (!finishedAt) return null;
  const sec = Math.max(0, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  if (Number.isNaN(sec)) return null;
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ""}`;
  return `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`;
}

/** "Data as of" is a day boundary (IST ISO string): show the date only. */
const dataDate = (iso: string | null) => formatDate(iso ? iso.slice(0, 10) : null);

function RunTime({ r }: { r: SyncRunSummary }) {
  const duration = formatDuration(r.startedAt, r.finishedAt);
  return (
    <>
      <span className="block whitespace-nowrap">{formatDateTime(r.startedAt)}</span>
      <span className="block text-xs text-gray-500">{duration ? `took ${duration}` : r.status === "RUNNING" ? "running" : "not finished"}</span>
    </>
  );
}

export default async function RunsPage() {
  await requireAdmin(["ADMIN"]);
  const runs = await listSyncRuns(50);
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Sync runs</h1>
      {runs.length === 0 ? (
        <p className="text-sm text-gray-600">No sync run yet.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          {/* Table from 1024 px: start and duration in one column, so that the table fits without a sideways scroll. */}
          <div className="relative hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <caption className="sr-only">Latest {runs.length} sync runs</caption>
              <thead>
                <tr className="border-b border-gray-200 text-left text-[0.9375rem] leading-snug text-gray-900">
                  <th scope="col" className="px-3 py-2 font-bold">#</th>
                  <th scope="col" className="px-3 py-2 font-bold">Source</th>
                  <th scope="col" className="px-3 py-2 font-bold">Status</th>
                  <th scope="col" className="px-3 py-2 font-bold">Run</th>
                  <th scope="col" className="px-3 py-2 font-bold whitespace-nowrap">Data as of</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold">Rows</th>
                  <th scope="col" className="px-3 py-2 text-right font-bold whitespace-nowrap">BigQuery bytes</th>
                  <th scope="col" className="w-full px-3 py-2 font-bold">Message</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 align-top last:border-0">
                    <td className="px-3 py-2 tabular-nums">{r.id}</td>
                    <td className="px-3 py-2">{r.source}</td>
                    <td className="px-3 py-2">
                      <SyncStatusBadge status={r.status} />
                    </td>
                    <td className="px-3 py-2">
                      <RunTime r={r} />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{dataDate(r.dataAsOf)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCount(r.rowCount)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatBytes(r.bytesProcessed)}</td>
                    <td className="px-3 py-2 break-words text-gray-700">{r.message ?? EMPTY_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards below 1024 px. */}
          <ul className="divide-y divide-gray-100 lg:hidden" aria-label={`Latest ${runs.length} sync runs`}>
            {runs.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-900">
                    #{r.id} <span className="font-normal text-gray-600">{r.source}</span>
                  </span>
                  <SyncStatusBadge status={r.status} />
                </div>
                <div className="text-gray-800">
                  <RunTime r={r} />
                </div>
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-gray-500">Data as of</dt>
                    <dd className="text-gray-900">{dataDate(r.dataAsOf)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Rows</dt>
                    <dd className="text-gray-900 tabular-nums">{formatCount(r.rowCount)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">BigQuery bytes</dt>
                    <dd className="text-gray-900 tabular-nums">{formatBytes(r.bytesProcessed)}</dd>
                  </div>
                </dl>
                {r.message ? <p className="break-words text-gray-700">{r.message}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
