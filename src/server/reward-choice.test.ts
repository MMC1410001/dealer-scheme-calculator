import { describe, expect, it } from "vitest";
import { SCHEMES } from "@/config/schemes";
import type { SchemeStatus } from "@/engine/types";
import {
  canChooseDestination,
  checkChoiceAllowed,
  choiceText,
  destinationOptions,
  errorsToCsv,
  parseChoiceValue,
  parseDestination,
  sameChoice,
} from "./reward-choice";

const FB_PAN = SCHEMES.find((s) => s.tag === "FB-PAN")!;
const SP_Q3 = SCHEMES.find((s) => s.tag === "SP-Q3")!;
const inSlab = (n: number | null): SchemeStatus => ({
  scheme_tag: "SP-Q3",
  participation: "IN_SCHEME",
  current_slab_no: n,
  current_slab: n == null ? null : `Slab ${n}`,
});

describe("reward choice values", () => {
  it("parses GIFT and CN, case and spaces ignored", () => {
    expect(parseChoiceValue(" gift ")).toBe("GIFT");
    expect(parseChoiceValue("CN")).toBe("CN");
    for (const v of ["", "VOUCHER", null, 1, undefined]) expect(parseChoiceValue(v)).toBeNull();
  });

  it("parses the destination: empty = null, unknown = undefined", () => {
    expect(parseDestination(undefined)).toBeNull();
    expect(parseDestination(" ")).toBeNull();
    expect(parseDestination("overseas")).toBe("OVERSEAS");
    expect(parseDestination("CRUISE")).toBe("CRUISE");
    expect(parseDestination("GOA")).toBeUndefined();
    expect(parseDestination(5)).toBeUndefined();
  });
});

describe("destination choice (decision 1a: extra tickets only)", () => {
  it("is open only when more than one destination applies (Star Points Slab 7)", () => {
    expect(destinationOptions(SP_Q3, 5)).toEqual([]);
    expect(destinationOptions(SP_Q3, 6)).toEqual(["CRUISE"]);
    expect(destinationOptions(SP_Q3, 7)).toEqual(["CRUISE", "OVERSEAS"]);
    expect(canChooseDestination(SP_Q3, 6)).toBe(false);
    expect(canChooseDestination(SP_Q3, 7)).toBe(true);
    expect(canChooseDestination(FB_PAN, 7)).toBe(false);
    expect(canChooseDestination(SP_Q3, null)).toBe(false);
  });
});

describe("checkChoiceAllowed", () => {
  it("needs the dealer in the scheme and in a slab", () => {
    expect(checkChoiceAllowed(undefined, SP_Q3, { destination: null })).toMatchObject({ ok: false, code: "NOT_IN_SLAB" });
    expect(checkChoiceAllowed({ scheme_tag: "SP-Q3", participation: "NOT_IN_SCOPE" }, SP_Q3, { destination: null })).toMatchObject({
      ok: false,
      code: "NOT_IN_SLAB",
      message: "The dealer is not in this scheme.",
    });
    expect(checkChoiceAllowed(inSlab(null), SP_Q3, { destination: null })).toMatchObject({ ok: false, code: "NOT_IN_SLAB" });
    expect(checkChoiceAllowed(inSlab(1), SP_Q3, { destination: null })).toEqual({ ok: true });
  });

  it("allows a destination only at Slab 7", () => {
    expect(checkChoiceAllowed(inSlab(7), SP_Q3, { destination: "OVERSEAS" })).toEqual({ ok: true });
    expect(checkChoiceAllowed(inSlab(7), SP_Q3, { destination: "CRUISE" })).toEqual({ ok: true });
    expect(checkChoiceAllowed(inSlab(6), SP_Q3, { destination: "CRUISE" })).toMatchObject({
      ok: false,
      code: "DESTINATION_NOT_ALLOWED",
      message: "No destination choice at Slab 6. Leave the destination empty.",
    });
    expect(checkChoiceAllowed({ ...inSlab(4), scheme_tag: "FB-PAN" }, FB_PAN, { destination: "CRUISE" })).toMatchObject({ ok: false });
  });
});

describe("helpers", () => {
  it("sameChoice compares choice and destination", () => {
    expect(sameChoice(undefined, { choice: "GIFT", destination: null })).toBe(false);
    expect(sameChoice({ choice: "GIFT", destination: null }, { choice: "GIFT", destination: null })).toBe(true);
    expect(sameChoice({ choice: "GIFT", destination: "CRUISE" }, { choice: "GIFT", destination: "OVERSEAS" })).toBe(false);
    expect(sameChoice({ choice: "GIFT", destination: null }, { choice: "CN", destination: null })).toBe(false);
  });

  it("choiceText names the destination", () => {
    expect(choiceText({ choice: "CN", destination: null })).toBe("CN");
    expect(choiceText({ choice: "GIFT", destination: "OVERSEAS" })).toBe("Gift · destination: Overseas Tour");
  });

  it("errorsToCsv quotes values and blocks Excel formulas", () => {
    const csv = errorsToCsv([{ row: 3, dealerCode: "=HYPERLINK(1)", schemeTag: "FB-PAN", message: 'say "no", now' }]);
    expect(csv).toBe('row,dealer_code,scheme_tag,error\r\n3,\'=HYPERLINK(1),FB-PAN,"say ""no"", now"');
  });
});
