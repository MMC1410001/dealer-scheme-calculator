import { beforeAll, describe, expect, it, vi } from "vitest";
import { WRITE_SCOPE, SCOPE, issueToken, verifyBearer, type JwtSettings } from "@/lib/auth/jwt";
import type { SaveOutcome } from "@/server/reward-choice-store";
import type { ApiErrorBody, StatusRequestInput } from "./dealer-status";
import { handleChoiceRequest, validateChoiceRequest, type ChoiceRequestDeps } from "./reward-choice";

const JWT: JwtSettings = {
  secret: "s".repeat(40),
  previousSecret: null,
  ttlSeconds: 3600,
  clients: new Map([["sfa", "a".repeat(64)]]),
  writeClients: new Set(["sfa"]),
};
let WRITE = "";
let READ = "";
beforeAll(async () => {
  WRITE = await issueToken("sfa", JWT, undefined, [SCOPE, WRITE_SCOPE]);
  READ = await issueToken("sfa", JWT);
});

const OK: SaveOutcome = {
  ok: true,
  dealerCode: "D1",
  schemeTag: "FB-PAN",
  changed: true,
  rewardChoice: { choice: "GIFT", destination: null, source: "API", chosen_by: "SO1", updated_at: "2026-10-22T11:30:00+05:30" },
};

function deps(save: ChoiceRequestDeps["save"] = vi.fn(() => Promise.resolve(OK))): ChoiceRequestDeps {
  return { authenticate: (a) => verifyBearer(a, JWT, undefined, WRITE_SCOPE), limiter: null, save };
}
function input(body: unknown, token = WRITE, over: Partial<StatusRequestInput> = {}): StatusRequestInput {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { authorization: `Bearer ${token}`, contentType: "application/json", readBody: () => Promise.resolve({ ok: true, text }), ...over };
}
const GOOD = { dealer_code: "D1", scheme_tag: "FB-PAN", choice: "GIFT", chosen_by: "SO1" };
const code = (r: { body: unknown }) => (r.body as ApiErrorBody).error.code;

describe("validateChoiceRequest", () => {
  it("accepts the fields and trims the codes", () => {
    expect(validateChoiceRequest({ ...GOOD, dealer_code: " D1 ", destination: null })).toEqual({
      ok: true,
      value: { dealerCode: "D1", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: "SO1" },
    });
    expect(validateChoiceRequest({ ...GOOD, destination: "OVERSEAS" }).ok).toBe(true);
  });

  it.each([
    [{ ...GOOD, choice: "gift" }],
    [{ ...GOOD, choice: "VOUCHER" }],
    [{ ...GOOD, destination: "GOA" }],
    [{ ...GOOD, destination: 1 }],
    [{ ...GOOD, chosen_by: undefined }],
    [{ ...GOOD, chosen_by: "a b" }],
    [{ ...GOOD, dealer_code: "1' OR '1'='1" }],
    [{ ...GOOD, scheme_tag: "<x>" }],
    [[GOOD]],
  ])("refuses %j", (body) => {
    expect(validateChoiceRequest(body).ok).toBe(false);
  });
});

describe("handleChoiceRequest", () => {
  it("saves and returns 200 with the stored choice", async () => {
    const d = deps();
    const r = await handleChoiceRequest(input(GOOD), d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ dealer_code: "D1", scheme_tag: "FB-PAN", changed: true, reward_choice: OK.ok ? OK.rewardChoice : null });
    // The client_id of the token goes to the history (actor).
    expect(d.save).toHaveBeenCalledWith({ dealerCode: "D1", schemeTag: "FB-PAN", choice: "GIFT", destination: null, chosenBy: "SO1" }, "sfa");
  });

  it("needs the choices:write scope (403 for a read-only token)", async () => {
    const d = deps();
    const r = await handleChoiceRequest(input(GOOD, READ), d);
    expect([r.status, code(r)]).toEqual([403, "INSUFFICIENT_SCOPE"]);
    expect(r.headers["WWW-Authenticate"]).toContain('scope="choices:write"');
    expect(d.save).not.toHaveBeenCalled();
  });

  it("maps the save outcomes to 400, 404 and 409", async () => {
    const fail = (c: string, message = "m") => deps(() => Promise.resolve({ ok: false, code: c, message } as SaveOutcome));
    const tag = await handleChoiceRequest(input(GOOD), fail("UNKNOWN_SCHEME_TAG"));
    expect([tag.status, code(tag)]).toEqual([400, "UNKNOWN_SCHEME_TAG"]);
    const dealer = await handleChoiceRequest(input(GOOD), fail("DEALER_NOT_FOUND"));
    expect([dealer.status, code(dealer)]).toEqual([404, "DEALER_NOT_FOUND"]);
    const slab = await handleChoiceRequest(input(GOOD), fail("NOT_IN_SLAB", "The dealer has not reached a slab in this scheme yet."));
    expect([slab.status, code(slab), (slab.body as ApiErrorBody).error.message]).toEqual([
      409,
      "CHOICE_NOT_ALLOWED",
      "The dealer has not reached a slab in this scheme yet.",
    ]);
    const dest = await handleChoiceRequest(input(GOOD), fail("DESTINATION_NOT_ALLOWED"));
    expect(dest.status).toBe(409);
  });

  it("refuses a bad body with 400 and does not save", async () => {
    const d = deps();
    for (const r of [
      await handleChoiceRequest(input("{"), d),
      await handleChoiceRequest(input({ ...GOOD, choice: "X" }), d),
      await handleChoiceRequest(input(GOOD, WRITE, { contentType: "text/plain" }), d),
    ]) {
      expect([r.status, code(r)]).toEqual([400, "INVALID_REQUEST"]);
    }
    expect(d.save).not.toHaveBeenCalled();
  });

  it("answers 503 SERVICE_BUSY when no database connection is free, and 500 for other errors", async () => {
    const busy = await handleChoiceRequest(input(GOOD), deps(() => Promise.reject(new Error("timeout exceeded when trying to connect"))));
    expect([busy.status, code(busy), busy.headers["Retry-After"]]).toEqual([503, "SERVICE_BUSY", "2"]);
    const boom = await handleChoiceRequest(input(GOOD), deps(() => Promise.reject(new Error("boom"))));
    expect([boom.status, code(boom)]).toEqual([500, "INTERNAL_ERROR"]);
    expect(JSON.stringify(boom.body)).not.toContain("boom");
  });
});
