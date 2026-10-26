"use server";

/**
 * Bulk reward choice upload (admin). Valid rows are saved; each refused row is reported with its row number.
 * Rule (Mayur, 22-10-2026): a row for a dealer who is not in a slab is refused.
 */
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { rewardChoiceUpload } from "@/db/schema";
import { getAdminSession } from "@/lib/auth/admin-server";
import type { UploadRowError } from "@/server/reward-choice";
import { readUploadTable, validateUploadTable } from "@/server/reward-choice-upload";
import { saveRewardChoices, type SaveOutcome } from "@/server/reward-choice-store";

export interface UploadState {
  status: "idle" | "done" | "error";
  message: string | null;
  fileName: string | null;
  rows: number;
  changed: number;
  unchanged: number;
  errors: UploadRowError[];
}

const EMPTY: UploadState = { status: "idle", message: null, fileName: null, rows: 0, changed: 0, unchanged: 0, errors: [] };

export async function uploadChoicesAction(_prev: UploadState, form: FormData): Promise<UploadState> {
  const session = await getAdminSession();
  if (!session) return { ...EMPTY, status: "error", message: "Your session has ended. Log in again." };

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...EMPTY, status: "error", message: "Select a .csv or .xlsx file." };
  }
  const fileName = file.name.slice(0, 200);
  const fail = (message: string): UploadState => ({ ...EMPTY, status: "error", message, fileName });

  const read = await readUploadTable(fileName, new Uint8Array(await file.arrayBuffer()));
  if (!read.ok) return fail(read.message);
  const v = validateUploadTable(read.table);
  if (!v.ok) return fail(v.message);
  const { items, errors, rowCount } = v.parsed;

  const db = getDb();
  let uploadId: number | null = null;
  let outcomes: SaveOutcome[];
  try {
    // History entry first: the log rows of this upload refer to it (upload_id). Counts are set after the save.
    [{ id: uploadId }] = await db
      .insert(rewardChoiceUpload)
      .values({ fileName, uploadedBy: session.username, rowCount })
      .returning({ id: rewardChoiceUpload.id });
    outcomes = await saveRewardChoices(
      db,
      items.map((i) => i.input),
      { source: "UPLOAD", defaultChosenBy: session.username, actor: session.username, uploadId },
    );
  } catch (err) {
    console.error("[admin] reward choice upload failed:", err instanceof Error ? err.message : err);
    // saveRewardChoices writes in one transaction and did not commit: remove the history entry too.
    if (uploadId !== null) await db.delete(rewardChoiceUpload).where(eq(rewardChoiceUpload.id, uploadId)).catch(() => undefined);
    return fail("The file could not be saved. Nothing was changed. Try again in a few minutes.");
  }

  // From here the choices are saved (committed). Never remove the history entry or report "Nothing was changed".
  let changed = 0;
  let unchanged = 0;
  const all = [...errors];
  outcomes.forEach((o, n) => {
    const { row, input } = items[n];
    if (o.ok) {
      if (o.changed) changed++;
      else unchanged++;
    } else {
      all.push({ row, dealerCode: input.dealerCode, schemeTag: input.schemeTag, message: o.message });
    }
  });
  all.sort((a, b) => a.row - b.row);
  try {
    await db.update(rewardChoiceUpload).set({ changed, unchanged, refused: all.length }).where(eq(rewardChoiceUpload.id, uploadId));
  } catch (err) {
    // The history row keeps 0 counts; its CSV (from the change log) still lists the changed rows.
    console.error("[admin] reward choice upload: saving the counts failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/admin/choices");
  console.log(
    JSON.stringify({
      evt: "reward_choice_upload",
      admin: session.username,
      rows: rowCount,
      changed,
      unchanged,
      refused: all.length,
    }),
  );
  return { status: "done", message: null, fileName, rows: rowCount, changed, unchanged, errors: all };
}
