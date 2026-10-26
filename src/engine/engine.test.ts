import { describe, expect, it } from "vitest";
import { buildDealerStatus, evaluateDealerScheme } from "./index";
import { SCHEMES } from "@/config/schemes";
import { FB_PAN, FB_TNHPJK, SP_Q3, OPTS, dealer, fbMetrics } from "./test-helpers";

const m = fbMetrics(450000, 160000, 200000);

describe("participation", () => {
  it("enrolled in Star Points → Festive Bonanza is NOT_IN_SCOPE", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer({ enrolledSchemeTag: SP_Q3.tag }), m, OPTS);
    expect(s).toEqual({
      scheme_tag: FB_PAN.tag,
      participation: "NOT_IN_SCOPE",
      reason_code: "ENROLLED_IN_OTHER_SCHEME",
      reason: `Dealer is in scheme ${SP_Q3.tag}. A dealer can join only one of these schemes.`,
    });
  });

  it("enrolled in FB-PAN with region TN North → FB-TNHPJK decided by region (IN_SCHEME), FB-PAN out by region", () => {
    const d = dealer({ enrolledSchemeTag: FB_PAN.tag, regionName: "TN North" });
    expect(evaluateDealerScheme(FB_TNHPJK, d, m, OPTS).participation).toBe("IN_SCHEME");
    expect(evaluateDealerScheme(FB_PAN, d, m, OPTS).reason_code).toBe("REGION_NOT_IN_SCOPE");
    expect(evaluateDealerScheme(SP_Q3, d, m, OPTS).reason_code).toBe("ENROLLED_IN_OTHER_SCHEME");
  });

  it("HP & JK region → FB-TNHPJK only; region match ignores case and spaces", () => {
    const d = dealer({ regionName: " hp & jk " });
    expect(evaluateDealerScheme(FB_PAN, d, m, OPTS).reason).toBe("Dealer region is not in the scope of this scheme.");
    expect(evaluateDealerScheme(FB_TNHPJK, d, m, OPTS).participation).toBe("IN_SCHEME");
  });

  it("unknown region → REGION_UNKNOWN for regional schemes, Pan India still IN_SCHEME", () => {
    const d = dealer({ regionName: null });
    expect(evaluateDealerScheme(FB_PAN, d, m, OPTS).reason_code).toBe("REGION_UNKNOWN");
    expect(evaluateDealerScheme(FB_TNHPJK, dealer({ regionName: "" }), m, OPTS).reason_code).toBe("REGION_UNKNOWN");
    expect(evaluateDealerScheme(SP_Q3, d, { gsrByMonth: {}, mrvByMonth: {} }, OPTS).participation).toBe("IN_SCHEME");
  });

  it("no metrics → NO_DATA", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer(), null, OPTS);
    expect(s.participation).toBe("NOT_IN_SCOPE");
    expect(s.reason_code).toBe("NO_DATA");
    expect(s.header).toBeUndefined();
  });

  it("no enrolment → all schemes in scope are calculated", () => {
    const statuses = SCHEMES.map((sc) => evaluateDealerScheme(sc, dealer(), m, OPTS));
    expect(statuses.map((s) => s.participation)).toEqual(["IN_SCHEME", "NOT_IN_SCOPE", "IN_SCHEME"]);
  });
});

describe("LOCKED / UNLOCKED", () => {
  it("dealer in Slab 2 → only Slab 2 UNLOCKED, all other slabs LOCKED, conditions kept for all slabs", () => {
    // FB-TNHPJK: Oct 1.5L + Nov 2.5L = 4.0L
    const s = evaluateDealerScheme(FB_TNHPJK, dealer({ regionName: "TN South" }), fbMetrics(0, 150000, 250000), OPTS);
    expect(s.current_slab).toBe("Slab 2");
    expect(s.details!.map((d) => [d.slab_no, d.lock_status])).toEqual([
      [1, "LOCKED"], [2, "UNLOCKED"], [3, "LOCKED"], [4, "LOCKED"], [5, "LOCKED"], [6, "LOCKED"], [7, "LOCKED"],
    ]);
    expect(s.details![2].conditions.map((c) => c.met)).toEqual([false, false]);
    expect(s.reason_code).toBeUndefined();
  });
});

describe("OD and provisional", () => {
  it("OD on check date blocks the benefit but keeps the slab", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer({ hasOdOnCheckDate: true }), m, OPTS);
    expect(s.current_slab).toBe("Slab 1");
    expect(s.od_status).toBe("OD");
    expect(s.benefit_blocked).toBe(true);
    expect(s.reason_code).toBe("OD_ON_CHECK_DATE");
    expect(s.reason).toContain("30-11-2026");
  });

  it("OD unknown → PENDING, not blocked; no OD → NO_OD", () => {
    const p = evaluateDealerScheme(FB_PAN, dealer(), m, OPTS);
    expect(p.od_status).toBe("PENDING");
    expect(p.benefit_blocked).toBe(false);
    expect(evaluateDealerScheme(FB_PAN, dealer({ hasOdOnCheckDate: false }), m, OPTS).od_status).toBe("NO_OD");
  });

  it("OD with no slab keeps the Slab 1 reason", () => {
    const s = evaluateDealerScheme(FB_PAN, dealer({ hasOdOnCheckDate: true }), fbMetrics(450000, 160000, 50000), OPTS);
    expect(s.benefit_blocked).toBe(true);
    expect(s.reason_code).toBe("SLAB1_PERIOD_GSR_NOT_MET");
  });

  it("provisional until final_on", () => {
    expect(evaluateDealerScheme(FB_PAN, dealer(), m, OPTS).provisional).toBe(true);
    const after = evaluateDealerScheme(FB_PAN, dealer(), m, { ...OPTS, today: "2026-12-31" });
    expect(after.provisional).toBe(false);
    expect(after.final_on).toBe("2026-12-31");
  });
});

describe("buildDealerStatus", () => {
  it("wraps the scheme statuses without a message wrapper", () => {
    const statuses = SCHEMES.map((sc) => evaluateDealerScheme(sc, dealer(), m, OPTS));
    const ds = buildDealerStatus("D10001", "Test Dealer", "2026-10-16T05:30:00+05:30", statuses);
    expect(ds).toEqual({
      dealer_code: "D10001",
      dealer_name: "Test Dealer",
      data_as_of: "2026-10-16T05:30:00+05:30",
      schemes: statuses,
    });
    expect(buildDealerStatus("D1", undefined, null, []).dealer_name).toBeNull();
  });
});
