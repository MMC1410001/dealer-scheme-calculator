import { describe, expect, it } from "vitest";
import { listQuery, parseListFilters, parseListState, setListFilters } from "./list-filters";

const TAGS = ["FB-PAN", "FB-TNHPJK", "SP-Q3"];

describe("parseListFilters", () => {
  it("reads slab=N and scope=in", () => {
    expect(parseListFilters({ slab: "3", scope: "in" })).toEqual({ slabNo: 3, inScopeOnly: true });
  });

  it("ignores a missing, zero, negative, decimal or non-numeric slab and any other scope", () => {
    for (const slab of [undefined, "", "0", "-1", "2.5", "x", "100", "1e1", " 3"]) {
      expect(parseListFilters({ slab, scope: "all" })).toEqual({ slabNo: null, inScopeOnly: false });
    }
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseListFilters({ slab: ["7", "1"], scope: ["in", "x"] })).toEqual({ slabNo: 7, inScopeOnly: true });
  });
});

describe("setListFilters", () => {
  it("writes only the filters that are on", () => {
    expect(setListFilters(new URLSearchParams({ scheme: "FB-PAN" }), { slabNo: null, inScopeOnly: false }).toString()).toBe("scheme=FB-PAN");
    expect(setListFilters(new URLSearchParams(), { slabNo: 2, inScopeOnly: true }).toString()).toBe("slab=2&scope=in");
  });
});

describe("parseListState", () => {
  it("gives the defaults for an empty query: first active tag, Unlocked, no search, page 1, no filter", () => {
    expect(parseListState({}, TAGS)).toEqual({ schemeTag: "FB-PAN", status: "UNLOCKED", q: "", page: 1, slabNo: null, inScopeOnly: false });
  });

  it("reads every value", () => {
    expect(parseListState({ scheme: "SP-Q3", status: "LOCKED", q: "  Demo  ", page: "4", slab: "2", scope: "in" }, TAGS)).toEqual({
      schemeTag: "SP-Q3",
      status: "LOCKED",
      q: "Demo",
      page: 4,
      slabNo: 2,
      inScopeOnly: true,
    });
  });

  it("falls back for an unknown scheme or status and a bad page; cuts the search to 64 characters", () => {
    const s = parseListState({ scheme: "ABC1", status: "unlocked", page: "0", q: "x".repeat(80) }, TAGS);
    expect(s).toMatchObject({ schemeTag: "FB-PAN", status: "UNLOCKED", page: 1 });
    expect(s.q).toHaveLength(64);
    expect(parseListState({ page: "-2" }, TAGS).page).toBe(1);
    expect(parseListState({ page: "abc" }, TAGS).page).toBe(1);
  });
});

describe("listQuery", () => {
  it("leaves the defaults out and keeps a fixed order", () => {
    expect(listQuery(parseListState({}, TAGS))).toBe("scheme=FB-PAN");
    expect(listQuery({ schemeTag: "SP-Q3", status: "ALL", q: "a b", page: 3, slabNo: 7, inScopeOnly: true })).toBe(
      "scheme=SP-Q3&status=ALL&q=a+b&slab=7&scope=in&page=3",
    );
  });

  it("round-trips: parse(write(state)) == state", () => {
    const states = [
      parseListState({}, TAGS),
      { schemeTag: "FB-TNHPJK", status: "LOCKED" as const, q: "Demo Dealer", page: 2, slabNo: null, inScopeOnly: true },
      { schemeTag: "SP-Q3", status: "UNLOCKED" as const, q: "", page: 1, slabNo: 5, inScopeOnly: false },
    ];
    for (const s of states) expect(parseListState(Object.fromEntries(new URLSearchParams(listQuery(s))), TAGS)).toEqual(s);
  });
});
