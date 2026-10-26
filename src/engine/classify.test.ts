import { describe, expect, it } from "vitest";
import { classifySlabs } from "./classify";

// CLAUDE.md section 6 example: Slab 1 needs A>=10, B>=5; Slab 2 needs A>=15, B>=10.
const slabs = [
  { a: 10, b: 5 },
  { a: 15, b: 10 },
];
const results = (a: number, b: number) => slabs.map((s) => [a >= s.a, b >= s.b]);

describe("classifySlabs – CLAUDE.md section 6", () => {
  it("A = 16, B = 3 → no slab (B fails in Slab 1)", () => {
    expect(classifySlabs(results(16, 3), "STOP_AT_FIRST_FAIL")).toBeNull();
  });

  it("A = 17, B = 9 → Slab 1 (B fails in Slab 2)", () => {
    expect(classifySlabs(results(17, 9), "STOP_AT_FIRST_FAIL")).toBe(0);
  });

  it("all slabs met → top slab", () => {
    expect(classifySlabs(results(20, 20), "STOP_AT_FIRST_FAIL")).toBe(1);
  });

  it("STOP_AT_FIRST_FAIL stops at a failed slab; HIGHEST_ALL_MET does not", () => {
    const r = [[false], [false], [true], [false]];
    expect(classifySlabs(r, "STOP_AT_FIRST_FAIL")).toBeNull();
    expect(classifySlabs(r, "HIGHEST_ALL_MET")).toBe(2);
  });

  it("no slabs → null", () => {
    expect(classifySlabs([], "STOP_AT_FIRST_FAIL")).toBeNull();
  });
});
