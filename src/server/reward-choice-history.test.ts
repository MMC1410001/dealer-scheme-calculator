import { describe, expect, it } from "vitest";
import { csvCell, historyCsv, historyDownloadHref, historyFileName, parseHistorySelector, type HistoryEntry } from "./reward-choice-history";

const upload: HistoryEntry = { kind: "upload", id: 7, at: "2026-10-22T18:58:42+05:30", actor: "admin", fileName: "a.csv", rowCount: 5, changed: 4, unchanged: 1, refused: 0 };
const apiDay: HistoryEntry = { kind: "day", source: "API", day: "2026-10-22", at: "2026-10-22T19:00:00+05:30", actor: "sfa", changed: 3 };

describe("reward choice history", () => {
  it("builds a download link for each entry, and none when nothing changed", () => {
    expect(historyDownloadHref(upload)).toBe("/admin/choices/history?upload=7");
    expect(historyDownloadHref(apiDay)).toBe("/admin/choices/history?source=API&day=2026-10-22&actor=sfa");
    expect(historyDownloadHref({ ...apiDay, actor: null })).toBe("/admin/choices/history?source=API&day=2026-10-22");
    expect(historyDownloadHref({ ...upload, changed: 0 })).toBeNull();
  });

  it("reads a download link back, and refuses a bad one", () => {
    const back = (href: string) => parseHistorySelector(new URL(href, "http://x").searchParams);
    expect(back(historyDownloadHref(upload)!)).toEqual({ kind: "upload", id: 7 });
    expect(back(historyDownloadHref(apiDay)!)).toEqual({ kind: "day", source: "API", day: "2026-10-22", actor: "sfa" });
    expect(back("/x?source=API&day=2026-10-22")).toEqual({ kind: "day", source: "API", day: "2026-10-22", actor: null });
    for (const bad of ["/x", "/x?upload=0", "/x?upload=1e3", "/x?source=api&day=2026-10-22", "/x?source=API&day=22-10-2026", "/x?source=API&day=2026-10-22&actor=a%20b"]) {
      expect(back(bad)).toBeNull();
    }
  });

  it("writes safe CSV cells (quotes, no formulas)", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell("SO1")).toBe("SO1");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-x")).toBe("'-x");
  });

  it("writes the CSV with India time and the sender", () => {
    const csv = historyCsv([
      { changedAt: "2026-10-22T18:58:42+05:30", dealerCode: "D1", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: "SO1", source: "API", actor: "sfa" },
    ]);
    expect(csv).toBe("changed_at,dealer_code,scheme_tag,choice,destination,chosen_by,source,sent_by\r\n2026-10-22 18:58:42,D1,FB-PAN,GIFT,,SO1,API,sfa\r\n");
    expect(historyFileName({ kind: "upload", id: 7 })).toBe("reward-choices-upload-7.csv");
    expect(historyFileName({ kind: "day", source: "API", day: "2026-10-22", actor: null })).toBe("reward-choices-api-2026-10-22.csv");
  });
});
