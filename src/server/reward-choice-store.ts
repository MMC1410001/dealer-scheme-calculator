/**
 * Dealer reward choice: database side. One function saves choices for the admin area (one choice or a file upload)
 * and the API.
 *
 * - A child dealer's choice is stored under the parent code, the same code that the results use.
 * - Each item is checked against the stored result (src/server/reward-choice.ts): the dealer must be in a slab.
 * - One current row per dealer and scheme. An unchanged re-send writes nothing (no update, no log row).
 *   A change updates the row and adds one row to dealer_reward_choice_log, in one transaction.
 * - After a change, the response cache data version goes up (bumpDataVersion), because the dealer status API
 *   returns the choice.
 *
 * Do not import "server-only" here: tests import this module.
 */
import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { dealer, dealerRewardChoice, dealerRewardChoiceLog, dealerSchemeResult } from "@/db/schema";
import type { RewardChoice, RewardChoiceSource, SchemeStatus } from "@/engine/types";
import { bumpDataVersion } from "@/server/cache";
import { toIstIso } from "@/server/repo";
import { loadSchemes } from "@/server/scheme-loader";
import { checkChoiceAllowed, sameChoice, toRewardChoice, type ChoiceErrorCode, type RewardChoiceInput } from "@/server/reward-choice";

/** Rows for each IN (...) query and each insert. */
const CHUNK = 1000;

export type SaveOutcome =
  | { ok: true; dealerCode: string; schemeTag: string; changed: boolean; rewardChoice: RewardChoice }
  | { ok: false; code: ChoiceErrorCode; message: string };

export interface SaveOptions {
  source: Exclude<RewardChoiceSource, "DEMO">;
  /** Used when an item has no chosenBy (the admin user name for an upload). */
  defaultChosenBy?: string | null;
  /** Who sent the change, for the history: the admin user, or the API client_id. */
  actor?: string | null;
  /** The file upload (reward_choice_upload.id) that made the change. */
  uploadId?: number | null;
  /** For tests: skip the cache version bump. */
  bumpCache?: () => Promise<unknown>;
}

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const key = (dealerCode: string, schemeTag: string) => `${dealerCode}\u0001${schemeTag}`;

