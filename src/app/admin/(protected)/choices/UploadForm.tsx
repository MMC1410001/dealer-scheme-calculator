"use client";

import { useActionState, useMemo } from "react";
import { formatCount } from "@/components/format";
import { DownloadIcon } from "@/components/icons";
import { errorsToCsv } from "@/server/reward-choice";
import { uploadChoicesAction, type UploadState } from "./actions";

const INITIAL_UPLOAD_STATE: UploadState = { status: "idle", message: null, fileName: null, rows: 0, changed: 0, unchanged: 0, errors: [] };

/** Errors shown on the page. All errors are in the download. */
const SHOWN_ERRORS = 200;

export function UploadForm({ templateHref }: { templateHref: string }) {
  const [state, formAction, pending] = useActionState(uploadChoicesAction, INITIAL_UPLOAD_STATE);
  const errorsHref = useMemo(
    () => (state.errors.length > 0 ? `data:text/csv;charset=utf-8,${encodeURIComponent(errorsToCsv(state.errors))}` : null),
    [state.errors],
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          File (.csv or .xlsx, 5 MB or smaller)
          <input
            name="file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-brand-green-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green disabled:opacity-60"
          >
            {pending ? "Uploading…" : "Upload"}
          </button>
          <a
            href={templateHref}
            download="reward-choice-template.csv"
            className="inline-flex items-center gap-1.5 rounded-md border border-brand-green-dark bg-white px-4 py-2 text-sm font-semibold text-brand-green-dark hover:bg-brand-green/10"
          >
            <DownloadIcon className="h-4 w-4" />
            Download template (CSV)
          </a>
        </div>
      </form>

      {state.status === "error" ? (
        <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.fileName ? `${state.fileName}: ` : ""}
          {state.message}
        </p>
      ) : null}

      {state.status === "done" ? (
        <section aria-label="Upload result" className="flex flex-col gap-3">
          <p role="status" className="text-sm text-gray-700">
            {state.fileName}: {formatCount(state.rows)} rows read.
          </p>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Saved (new or changed)", state.changed],
              ["No change", state.unchanged],
              ["Refused", state.errors.length],
            ].map(([label, v]) => (
              <div key={label as string} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <dt className="text-xs text-gray-500">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatCount(v as number)}</dd>
              </div>
            ))}
          </dl>
          {state.errors.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-900">Refused rows</h2>
                {errorsHref ? (
                  <a href={errorsHref} download="reward-choice-errors.csv" className="text-sm text-brand-green-dark underline">
                    Download all errors (CSV)
                  </a>
                ) : null}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-[0.9375rem] leading-snug text-gray-900">
                    <th scope="col" className="py-1.5 pr-3 font-bold">Row</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Dealer code</th>
                    <th scope="col" className="py-1.5 pr-3 font-bold">Scheme tag</th>
                    <th scope="col" className="py-1.5 font-bold">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {state.errors.slice(0, SHOWN_ERRORS).map((e, i) => (
                    <tr key={`${e.row}-${i}`} className="border-b border-gray-100 align-top">
                      <td className="py-1.5 pr-3 tabular-nums">{e.row}</td>
                      <td className="py-1.5 pr-3">{e.dealerCode}</td>
                      <td className="py-1.5 pr-3">{e.schemeTag}</td>
                      <td className="py-1.5">{e.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {state.errors.length > SHOWN_ERRORS ? (
                <p className="mt-2 text-xs text-gray-500">
                  The first {SHOWN_ERRORS} of {formatCount(state.errors.length)} refused rows are shown. Download the CSV for all of them.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
