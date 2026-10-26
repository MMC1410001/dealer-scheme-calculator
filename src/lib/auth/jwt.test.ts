/** Bearer token checks (same cases as the reference API tests/test_auth.py, protected endpoint part). */
import { describe, expect, it } from "vitest";
import { SignJWT, decodeJwt } from "jose";
import { AUDIENCE, ISSUER, SCOPE, issueToken, verifyBearer, type JwtSettings } from "./jwt";

const KEY = "k".repeat(40);
const S: JwtSettings = { secret: KEY, previousSecret: null, ttlSeconds: 3600, clients: new Map([["partner", "a".repeat(64)]]) };

async function signed(changes: Record<string, unknown> = {}, opts: { key?: string; alg?: string } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { iss: ISSUER, aud: AUDIENCE, sub: "partner", scope: SCOPE, iat: now, nbf: now, exp: now + 3600, jti: "x", ...changes };
  for (const k of Object.keys(claims)) if (claims[k] === null) delete claims[k];
  return new SignJWT(claims).setProtectedHeader({ alg: opts.alg ?? "HS256" }).sign(new TextEncoder().encode(opts.key ?? KEY));
}

/** Like signed, but keeps null values in the payload. */
async function signedKeepNull(changes: Record<string, unknown>): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: ISSUER, aud: AUDIENCE, sub: "partner", scope: SCOPE, iat: now, nbf: now, exp: now + 3600, jti: "x", ...changes };
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(KEY));
}

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

describe("issueToken", () => {
  it("issues an HS256 token with all required claims, valid for the TTL", async () => {
    const t = await issueToken("partner", S);
    const c = decodeJwt(t);
    expect(c).toMatchObject({ iss: ISSUER, aud: AUDIENCE, sub: "partner", scope: SCOPE });
    expect(c.exp! - c.iat!).toBe(3600);
    expect(c.nbf).toBe(c.iat);
    expect(String(c.jti)).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(await verifyBearer(`Bearer ${t}`, S)).toEqual({ ok: true, clientId: "partner" });
  });

  it("makes a unique token each time (jti)", async () => {
    const tokens = new Set(await Promise.all([1, 2, 3].map(() => issueToken("partner", S))));
    expect(tokens.size).toBe(3);
  });
});