/** Saves the choices. Returns one outcome for each item, in input order. Never partly writes a valid item. */
export async function saveRewardChoices(db: Db, items: RewardChoiceInput[], opts: SaveOptions): Promise<SaveOutcome[]> {
  if (items.length === 0) return [];
  const schemes = new Map((await loadSchemes(db)).map((s) => [s.tag, s]));

  // Parent codes (a child sees and chooses on the parent's result).
  const codes = [...new Set(items.map((i) => i.dealerCode))];
  const parentOf = new Map<string, string | null>();
  for (const part of chunks(codes)) {
    const rows = await db.select({ code: dealer.code, parentCode: dealer.parentCode }).from(dealer).where(inArray(dealer.code, part));
    for (const r of rows) parentOf.set(r.code, r.parentCode && r.parentCode !== r.code ? r.parentCode : null);
  }
  const resolve = (code: string) => parentOf.get(code) ?? code;
  const resolvedCodes = [...new Set(items.map((i) => resolve(i.dealerCode)))];

  // Stored results (participation and current slab only) and the dealers that have any result.
  const results = new Map<string, Pick<SchemeStatus, "participation" | "current_slab_no" | "current_slab" | "scheme_tag">>();
  const withResults = new Set<string>();
  for (const part of chunks(resolvedCodes)) {
    const rows = await db
      .select({
        dealerCode: dealerSchemeResult.dealerCode,
        schemeTag: dealerSchemeResult.schemeTag,
        participation: dealerSchemeResult.participation,
        currentSlabNo: dealerSchemeResult.currentSlabNo,
      })
      .from(dealerSchemeResult)
      .where(inArray(dealerSchemeResult.dealerCode, part));
    for (const r of rows) {
      withResults.add(r.dealerCode);
      results.set(key(r.dealerCode, r.schemeTag), {
        scheme_tag: r.schemeTag,
        participation: r.participation as SchemeStatus["participation"],
        current_slab_no: r.currentSlabNo,
        current_slab: r.currentSlabNo == null ? null : `Slab ${r.currentSlabNo}`,
      });
    }
  }

  // Current choices.
  const stored = new Map<string, typeof dealerRewardChoice.$inferSelect>();
  for (const part of chunks(resolvedCodes)) {
    const rows = await db.select().from(dealerRewardChoice).where(inArray(dealerRewardChoice.dealerCode, part));
    for (const r of rows) stored.set(key(r.dealerCode, r.schemeTag), r);
  }

  // Same dealer and scheme more than once in one batch: all those items are refused (which one is right is not known).
  const seen = new Map<string, number>();
  for (const i of items) {
    const k = key(resolve(i.dealerCode), i.schemeTag);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }

  const outcomes: Array<SaveOutcome | null> = [];
  const writes: Array<{ index: number; dealerCode: string; schemeTag: string; input: RewardChoiceInput; chosenBy: string | null }> = [];
  items.forEach((input, index) => {
    const code = resolve(input.dealerCode);
    const k = key(code, input.schemeTag);
    const fail = (c: ChoiceErrorCode, message: string) => outcomes.push({ ok: false, code: c, message });
    if (!schemes.has(input.schemeTag)) return fail("UNKNOWN_SCHEME_TAG", `Scheme tag ${input.schemeTag} does not exist.`);
    if (!parentOf.has(input.dealerCode) && !withResults.has(code)) return fail("DEALER_NOT_FOUND", `Dealer ${input.dealerCode} does not exist.`);
    if ((seen.get(k) ?? 0) > 1) return fail("DUPLICATE", "The same dealer and scheme are in more than one row.");
    const check = checkChoiceAllowed(results.get(k) as SchemeStatus | undefined, schemes.get(input.schemeTag), input);
    if (!check.ok) return fail(check.code, check.message);
    const prev = stored.get(k);
    if (sameChoice(prev, input)) {
      outcomes.push({
        ok: true,
        dealerCode: code,
        schemeTag: input.schemeTag,
        changed: false,
        rewardChoice: toRewardChoice({ ...prev!, updatedAt: toIstIso(prev!.updatedAt) ?? "" }),
      });
      return;
    }
    outcomes.push(null); // set after the write
    writes.push({ index, dealerCode: code, schemeTag: input.schemeTag, input, chosenBy: input.chosenBy ?? opts.defaultChosenBy ?? null });
  });

  if (writes.length > 0) {
    // The "same as stored" check above runs before the transaction. A concurrent request can store the same choice
    // in between: the upsert guard then skips the row. Only the rows that the upsert really wrote get a log row and
    // changed: true; a skipped row returns the row as stored now.
    const { now, written, current } = await db.transaction(async (tx) => {
      const [{ ts }] = (await tx.execute<{ ts: Date }>(sql`SELECT now() AS ts`)).rows;
      const written = new Set<string>();
      const current = new Map<string, typeof dealerRewardChoice.$inferSelect>();
      for (const part of chunks(writes)) {
        const rows = part.map((w) => ({
          dealerCode: w.dealerCode,
          schemeTag: w.schemeTag,
          choice: w.input.choice,
          destination: w.input.destination,
          source: opts.source,
          chosenBy: w.chosenBy,
          updatedAt: new Date(ts),
        }));
        const done = await tx
          .insert(dealerRewardChoice)
          .values(rows)
          .onConflictDoUpdate({
            target: [dealerRewardChoice.dealerCode, dealerRewardChoice.schemeTag],
            set: {
              choice: sql`excluded.choice`,
              destination: sql`excluded.destination`,
              source: sql`excluded.source`,
              chosenBy: sql`excluded.chosen_by`,
              updatedAt: sql`excluded.updated_at`,
            },
            setWhere: sql`(${dealerRewardChoice.choice}, ${dealerRewardChoice.destination}) IS DISTINCT FROM (excluded.choice, excluded.destination)`,
          })
          .returning({ dealerCode: dealerRewardChoice.dealerCode, schemeTag: dealerRewardChoice.schemeTag });
        for (const d of done) written.add(key(d.dealerCode, d.schemeTag));

        const logRows = rows.filter((r) => written.has(key(r.dealerCode, r.schemeTag)));
        if (logRows.length > 0) {
          await tx.insert(dealerRewardChoiceLog).values(
            logRows.map((r) => ({
              dealerCode: r.dealerCode,
              schemeTag: r.schemeTag,
              choice: r.choice,
              destination: r.destination,
              source: r.source,
              chosenBy: r.chosenBy,
              changedAt: r.updatedAt,
              actor: opts.actor ?? null,
              uploadId: opts.uploadId ?? null,
            })),
          );
        }

        const skipped = rows.filter((r) => !written.has(key(r.dealerCode, r.schemeTag)));
        if (skipped.length > 0) {
          const stored = await tx
            .select()
            .from(dealerRewardChoice)
            .where(sql`(${dealerRewardChoice.dealerCode}, ${dealerRewardChoice.schemeTag}) IN (${sql.join(
              skipped.map((r) => sql`(${r.dealerCode}, ${r.schemeTag})`),
              sql`, `,
            )})`);
          for (const s of stored) current.set(key(s.dealerCode, s.schemeTag), s);
        }
      }
      return { now: new Date(ts), written, current };
    });
    const updatedAt = toIstIso(now) ?? "";
    for (const w of writes) {
      const k = key(w.dealerCode, w.schemeTag);
      const mine = { choice: w.input.choice, destination: w.input.destination, source: opts.source, chosenBy: w.chosenBy, updatedAt };
      const prev = current.get(k);
      outcomes[w.index] = {
        ok: true,
        dealerCode: w.dealerCode,
        schemeTag: w.schemeTag,
        changed: written.has(k),
        // A skipped row always has a stored row (the conflict); "mine" is only a fallback.
        rewardChoice: toRewardChoice(written.has(k) || !prev ? mine : { ...prev, updatedAt: toIstIso(prev.updatedAt) ?? "" }),
      };
    }
    if (written.size > 0) await (opts.bumpCache ?? bumpDataVersion)();
  }
  return outcomes as SaveOutcome[];
}
