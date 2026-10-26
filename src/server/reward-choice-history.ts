/**
 * Reward choice history (/admin/choices, Mayur, 22-10-2026). One entry for each file upload, and for the changes
 * without a file (API, dealer page, demo data) one entry for each day, source and sender (actor). The entries and
 * their downloads come from dealer_reward_choice_log, so they are kept as long as the log (3 months, cleanup).
 * The uploaded file itself is not stored.
 *
 * Do not import "server-only" here: tests import this module.
 */
import { desc, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rewardChoiceUpload } from "@/db/schema";
import { toIstIso } from "@/server/repo";

export type HistorySource = "UPLOAD" | "API" | "ADMIN" | "DEMO";

export type HistoryEntry =
  | {
      kind: "upload";
      id: number;
      at: string;
      actor: string;
      fileName: string;
      rowCount: number;
      changed: number;
      unchanged: number;
      refused: number;
    }
  | {
      kind: "day";
      source: string;
      /** YYYY-MM-DD, India time. */
      day: string;
      /** Last change of that day (IST ISO). */
      at: string;
      actor: string | null;
      changed: number;
    };

/** Which log rows a download returns. */
export type HistorySelector = { kind: "upload"; id: number } | { kind: "day"; source: string; day: string; actor: string | null };

export interface HistoryRow {
  changedAt: string;
  dealerCode: string;
  schemeTag: string;
  choice: string;
  destination: string | null;
  chosenBy: string | null;
  source: string;
  actor: string | null;
}

export const HISTORY_LIMIT = 50;
/** Rows in one download. An upload has at most 20,000 rows; an API day can have more. */
export const HISTORY_DOWNLOAD_MAX_ROWS = 200_000;

const SOURCE_PATTERN = /^[A-Z]{1,16}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ACTOR_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;

/** The latest entries, newest first. */
export async function listChoiceHistory(db: Db, limit = HISTORY_LIMIT): Promise<HistoryEntry[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  const uploads = await db.select().from(rewardChoiceUpload).orderBy(desc(rewardChoiceUpload.uploadedAt)).limit(n);
  const days = (
    await db.execute<{ source: string; day: string; actor: string | null; changed: number; last_at: Date | string }>(sql`
      SELECT source, to_char(changed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day, actor,
             COUNT(*)::int AS changed, MAX(changed_at) AS last_at
      FROM dealer_reward_choice_log
      WHERE upload_id IS NULL
      GROUP BY 1, 2, 3
      ORDER BY last_at DESC
      LIMIT ${n}
    `)
  ).rows;
  const entries: HistoryEntry[] = [
    ...uploads.map(
      (u): HistoryEntry => ({
        kind: "upload",
        id: u.id,
        at: toIstIso(u.uploadedAt) ?? "",
        actor: u.uploadedBy,
        fileName: u.fileName,
        rowCount: u.rowCount,
        changed: u.changed,
        unchanged: u.unchanged,
        refused: u.refused,
      }),
    ),
    ...days.map(
      (d): HistoryEntry => ({ kind: "day", source: d.source, day: d.day, at: toIstIso(d.last_at) ?? "", actor: d.actor, changed: Number(d.changed) }),
    ),
  ];
  return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);
}

/** Download link of an entry (null: nothing changed, so nothing to download). */
export function historyDownloadHref(e: HistoryEntry): string | null {
  if (e.changed === 0) return null;
  const q = new URLSearchParams();
  if (e.kind === "upload") q.set("upload", String(e.id));
  else {
    q.set("source", e.source);
    q.set("day", e.day);
    if (e.actor) q.set("actor", e.actor);
  }
  return `/admin/choices/history?${q.toString()}`;
}

/** Reads a download link. Null when the parameters are not valid. */
export function parseHistorySelector(q: URLSearchParams): HistorySelector | null {
  const upload = q.get("upload");
  if (upload !== null) {
    const id = Number(upload);
    return /^\d{1,9}$/.test(upload) && id > 0 ? { kind: "upload", id } : null;
  }
  const source = q.get("source") ?? "";
  const day = q.get("day") ?? "";
  const actor = q.get("actor");
  if (!SOURCE_PATTERN.test(source) || !DAY_PATTERN.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  if (actor !== null && !ACTOR_PATTERN.test(actor)) return null;
  return { kind: "day", source, day, actor };
}

/** The changed rows of one entry, oldest first. */
export async function choiceHistoryRows(db: Db, s: HistorySelector): Promise<HistoryRow[]> {
  const where =
    s.kind === "upload"
      ? sql`upload_id = ${s.id}`
      : sql`upload_id IS NULL AND source = ${s.source} AND actor IS NOT DISTINCT FROM ${s.actor}
            AND (changed_at AT TIME ZONE 'Asia/Kolkata')::date = ${s.day}::date`;
  const rows = (
    await db.execute<{
      changed_at: Date | string;
      dealer_code: string;
      scheme_tag: string;
      choice: string;
      destination: string | null;
      chosen_by: string | null;
      source: string;
      actor: string | null;
    }>(sql`
      SELECT changed_at, dealer_code, scheme_tag, choice, destination, chosen_by, source, actor
      FROM dealer_reward_choice_log WHERE ${where}
      ORDER BY changed_at, id
      LIMIT ${HISTORY_DOWNLOAD_MAX_ROWS}
    `)
  ).rows;
  return rows.map((r) => ({
    changedAt: toIstIso(r.changed_at) ?? "",
    dealerCode: r.dealer_code,
    schemeTag: r.scheme_tag,
    choice: r.choice,
    destination: r.destination,
    chosenBy: r.chosen_by,
    source: r.source,
    actor: r.actor,
  }));
}

/** CSV cell: quoted when needed; a leading = + - @ gets a ' so that a spreadsheet does not run it as a formula. */
export function csvCell(v: string | null): string {
  let s = v ?? "";
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const HISTORY_CSV_COLUMNS = ["changed_at", "dealer_code", "scheme_tag", "choice", "destination", "chosen_by", "source", "sent_by"];

export function historyCsv(rows: HistoryRow[]): string {
  const lines = [HISTORY_CSV_COLUMNS.join(",")];
  for (const r of rows) {
    // "2026-10-22T18:58:42+05:30" → "2026-10-22 18:58:42" (India time).
    const at = r.changedAt.slice(0, 19).replace("T", " ");
    lines.push([at, r.dealerCode, r.schemeTag, r.choice, r.destination, r.chosenBy, r.source, r.actor].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** File name of a download. */
export function historyFileName(s: HistorySelector): string {
  return s.kind === "upload" ? `reward-choices-upload-${s.id}.csv` : `reward-choices-${s.source.toLowerCase()}-${s.day}.csv`;
}
