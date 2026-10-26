import { beforeAll, describe, expect, it, vi } from "vitest";
import { SCOPE, issueToken, verifyBearer, type JwtSettings } from "@/lib/auth/jwt";
import { EmbedTokenConfigError, signEmbedToken, verifyEmbedToken } from "@/lib/auth/embed-token";
import type { ApiErrorBody, StatusRequestInput } from "./dealer-status";
import { embedPath, handleEmbedTokenRequest, validateEmbedTokenRequest, type EmbedTokenDeps, type EmbedTokenResponse } from "./embed-token";

const SECRET = "e".repeat(40);
const NOW = 1_790_000_000;
const JWT: JwtSettings = {
  secret: "s".repeat(40),
  previousSecret: null,
  ttlSeconds: 3600,
  clients: new Map([["sfa", "a".repeat(64)]]),
  writeClients: new Set(),
};
let READ = "";
beforeAll(async () => {
  READ = await issueToken("sfa", JWT);
});

function deps(over: Partial<EmbedTokenDeps> = {}): EmbedTokenDeps {
  return {
    authenticate: (a) => verifyBearer(a, JWT, undefined, SCOPE),
    limiter: null,
    listActiveTags: () => Promise.resolve(["FB-PAN", "FB-TNHPJK", "SP-Q3"]),
    sign: (dealerCode, ttlSeconds, nowSeconds) => signEmbedToken({ dealerCode, ttlSeconds, nowSeconds, secret: SECRET }),
    nowSeconds: () => NOW,
    ...over,
  };
}
function input(body: unknown, token = READ, over: Partial<StatusRequestInput> = {}): StatusRequestInput {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { authorization: `Bearer ${token}`, contentType: "application/json", readBody: () => Promise.resolve({ ok: true, text }), ...over };
}
const code = (r: { body: unknown }) => (r.body as ApiErrorBody).error.code;

describe("validateEmbedTokenRequest", () => {
  it("uses the defaults: all schemes, 1 hour", () => {
    expect(validateEmbedTokenRequest({ dealer_code: " D1 " })).toEqual({
      ok: true,
      value: { dealerCode: "D1", schemeTags: [], ttlSeconds: 3600 },
    });
  });

  it("accepts tags and a TTL", () => {
    expect(validateEmbedTokenRequest({ dealer_code: "D1", scheme_tags: ["SP-Q3", " FB-PAN "], ttl_seconds: 600 })).toEqual({
      ok: true,
      value: { dealerCode: "D1", schemeTags: ["SP-Q3", "FB-PAN"], ttlSeconds: 600 },
    });
  });

  it.each([
    [{}],
    [{ dealer_code: "1' OR '1'='1" }],
    [{ dealer_code: "D1", scheme_tags: "FB-PAN" }],
    [{ dealer_code: "D1", scheme_tags: ["FB-PAN", "FB-PAN"] }],
    [{ dealer_code: "D1", scheme_tags: ["<x>"] }],
    [{ dealer_code: "D1", ttl_seconds: 59 }],
    [{ dealer_code: "D1", ttl_seconds: 86401 }],
    [{ dealer_code: "D1", ttl_seconds: 600.5 }],
    [{ dealer_code: "D1", ttl_seconds: "600" }],
    [[{ dealer_code: "D1" }]],
  ])("refuses %j", (body) => {
    expect(validateEmbedTokenRequest(body).ok).toBe(false);
  });
});

describe("handleEmbedTokenRequest", () => {
  it("returns a token that the iframe accepts, with the path and the expiry", async () => {
    const r = await handleEmbedTokenRequest(input({ dealer_code: "D1", scheme_tags: ["FB-PAN"], ttl_seconds: 900 }), deps());
    expect(r.status).toBe(200);
    const b = r.body as EmbedTokenResponse;
    expect(verifyEmbedToken(b.token, { secret: SECRET, nowSeconds: NOW })).toEqual({ ok: true, dealerCode: "D1", exp: NOW + 900 });
    expect(b.embed_path).toBe(embedPath(b.token, ["FB-PAN"]));
    expect(b.embed_path).toMatch(/^\/embed\?token=[A-Za-z0-9_.-]+&tags=FB-PAN$/);
    expect(b.expires_at).toBe(new Date((NOW + 900) * 1000).toISOString());
    expect(r.log).toMatchObject({ clientId: "sfa", dealerCode: "D1", tagCount: 1, code: null });
  });

  it("leaves out tags when none are given", async () => {
    const r = await handleEmbedTokenRequest(input({ dealer_code: "D1" }), deps());
    expect((r.body as EmbedTokenResponse).embed_path).not.toContain("tags=");
  });

  it("needs a valid token", async () => {
    const r = await handleEmbedTokenRequest(input({ dealer_code: "D1" }, "bad"), deps());
    expect(r.status).toBe(401);
    expect(code(r)).toBe("UNAUTHORIZED");
  });

  it("refuses an unknown scheme tag", async () => {
    const r = await handleEmbedTokenRequest(input({ dealer_code: "D1", scheme_tags: ["ABC1"] }), deps());
    expect(r.status).toBe(400);
    expect(code(r)).toBe("UNKNOWN_SCHEME_TAG");
  });

  it("does not read the scheme tags when none are given", async () => {
    const listActiveTags = vi.fn(() => Promise.resolve([]));
    await handleEmbedTokenRequest(input({ dealer_code: "D1" }), deps({ listActiveTags }));
    expect(listActiveTags).not.toHaveBeenCalled();
  });

  it("checks Content-Type and JSON", async () => {
    expect(code(await handleEmbedTokenRequest(input({ dealer_code: "D1" }, READ, { contentType: "text/plain" }), deps()))).toBe("INVALID_REQUEST");
    expect(code(await handleEmbedTokenRequest(input("{"), deps()))).toBe("INVALID_REQUEST");
  });

  it("gives 503 API_DISABLED when the signing secret is not set", async () => {
    const sign = () => {
      throw new EmbedTokenConfigError("EMBED_SIGNING_SECRET must have at least 32 characters.");
    };
    const r = await handleEmbedTokenRequest(input({ dealer_code: "D1" }), deps({ sign }));
    expect(r.status).toBe(503);
    expect(code(r)).toBe("API_DISABLED");
    expect(JSON.stringify(r.body)).not.toContain("EMBED_SIGNING_SECRET");
  });

  it("gives 429 when the client limit is reached", async () => {
    const limiter = { take: () => Promise.resolve({ allowed: false as const, count: 2, retryAfterSeconds: 7 }) };
    const r = await handleEmbedTokenRequest(input({ dealer_code: "D1" }), deps({ limiter }));
    expect(r.status).toBe(429);
    expect(r.headers["Retry-After"]).toBe("7");
  });
});
