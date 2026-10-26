/**
 * Bulk reward choice upload (admin): reads a .csv or .xlsx file and checks each row.
 * Columns (first row, any order, case ignored): dealer_code*, scheme_tag*, choice*, destination, chosen_by.
 * - choice: GIFT or CN. destination: CRUISE or OVERSEAS, or empty. chosen_by: empty = the admin user name.
 * - Empty rows are skipped. Row numbers in the errors are the line numbers of the file (header = row 1).
 * The checks against the stored results (dealer in a slab, destination allowed) run in saveRewardChoices.
 */
import ExcelJS from "exceljs";
import { DEALER_CODE_PATTERN } from "@/lib/auth/embed-token";
import { CHOSEN_BY_PATTERN, parseChoiceValue, parseDestination, type RewardChoiceInput, type UploadRowError } from "@/server/reward-choice";

export type { UploadRowError };

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MAX_ROWS = 20_000;
export const UPLOAD_COLUMNS = ["dealer_code", "scheme_tag", "choice", "destination", "chosen_by"] as const;
const REQUIRED_COLUMNS = ["dealer_code", "scheme_tag", "choice"] as const;

export interface ParsedUpload {
  /** Valid rows, with the file row number. */
  items: Array<{ row: number; input: RewardChoiceInput }>;
  errors: UploadRowError[];
  /** Data rows read (empty rows not counted). */
  rowCount: number;
}

export type ReadResult = { ok: true; table: string[][] } | { ok: false; message: string };

/** RFC 4180 CSV: quoted fields, "" inside quotes, CRLF or LF. A UTF-8 BOM is removed. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The first worksheet of an .xlsx file as text cells. */
async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (r, n) => {
    const cells: string[] = [];
    for (let c = 1; c <= r.cellCount; c++) cells.push(r.getCell(c).text ?? "");
    out[n - 1] = cells;
  });
  for (let i = 0; i < out.length; i++) out[i] ??= [];
  return out;
}

/** Reads the file by its extension (.csv or .xlsx). */
export async function readUploadTable(fileName: string, bytes: Uint8Array): Promise<ReadResult> {
  if (bytes.byteLength === 0) return { ok: false, message: "The file is empty." };
  if (bytes.byteLength > UPLOAD_MAX_BYTES) return { ok: false, message: `The file must be ${UPLOAD_MAX_BYTES / 1024 / 1024} MB or smaller.` };
  const ext = fileName.toLowerCase().split(".").pop();
  try {
    if (ext === "csv") return { ok: true, table: parseCsv(new TextDecoder("utf-8").decode(bytes)) };
    if (ext === "xlsx") return { ok: true, table: await readXlsx(bytes) };
  } catch {
    return { ok: false, message: "The file could not be read. Use the template (.csv or .xlsx)." };
  }
  return { ok: false, message: "Use a .csv or .xlsx file." };
}

const normalise = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** A row whose dealer_code starts with this is an example or a note (template): skipped, never saved. */
export const EXAMPLE_ROW_PREFIX = "#";

/** Checks the header and each row. Returns the valid rows and the errors. */
export function validateUploadTable(table: string[][]): { ok: true; parsed: ParsedUpload } | { ok: false; message: string } {
  const header = (table[0] ?? []).map(normalise);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) return { ok: false, message: `Missing column(s) in row 1: ${missing.join(", ")}.` };
  const col = (name: string) => header.indexOf(name);
  const idx = Object.fromEntries(UPLOAD_COLUMNS.map((c) => [c, col(c)])) as Record<(typeof UPLOAD_COLUMNS)[number], number>;

  const items: ParsedUpload["items"] = [];
  const errors: UploadRowError[] = [];
  let rowCount = 0;
  let exampleRows = 0;
  for (let i = 1; i < table.length; i++) {
    const cells = table[i] ?? [];
    if (cells.every((c) => (c ?? "").trim() === "")) continue;
    if (idx.dealer_code >= 0 && (cells[idx.dealer_code] ?? "").trim().startsWith(EXAMPLE_ROW_PREFIX)) {
      exampleRows++;
      continue;
    }
    rowCount++;
    if (rowCount > UPLOAD_MAX_ROWS) return { ok: false, message: `The file must have ${UPLOAD_MAX_ROWS} rows or fewer.` };
    const get = (k: keyof typeof idx) => (idx[k] >= 0 ? (cells[idx[k]] ?? "").trim() : "");
    const row = i + 1;
    const dealerCode = get("dealer_code");
    const schemeTag = get("scheme_tag");
    const fail = (message: string) => errors.push({ row, dealerCode: dealerCode.slice(0, 32), schemeTag: schemeTag.slice(0, 32), message });

    if (!DEALER_CODE_PATTERN.test(dealerCode)) {
      fail("dealer_code: use 1 to 32 letters, digits, '_' or '-'.");
      continue;
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(schemeTag)) {
      fail("scheme_tag: use 1 to 32 letters, digits, '_' or '-'.");
      continue;
    }
    const choice = parseChoiceValue(get("choice"));
    if (!choice) {
      fail("choice: use GIFT or CN.");
      continue;
    }
    const destination = parseDestination(get("destination"));
    if (destination === undefined) {
      fail("destination: use CRUISE or OVERSEAS, or leave it empty.");
      continue;
    }
    const chosenBy = get("chosen_by");
    if (chosenBy && !CHOSEN_BY_PATTERN.test(chosenBy)) {
      fail("chosen_by: use 1 to 64 letters, digits, '.', '_', '@' or '-', or leave it empty.");
      continue;
    }
    items.push({ row, input: { dealerCode, schemeTag, choice, destination, chosenBy: chosenBy || null } });
  }
  if (rowCount === 0) {
    return {
      ok: false,
      message:
        exampleRows > 0
          ? `The file has only example rows (dealer_code starts with "${EXAMPLE_ROW_PREFIX}"). Add one row for each dealer and scheme, then upload again.`
          : "The file has no data rows.",
    };
  }
  return { ok: true, parsed: { items, errors, rowCount } };
}
