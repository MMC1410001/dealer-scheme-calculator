import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { issueToken, verifyBearer, type JwtSettings } from "@/lib/auth/jwt";
import { FixedWindowLimiter } from "@/server/ratelimit";
import type { DealerStatus, SchemeStatus } from "@/engine/types";
import {
  handleStatusRequest,
  validateStatusRequest,
  type ApiErrorBody,
  type StatusRequestDeps,
  type StatusRequestInput,
} from "./dealer-status";

const JWT: JwtSettings = {
  secret: "s".repeat(40),
  previousSecret: null,
  ttlSeconds: 3600,
  clients: new Map([
    ["sfa", "a".repeat(64)],
    ["dms", "b".repeat(64)],
  ]),
};
let KEY = "";
let OTHER = "";
beforeAll(async () => {
  KEY = await issueToken("sfa", JWT);
  OTHER = await issueToken("dms", JWT);
});
const ACTIVE = ["FB-PAN", "FB-TNHPJK", "SP-Q3"];

function scheme(tag: string): SchemeStatus {
  return { scheme_tag: tag, participation: "NOT_IN_SCOPE", reason_code: "NO_DATA", reason: "x" };
}

/** Fake data layer: D10001 is a dealer, C1 is its child. Returns the schemes in request order, like getDealerStatus. */
function fakeGetDealerStatus(code: string, tags: string[]): Promise<DealerStatus | null> {
  if (code !== "D10001" && code !== "C1") return Promise.resolve(null);
  return Promise.resolve({ dealer_code: "D10001", dealer_name: "Dealer", data_as_of: null, schemes: tags.map(scheme) });
}

function deps(over: Partial<StatusRequestDeps> = {}): StatusRequestDeps {
  return {
    authenticate: (a) => verifyBearer(a, JWT),
    limiter: new FixedWindowLimiter({ name: "client", limit: 100, windowSec: 60, now: () => 0 }),
    listActiveTags: () => Promise.resolve(ACTIVE),
    getDealerStatus: vi.fn(fakeGetDealerStatus),
    ...over,
  };
}

function input(body: unknown, over: Partial<StatusRequestInput> = {}): StatusRequestInput {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    authorization: `Bearer ${KEY}`,
    contentType: "application/json",
    readBody: () => Promise.resolve({ ok: true, text }),
    ...over,
  };
}

const valid = { dealer_code: "D10001", scheme_tags: ["FB-PAN", "FB-TNHPJK", "SP-Q3"] };

function err(r: { body: unknown }): ApiErrorBody["error"] {
  return (r.body as ApiErrorBody).error;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());

describe("validateStatusRequest", () => {
  const bad: Array<[string, unknown]> = [
    ["array body", [valid]],
    ["null body", null],
    ["string body", "x"],
    ["no dealer_code", { scheme_tags: ["FB-PAN"] }],
    ["dealer_code not a string", { dealer_code: 10001, scheme_tags: ["FB-PAN"] }],
    ["empty dealer_code", { dealer_code: "   ", scheme_tags: ["FB-PAN"] }],
    ["dealer_code too long", { dealer_code: "D".repeat(33), scheme_tags: ["FB-PAN"] }],
    ["dealer_code bad chars", { dealer_code: "D1'; DROP", scheme_tags: ["FB-PAN"] }],
    ["no scheme_tags", { dealer_code: "D10001" }],
    ["scheme_tags not an array", { dealer_code: "D10001", scheme_tags: "FB-PAN" }],
    ["empty scheme_tags", { dealer_code: "D10001", scheme_tags: [] }],
    ["11 tags", { dealer_code: "D10001", scheme_tags: Array.from({ length: 11 }, (_, i) => `T${i}`) }],
    ["tag not a string", { dealer_code: "D10001", scheme_tags: ["FB-PAN", 2] }],
    ["empty tag", { dealer_code: "D10001", scheme_tags: ["FB-PAN", " "] }],
    ["tag too long", { dealer_code: "D10001", scheme_tags: ["A".repeat(33)] }],
    ["tag with control char", { dealer_code: "D10001", scheme_tags: ["AB\nC1"] }],
    ["duplicate tags", { dealer_code: "D10001", scheme_tags: ["FB-PAN", "FB-PAN"] }],
    ["duplicate tags after trim", { dealer_code: "D10001", scheme_tags: ["FB-PAN", " FB-PAN "] }],
  ];
  it.each(bad)("rejects %s", (_name, body) => {
    expect(validateStatusRequest(body).ok).toBe(false);
  });

  it("trims the dealer code and the tags, and keeps the tag order", () => {
    expect(validateStatusRequest({ dealer_code: " D10001 ", scheme_tags: [" SP-Q3", "FB-PAN "], extra: 1 })).toEqual({
      ok: true,
      value: { dealer_code: "D10001", scheme_tags: ["SP-Q3", "FB-PAN"] },
    });
    const ten = Array.from({ length: 10 }, (_, i) => `T${i}`);
    expect(validateStatusRequest({ dealer_code: "D-1_x", scheme_tags: ten }).ok).toBe(true);
  });
});