describe("verifyBearer", () => {
  it("missing token or another scheme: 401 Not authenticated with the plain Bearer challenge", async () => {
    for (const h of [null, "", "Bearer", "Bearer ", `Basic ${Buffer.from("partner:x").toString("base64")}`, "token abc"]) {
      const r = await verifyBearer(h, S);
      expect(r).toEqual({
        ok: false,
        status: 401,
        code: "UNAUTHORIZED",
        message: "Not authenticated",
        wwwAuthenticate: 'Bearer realm="scheme-calculator"',
      });
    }
  });

  it("expired token: 401 Token expired with error=invalid_token", async () => {
    const r = await verifyBearer(`Bearer ${await signed({ exp: Math.floor(Date.now() / 1000) - 60 })}`, S);
    expect(r).toMatchObject({ ok: false, status: 401, message: "Token expired" });
    if (!r.ok) expect(r.wwwAuthenticate).toContain('error="invalid_token"');
  });

  it("allows clock skew within the 30 s leeway", async () => {
    expect((await verifyBearer(`Bearer ${await signed({ exp: Math.floor(Date.now() / 1000) - 10 })}`, S)).ok).toBe(true);
  });

  it.each([
    ["forged signature", () => signed({}, { key: "another-key-of-at-least-32-characters" })],
    ["other issuer", () => signed({ iss: "someone-else" })],
    ["other audience", () => signed({ aud: "another-api" })],
    ["no jti", () => signed({ jti: null })],
    ["no exp", () => signed({ exp: null })],
    ["no nbf", () => signed({ nbf: null })],
    ["no iat", () => signed({ iat: null })],
    ["future nbf", () => signed({ nbf: Math.floor(Date.now() / 1000) + 600 })],
    ["removed client", () => signed({ sub: "removed-client" })],
    ["HS512", () => signed({}, { alg: "HS512" })],
    ["iat in the future (1 day)", () => signed({ iat: Math.floor(Date.now() / 1000) + 86_400 })],
    ["iat beyond the leeway (+40 s)", () => signed({ iat: Math.floor(Date.now() / 1000) + 40 })],
    ["null jti", () => signedKeepNull({ jti: null })],
    ["empty jti", () => signed({ jti: "" })],
    ["number jti", () => signed({ jti: 123 })],
    ["null sub", () => signedKeepNull({ sub: null })],
    ["not a JWT", () => Promise.resolve("not.a.jwt")],
  ])("refuses %s with 401 Invalid token", async (_name, make) => {
    const r = await verifyBearer(`Bearer ${await make()}`, S);
    expect(r).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED", message: "Invalid token" });
  });

  it("refuses alg none", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: ISSUER, aud: AUDIENCE, sub: "partner", scope: SCOPE, iat: now, nbf: now, exp: now + 60, jti: "x" };
    const unsigned = `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.`;
    expect(await verifyBearer(`Bearer ${unsigned}`, S)).toMatchObject({ ok: false, status: 401, message: "Invalid token" });
  });

  it("token without the scope: 403 Insufficient scope", async () => {
    const r = await verifyBearer(`Bearer ${await signed({ scope: "other" })}`, S);
    expect(r).toMatchObject({ ok: false, status: 403, code: "INSUFFICIENT_SCOPE", message: "Insufficient scope" });
    if (!r.ok) expect(r.wwwAuthenticate).toBe('Bearer realm="scheme-calculator", error="insufficient_scope", scope="schemes:read"');
    expect((await verifyBearer(`Bearer ${await signed({ scope: null })}`, S)).ok).toBe(false);
  });

  it("checks the scope that the endpoint needs (choices:write)", async () => {
    const W: JwtSettings = { ...S, writeClients: new Set(["partner"]) };
    const token = await signed({ scope: "schemes:read choices:write" });
    expect(await verifyBearer(`Bearer ${token}`, W, undefined, "choices:write")).toEqual({ ok: true, clientId: "partner" });
    const r = await verifyBearer(`Bearer ${await signed({})}`, W, undefined, "choices:write");
    expect(r).toMatchObject({ ok: false, status: 403, code: "INSUFFICIENT_SCOPE" });
    if (!r.ok) expect(r.wwwAuthenticate).toContain('scope="choices:write"');
  });

  it("a client taken out of AUTH_WRITE_CLIENTS loses the write scope of its older tokens at once; reading still works", async () => {
    const token = `Bearer ${await signed({ scope: "schemes:read choices:write" })}`;
    for (const removed of [{ ...S, writeClients: new Set<string>() }, { ...S, writeClients: new Set(["other"]) }, S]) {
      const r = await verifyBearer(token, removed, undefined, "choices:write");
      expect(r).toMatchObject({ ok: false, status: 403, code: "INSUFFICIENT_SCOPE", message: "Insufficient scope" });
      if (!r.ok) expect(r.wwwAuthenticate).toBe('Bearer realm="scheme-calculator", error="insufficient_scope", scope="choices:write"');
      expect(await verifyBearer(token, removed)).toEqual({ ok: true, clientId: "partner" });
    }
  });

  it("scope that is not a string (array): 403 Insufficient scope, as in the reference", async () => {
    for (const scope of [[SCOPE], { s: SCOPE }, 1]) {
      const r = await verifyBearer(`Bearer ${await signed({ scope })}`, S);
      expect(r).toMatchObject({ ok: false, status: 403, code: "INSUFFICIENT_SCOPE" });
    }
  });

  it("allows iat up to the 30 s leeway in the future", async () => {
    expect((await verifyBearer(`Bearer ${await signed({ iat: Math.floor(Date.now() / 1000) + 20 })}`, S)).ok).toBe(true);
  });

  it("accepts a lowercase bearer scheme", async () => {
    expect((await verifyBearer(`bearer ${await issueToken("partner", S)}`, S)).ok).toBe(true);
  });

  it("refuses non-ASCII token values with 401 Invalid token (not 500)", async () => {
    for (const v of ["kéy", "ÿ".repeat(14), "eyJé.x.y"]) {
      expect(await verifyBearer(`Bearer ${v}`, S)).toMatchObject({ ok: false, status: 401, message: "Invalid token" });
    }
  });

  it("key rotation: tokens of the previous key work until it is removed", async () => {
    const oldToken = await issueToken("partner", S);
    const rotating: JwtSettings = { ...S, secret: "n".repeat(40), previousSecret: KEY };
    expect((await verifyBearer(`Bearer ${oldToken}`, rotating)).ok).toBe(true);
    expect((await verifyBearer(`Bearer ${await issueToken("partner", rotating)}`, rotating)).ok).toBe(true);
    const rotated: JwtSettings = { ...rotating, previousSecret: null };
    expect(await verifyBearer(`Bearer ${oldToken}`, rotated)).toMatchObject({ ok: false, status: 401, message: "Invalid token" });
  });

  it("an expired token of the previous key says Token expired", async () => {
    const old = await signed({ exp: Math.floor(Date.now() / 1000) - 120 });
    const rotating: JwtSettings = { ...S, secret: "n".repeat(40), previousSecret: KEY };
    expect(await verifyBearer(`Bearer ${old}`, rotating)).toMatchObject({ ok: false, message: "Token expired" });
  });
});
