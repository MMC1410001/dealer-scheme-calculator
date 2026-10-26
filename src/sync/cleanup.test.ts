import { describe, expect, it } from "vitest";
import { SCHEMES } from "@/config/schemes";
import { formatCleanup, monthsBefore, neededTagMonths } from "./cleanup";

describe("neededTagMonths", () => {
  it("keeps base, period and return-window months of each active scheme", () => {
    const pairs = neededTagMonths(SCHEMES);
    const months = (tag: string) => pairs.filter((p) => p.tag === tag).map((p) => p.month).sort();
    expect(months("FB-PAN")).toEqual(["2026-04", "2026-05", "2026-06", "2026-10", "2026-11", "2026-12"]);
    expect(months("SP-Q3")).toEqual(["2026-04", "2026-05", "2026-06", "2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("returns nothing without schemes (the caller then skips the delete)", () => {
    expect(neededTagMonths([])).toEqual([]);
  });
});

describe("monthsBefore", () => {
  it("subtracts calendar months", () => {
    expect(monthsBefore("2026-10-19", 6)).toBe("2026-04-19");
    expect(monthsBefore("2027-02-10", 6)).toBe("2026-08-10");
  });
  it("goes to the month end when the day does not exist", () => {
    expect(monthsBefore("2026-08-31", 6)).toBe("2026-02-28");
  });
});

describe("formatCleanup", () => {
  it("names the reward choice log rows (3 months)", () => {
    const r = { metricRows: 1, syncRuns: 2, syncRunCutoff: "2026-04-22", choiceLogRows: 3, choiceLogCutoff: "2026-07-22", choiceUploads: 4 };
    expect(formatCleanup(r, true)).toBe(
      "cleanup: would delete 1 dealer_metric rows, would delete 2 sync_run rows (started before 2026-04-22, not referenced), " +
        "would delete 3 dealer_reward_choice_log rows (changed before 2026-07-22), would delete 4 reward_choice_upload rows",
    );
  });
});