describe("handleStatusRequest: request checks (400)", () => {
  it("rejects a wrong Content-Type", async () => {
    for (const ct of [null, "text/plain", "application/x-www-form-urlencoded", "application/jsonx"]) {
      const r = await handleStatusRequest(input(valid, { contentType: ct }), deps());
      expect(r.status).toBe(400);
      expect(err(r).code).toBe("INVALID_REQUEST");
    }
    const ok = await handleStatusRequest(input(valid, { contentType: "Application/JSON; charset=utf-8" }), deps());
    expect(ok.status).toBe(200);
  });

  it("rejects a body over 8 KB with 413 PAYLOAD_TOO_LARGE", async () => {
    const r = await handleStatusRequest(input(valid, { readBody: () => Promise.resolve({ ok: false, reason: "TOO_LARGE" }) }), deps());
    expect(r.status).toBe(413);
    expect(err(r)).toEqual({ code: "PAYLOAD_TOO_LARGE", message: "The request body must be 8192 bytes or smaller." });
  });

  it("rejects JSON that does not parse, and an empty body", async () => {
    for (const text of ["{bad", ""]) {
      const r = await handleStatusRequest(input(text), deps());
      expect(r.status).toBe(400);
      expect(err(r)).toEqual({ code: "INVALID_REQUEST", message: "The request body is not valid JSON." });
    }
  });

  it("rejects field errors with INVALID_REQUEST and does not call the data layer", async () => {
    const d = deps();
    for (const body of [
      { scheme_tags: ["FB-PAN"] },
      { dealer_code: "D10001", scheme_tags: [] },
      { dealer_code: "D10001", scheme_tags: Array.from({ length: 11 }, (_, i) => `ABC${i}`) },
      { dealer_code: "D10001", scheme_tags: ["FB-PAN", "FB-PAN"] },
    ]) {
      const r = await handleStatusRequest(input(body), d);
      expect(r.status).toBe(400);
      expect(err(r).code).toBe("INVALID_REQUEST");
    }
    expect(d.getDealerStatus).not.toHaveBeenCalled();
  });

  it("rejects an unknown or inactive tag before the dealer lookup", async () => {
    const d = deps();
    const r = await handleStatusRequest(input({ dealer_code: "D99999", scheme_tags: ["FB-PAN", "ABC9", "XYZ"] }), d);
    expect(r.status).toBe(400);
    expect(err(r)).toEqual({ code: "UNKNOWN_SCHEME_TAG", message: "Scheme tag ABC9 does not exist." });
    expect(d.getDealerStatus).not.toHaveBeenCalled();
  });

  it("names the unknown tag only when it is letters, digits, _ and - (QA-2: no echo of other input)", async () => {
    const msg = async (tag: string) => err(await handleStatusRequest(input({ dealer_code: "D10001", scheme_tags: [tag] }), deps())).message;
    expect(await msg("QA-UNKNOWN_0")).toBe("Scheme tag QA-UNKNOWN_0 does not exist.");
    expect(await msg("X".repeat(32))).toBe(`Scheme tag ${"X".repeat(32)} does not exist.`);
    for (const tag of ["<script>alert(1)</script>", "' OR 1=1--", "1; DROP TABLE scheme;--", "ABC 1", "abc.1", "ü1", "%3Cb%3E"]) {
      const r = await handleStatusRequest(input({ dealer_code: "D10001", scheme_tags: [tag] }), deps());
      expect(r.status).toBe(400);
      expect(err(r)).toEqual({ code: "UNKNOWN_SCHEME_TAG", message: "A scheme tag does not exist." });
    }
  });

  it("matches tags exactly (case-sensitive)", async () => {
    const r = await handleStatusRequest(input({ dealer_code: "D10001", scheme_tags: ["fb-pan"] }), deps());
    expect(err(r).code).toBe("UNKNOWN_SCHEME_TAG");
  });
});

