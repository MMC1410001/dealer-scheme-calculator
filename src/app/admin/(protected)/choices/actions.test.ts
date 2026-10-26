import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake database: records the history-row writes; the counts update can be made to fail.
const db = vi.hoisted(() => ({
  updateFails: false,
  deleted: 0,
  updated: 0,
  insert: () => ({ values: () => ({ returning: async () => [{ id: 7 }] }) }),
  update() {
    return {
      set: () => ({
        where: async () => {
          if (db.updateFails) throw new Error("connection lost");
          db.updated++;
        },
      }),
    };
  },
  delete() {
    return { where: async () => void db.deleted++ };
  },
}));
const save = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ getDb: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/admin-server", () => ({ getAdminSession: async () => ({ username: "admin", role: "ADMIN" }) }));
vi.mock("@/server/reward-choice-store", () => ({ saveRewardChoices: save }));
vi.mock("@/server/reward-choice-upload", () => ({
  readUploadTable: async () => ({ ok: true, table: {} }),
  validateUploadTable: () => ({
    ok: true,
    parsed: {
      rowCount: 1,
      errors: [],
      items: [{ row: 2, input: { dealerCode: "D1", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: null } }],
    },
  }),
}));

const { uploadChoicesAction } = await import("./actions");
type UploadState = import("./actions").UploadState;

const EMPTY: UploadState = { status: "idle", message: null, fileName: null, rows: 0, changed: 0, unchanged: 0, errors: [] };
const form = () => {
  const f = new FormData();
  f.set("file", new File(["dealer_code,scheme_tag,choice\nD1,FB-PAN,GIFT\n"], "choices.csv", { type: "text/csv" }));
  return f;
};
const saved = { ok: true, dealerCode: "D1", schemeTag: "FB-PAN", changed: true, rewardChoice: { choice: "GIFT" } };

describe("uploadChoicesAction", () => {
  beforeEach(() => {
    db.updateFails = false;
    db.deleted = 0;
    db.updated = 0;
    save.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("saves the counts on the history entry after a successful save", async () => {
    save.mockResolvedValue([saved]);
    const r = await uploadChoicesAction(EMPTY, form());
    expect(r).toMatchObject({ status: "done", changed: 1, unchanged: 0, errors: [] });
    expect([db.updated, db.deleted]).toEqual([1, 0]);
  });

  it("keeps the history entry and reports the saved rows when only the counts update fails", async () => {
    save.mockResolvedValue([saved]);
    db.updateFails = true;
    const r = await uploadChoicesAction(EMPTY, form());
    expect(r).toMatchObject({ status: "done", changed: 1 });
    expect(r.message ?? "").not.toMatch(/Nothing was changed/);
    expect(db.deleted).toBe(0);
  });

  it("removes the history entry and says nothing was changed when the save itself fails", async () => {
    save.mockRejectedValue(new Error("deadlock"));
    const r = await uploadChoicesAction(EMPTY, form());
    expect(r).toMatchObject({ status: "error" });
    expect(r.message).toMatch(/Nothing was changed/);
    expect(db.deleted).toBe(1);
  });
});
