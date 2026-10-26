import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { UPLOAD_MAX_ROWS, parseCsv, readUploadTable, validateUploadTable } from "./reward-choice-upload";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n3,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["3", ""],
    ]);
  });
});

describe("validateUploadTable", () => {
  it("needs the required columns in row 1 (any order, case ignored)", () => {
    expect(validateUploadTable([["dealer_code", "choice"]])).toEqual({ ok: false, message: "Missing column(s) in row 1: scheme_tag." });
    const r = validateUploadTable([["Choice", "Scheme Tag", "DEALER_CODE"], ["gift", "FB-PAN", "D1"]]);
    expect(r.ok && r.parsed.items).toEqual([{ row: 2, input: { dealerCode: "D1", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: null } }]);
  });

  it("reports each bad row with its file row number and skips empty rows", () => {
    const r = validateUploadTable([
      ["dealer_code", "scheme_tag", "choice", "destination", "chosen_by"],
      ["D1", "SP-Q3", "CN", "OVERSEAS", "SO1"],
      ["", "", "", "", ""],
      ["D 2", "FB-PAN", "GIFT", "", ""],
      ["D3", "FB-PAN", "VOUCHER", "", ""],
      ["D4", "SP-Q3", "GIFT", "GOA", ""],
      ["D5", "FB-PAN", "GIFT", "", "bad user"],
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.rowCount).toBe(5);
    expect(r.parsed.items.map((i) => i.input)).toEqual([
      { dealerCode: "D1", schemeTag: "SP-Q3", choice: "CN", destination: "OVERSEAS", chosenBy: "SO1" },
    ]);
    expect(r.parsed.errors.map((e) => [e.row, e.message.split(":")[0]])).toEqual([
      [4, "dealer_code"],
      [5, "choice"],
      [6, "destination"],
      [7, "chosen_by"],
    ]);
  });

  it("skips example rows (dealer_code starts with #) and refuses a file with only example rows", () => {
    const header = ["dealer_code", "scheme_tag", "choice", "destination", "chosen_by"];
    const r = validateUploadTable([header, ["# Example rows", "", "", "", ""], ["#1234567890", "FB-PAN", "GIFT", "", "SO1234"], ["D1", "FB-PAN", "CN", "", ""]]);
    expect(r.ok && r.parsed.rowCount).toBe(1);
    expect(r.ok && r.parsed.items.map((i) => i.row)).toEqual([4]);
    expect(r.ok && r.parsed.errors).toEqual([]);
    const only = validateUploadTable([header, ["#1234567890", "FB-PAN", "GIFT", "", ""]]);
    expect(only.ok).toBe(false);
    expect(!only.ok && only.message).toMatch(/only example rows/);
  });

  it("refuses a file with no data rows or too many rows", () => {
    expect(validateUploadTable([["dealer_code", "scheme_tag", "choice"]])).toEqual({ ok: false, message: "The file has no data rows." });
    const big = [["dealer_code", "scheme_tag", "choice"], ...Array.from({ length: UPLOAD_MAX_ROWS + 1 }, (_, i) => [`D${i}`, "FB-PAN", "GIFT"])];
    expect(validateUploadTable(big).ok).toBe(false);
  });
});

describe("readUploadTable", () => {
  it("reads .csv and .xlsx, and refuses other files", async () => {
    expect(await readUploadTable("a.csv", enc("dealer_code,scheme_tag,choice\nD1,FB-PAN,CN\n"))).toEqual({
      ok: true,
      table: [["dealer_code", "scheme_tag", "choice"], ["D1", "FB-PAN", "CN"]],
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Choices");
    ws.addRow(["dealer_code", "scheme_tag", "choice", "destination"]);
    ws.addRow(["D1", "SP-Q3", "GIFT", "CRUISE"]);
    ws.addRow([12345, "FB-PAN", "CN"]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const x = await readUploadTable("Choices.XLSX", bytes);
    expect(x.ok).toBe(true);
    if (x.ok) {
      const v = validateUploadTable(x.table);
      expect(v.ok && v.parsed.items.map((i) => i.input.dealerCode)).toEqual(["D1", "12345"]);
    }
    expect(await readUploadTable("a.txt", enc("x"))).toEqual({ ok: false, message: "Use a .csv or .xlsx file." });
    expect(await readUploadTable("a.xlsx", enc("not a zip"))).toMatchObject({ ok: false });
    expect(await readUploadTable("a.csv", new Uint8Array(0))).toEqual({ ok: false, message: "The file is empty." });
  });
});