describe("handleStatusRequest: authentication", () => {
  it("returns 401 Not authenticated for a missing token, with the Bearer challenge", async () => {
    const r = await handleStatusRequest(input(valid, { authorization: null }), deps());
    expect(r.status).toBe(401);
    expect(err(r)).toEqual({ code: "UNAUTHORIZED", message: "Not authenticated" });
    expect(r.headers["WWW-Authenticate"]).toBe('Bearer realm="scheme-calculator"');
  });

  it("returns 401 for a malformed or wrong token, and does not read the body", async () => {
    const readBody = vi.fn(() => Promise.resolve({ ok: true as const, text: JSON.stringify(valid) }));
    for (const authorization of [KEY, `token ${KEY}`, `Bearer ${"x".repeat(43)}`, "Bearer ", `Basic ${KEY}`]) {
      const r = await handleStatusRequest(input(valid, { authorization, readBody }), deps());
      expect(r.status).toBe(401);
      expect(err(r).code).toBe("UNAUTHORIZED");
    }
    expect(readBody).not.toHaveBeenCalled();
  });

  it("accepts a valid token and logs its client_id", async () => {
    const r = await handleStatusRequest(input(valid), deps());
    expect(r.status).toBe(200);
    expect(r.log).toEqual({ clientId: "sfa", code: null, tagCount: 3, dealerCode: "D10001" });
  });

  it("returns 403 INSUFFICIENT_SCOPE from the authenticator with its challenge", async () => {
    const d = deps({
      authenticate: () =>
        Promise.resolve({ ok: false, status: 403, code: "INSUFFICIENT_SCOPE", message: "Insufficient scope", wwwAuthenticate: "Bearer x" }),
    });
    const r = await handleStatusRequest(input(valid), d);
    expect(r.status).toBe(403);
    expect(err(r)).toEqual({ code: "INSUFFICIENT_SCOPE", message: "Insufficient scope" });
    expect(r.headers["WWW-Authenticate"]).toBe("Bearer x");
  });

  it("with auth off (clientId null), passes and counts all callers in one bucket", async () => {
    const d = deps({
      authenticate: () => Promise.resolve({ ok: true, clientId: null }),
      limiter: new FixedWindowLimiter({ name: "client", limit: 1, windowSec: 60, now: () => 0 }),
    });
    const r = await handleStatusRequest(input(valid, { authorization: null }), d);
    expect(r.status).toBe(200);
    expect(r.log.clientId).toBeNull();
    expect((await handleStatusRequest(input(valid, { authorization: null }), d)).status).toBe(429);
  });
});

describe("handleStatusRequest: rate limit", () => {
  it("returns 429 with Retry-After when the client uses its limit", async () => {
    let t = 0;
    const d = deps({ limiter: new FixedWindowLimiter({ name: "client", limit: 2, windowSec: 60, now: () => t }) });
    expect((await handleStatusRequest(input(valid), d)).status).toBe(200);
    expect((await handleStatusRequest(input({}), d)).status).toBe(400); // a bad request also counts
    t = 15_000;
    const r = await handleStatusRequest(input(valid), d);
    expect(r.status).toBe(429);
    expect(err(r).code).toBe("RATE_LIMITED");
    expect(r.headers["Retry-After"]).toBe("45");
    t = 60_000;
    expect((await handleStatusRequest(input(valid), d)).status).toBe(200);
  });

  it("counts each client on its own", async () => {
    const d = deps({ limiter: new FixedWindowLimiter({ name: "client", limit: 1, windowSec: 60, now: () => 0 }) });
    expect((await handleStatusRequest(input(valid), d)).status).toBe(200);
    expect((await handleStatusRequest(input(valid), d)).status).toBe(429);
    expect((await handleStatusRequest(input(valid, { authorization: `Bearer ${OTHER}` }), d)).status).toBe(200);
  });

  it("does not limit when the limiter is off (RATE_LIMIT_ENABLED=false)", async () => {
    const d = deps({ limiter: null });
    for (let i = 0; i < 5; i++) expect((await handleStatusRequest(input(valid), d)).status).toBe(200);
  });
});

