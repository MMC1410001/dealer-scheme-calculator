import type { SyncRunSummary } from "@/server/types";

const STYLES: Record<SyncRunSummary["status"], string> = {
  SUCCESS: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  RUNNING: "bg-sky-50 text-sky-800 ring-sky-200",
  FAILED: "bg-rose-50 text-rose-800 ring-rose-200",
};

const LABELS: Record<SyncRunSummary["status"], string> = { SUCCESS: "Success", RUNNING: "Running", FAILED: "Failed" };

export function SyncStatusBadge({ status }: { status: SyncRunSummary["status"] }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status] ?? "bg-gray-100 text-gray-700 ring-gray-200"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