describe("handleStatusRequest: response", () => {
  it("returns the schemes in the order of the request tags", async () => {
    for (const tags of [["FB-PAN", "FB-TNHPJK", "SP-Q3"], ["SP-Q3", "FB-PAN", "FB-TNHPJK"], ["FB-TNHPJK"]]) {
      const r = await handleStatusRequest(input({ dealer_code: "D10001", scheme_tags: tags }), deps());
      expect(r.status).toBe(200);
      expect((r.body as DealerStatus).schemes.map((s) => s.scheme_tag)).toEqual(tags);
    }
  });

  it("puts the schemes in request order even when the data layer returns another order", async () => {
    const d = deps({
      getDealerStatus: (code, tags) =>
        fakeGetDealerStatus(code, tags).then((s) => (s ? { ...s, schemes: [...s.schemes].reverse() } : s)),
    });
    const r = await handleStatusRequest(input({ dealer_code: "D10001", scheme_tags: ["FB-PAN", "SP-Q3"] }), d);
    expect((r.body as DealerStatus).schemes.map((s) => s.scheme_tag)).toEqual(["FB-PAN", "SP-Q3"]);
  });

  it("passes the trimmed code and tags to the data layer and returns its object unchanged (no wrapper)", async () => {
    const d = deps();
    const r = await handleStatusRequest(input({ dealer_code: " C1 ", scheme_tags: ["SP-Q3"] }), d);
    expect(d.getDealerStatus).toHaveBeenCalledWith("C1", ["SP-Q3"]);
    expect(r.body).toEqual({ dealer_code: "D10001", dealer_name: "Dealer", data_as_of: null, schemes: [scheme("SP-Q3")] });
    expect(r.body).not.toHaveProperty("message");
  });

  it("returns 404 DEALER_NOT_FOUND for an unknown dealer", async () => {
    const r = await handleStatusRequest(input({ dealer_code: "D99999", scheme_tags: ["FB-PAN"] }), deps());
    expect(r.status).toBe(404);
    expect(err(r)).toEqual({ code: "DEALER_NOT_FOUND", message: "Dealer D99999 does not exist." });
  });

  it("returns 503 SERVICE_BUSY with Retry-After 2 when no database connection is free", async () => {
    for (const e of [
      new Error("timeout exceeded when trying to connect"),
      new Error("Failed query", { cause: new Error("timeout exceeded when trying to connect") }),
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), { code: "ECONNREFUSED" }),
    ]) {
      const r = await handleStatusRequest(input(valid), deps({ getDealerStatus: () => Promise.reject(e) }));
      expect(r.status).toBe(503);
      expect(err(r)).toEqual({ code: "SERVICE_BUSY", message: "Service busy. Try again in a few seconds." });
      expect(r.headers["Retry-After"]).toBe("2");
      expect(JSON.stringify(r.body)).not.toContain("timeout");
    }
  });

  it("returns 500 INTERNAL_ERROR with no detail when the data layer fails", async () => {
    const d = deps({ getDealerStatus: () => Promise.reject(new Error('relation "dealer" does not exist SELECT ...')) });
    const r = await handleStatusRequest(input(valid), d);
    expect(r.status).toBe(500);
    expect(err(r)).toEqual({ code: "INTERNAL_ERROR", message: "Internal error. Try again later." });
    expect(JSON.stringify(r.body)).not.toContain("SELECT");
  });

  it("keeps the client, tag count, dealer code and error detail in the 500 log context", async () => {
    const d = deps({ getDealerStatus: () => Promise.reject(new Error("db down")) });
    const r = await handleStatusRequest(input(valid), d);
    expect(r.log).toEqual({ clientId: "sfa", code: "INTERNAL_ERROR", tagCount: 3, dealerCode: "D10001", error: "Error: db down" });
    expect(JSON.stringify(r.body)).not.toContain("db down");
    // No separate log line without the request ID: the route writes the detail on its one line.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
