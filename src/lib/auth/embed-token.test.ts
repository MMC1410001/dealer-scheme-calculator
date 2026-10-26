import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMBED_TOKEN_MAX_TTL_SECONDS,
  isDevDealerParamAllowed,
  parseSchemeTags,
  resolveEmbedIdentity,
  signEmbedToken,
  verifyEmbedToken,
} from "./embed-token";

const secret = "s".repeat(32) + "-test-secret";
const now = 1_790_000_000;

function forge(payload: object, key = secret): string {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = createHmac("sha256", key).update(p).digest("base64url");
  return `${p}.${s}`;
}

describe("embed token", () => {
  it("round-trips a valid token", () => {
    const t = signEmbedToken({ dealerCode: "D10001", ttlSeconds: 600, secret, nowSeconds: now });
    expect(verifyEmbedToken(t, { secret, nowSeconds: now + 10 })).toEqual({ ok: true, dealerCode: "D10001", exp: now + 600 });
  });

  it("uses the documented format", () => {
    const t = signEmbedToken({ dealerCode: "D1", ttlSeconds: 60, secret, nowSeconds: now });
    expect(t).toBe(forge({ d: "D1", exp: now + 60, v: 1 }));
  });

  it("rejects an expired token", () => {
    const t = signEmbedToken({ dealerCode: "D1", ttlSeconds: 60, secret, nowSeconds: now });
    expect(verifyEmbedToken(t, { secret, nowSeconds: now + 60 })).toEqual({ ok: false, error: "EXPIRED" });
  });

  it("rejects a token signed with another secret", () => {
    const t = signEmbedToken({ dealerCode: "D1", ttlSeconds: 60, secret: "x".repeat(40), nowSeconds: now });
    expect(verifyEmbedToken(t, { secret, nowSeconds: now })).toEqual({ ok: false, error: "BAD_SIGNATURE" });
  });

  it("rejects a changed dealer code (tampered payload)", () => {
    const t = signEmbedToken({ dealerCode: "D1", ttlSeconds: 60, secret, nowSeconds: now });
    const [, sig] = t.split(".");
    const p = Buffer.from(JSON.stringify({ d: "D2", exp: now + 60, v: 1 })).toString("base64url");
    expect(verifyEmbedToken(`${p}.${sig}`, { secret, nowSeconds: now })).toEqual({ ok: false, error: "BAD_SIGNATURE" });
  });

  it("rejects every other last character of the signature, also one that decodes to the same bytes", () => {
    const t = signEmbedToken({ dealerCode: "D1", ttlSeconds: 600, secret, nowSeconds: now });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // 32-byte HMAC = 43 characters; the last one carries 4 data bits, so 3 other characters decode to the same bytes.
    for (const c of alphabet.replace(t.slice(-1), "")) {
      expect(verifyEmbedToken(`${t.slice(0, -1)}${c}`, { secret, nowSeconds: now })).toEqual({ ok: false, error: "BAD_SIGNATURE" });
    }
  });

  it("rejects malformed tokens", () => {
    for (const t of ["abc", "a.b.c", "a b.c", ".", "a.", "x".repeat(2000) + ".y"]) {
      expect(verifyEmbedToken(t, { secret, nowSeconds: now }).ok).toBe(false);
    }
    expect(verifyEmbedToken("", { secret })).toEqual({ ok: false, error: "MISSING" });
    expect(verifyEmbedToken(null, { secret })).toEqual({ ok: false, error: "MISSING" });
  });

  it("rejects a wrong version and bad payload fields", () => {
    expect(verifyEmbedToken(forge({ d: "D1", exp: now + 60, v: 2 }), { secret, nowSeconds: now })).toEqual({ ok: false, error: "BAD_VERSION" });
    expect(verifyEmbedToken(forge({ d: "D 1", exp: now + 60, v: 1 }), { secret, nowSeconds: now })).toEqual({ ok: false, error: "MALFORMED" });
    expect(verifyEmbedToken(forge({ d: "D1", exp: "soon", v: 1 }), { secret, nowSeconds: now })).toEqual({ ok: false, error: "MALFORMED" });
    expect(verifyEmbedToken(forge([1, 2]), { secret, nowSeconds: now })).toEqual({ ok: false, error: "BAD_VERSION" });
  });

  it("rejects a token that lives longer than 24 hours", () => {
    const t = forge({ d: "D1", exp: now + EMBED_TOKEN_MAX_TTL_SECONDS + 3600, v: 1 });
    expect(verifyEmbedToken(t, { secret, nowSeconds: now })).toEqual({ ok: false, error: "TTL_TOO_LONG" });
  });

  it("refuses short secrets", () => {
    expect(() => signEmbedToken({ dealerCode: "D1", ttlSeconds: 60, secret: "short" })).toThrow(/32/);
    expect(verifyEmbedToken("a.b", { secret: "short" })).toEqual({ ok: false, error: "CONFIG" });
  });

  it("limits the TTL when signing", () => {
    expect(() => signEmbedToken({ dealerCode: "D1", ttlSeconds: EMBED_TOKEN_MAX_TTL_SECONDS + 1, secret })).toThrow(RangeError);
    expect(() => signEmbedToken({ dealerCode: "D1", ttlSeconds: 0, secret })).toThrow(RangeError);
    expect(() => signEmbedToken({ dealerCode: "bad code", ttlSeconds: 60, secret })).toThrow(RangeError);
  });
});

describe("embed identity", () => {
  const devEnv = { NODE_ENV: "development", ALLOW_DEV_DEALER_PARAM: "true" };

  it("allows the dev parameter only outside production and only when enabled", () => {
    expect(isDevDealerParamAllowed(devEnv)).toBe(true);
    expect(isDevDealerParamAllowed({ NODE_ENV: "production", ALLOW_DEV_DEALER_PARAM: "true" })).toBe(false);
    expect(isDevDealerParamAllowed({ NODE_ENV: "development", ALLOW_DEV_DEALER_PARAM: "false" })).toBe(false);
    expect(isDevDealerParamAllowed({ NODE_ENV: "development" })).toBe(false);
  });

  it("uses the dev parameter when allowed", () => {
    expect(resolveEmbedIdentity({ dealerCode: "D9" }, { env: devEnv, secret })).toEqual({ ok: true, dealerCode: "D9", via: "dev_param" });
    expect(resolveEmbedIdentity({ dealerCode: "D9" }, { env: { NODE_ENV: "production", ALLOW_DEV_DEALER_PARAM: "true" }, secret })).toEqual({
      ok: false,
      error: "MISSING",
    });
  });

  it("prefers the token, and does not fall back to dealer_code when the token is bad", () => {
    const t = signEmbedToken({ dealerCode: "D1", ttlSeconds: 60, secret, nowSeconds: now });
    expect(resolveEmbedIdentity({ token: t, dealerCode: "D9" }, { env: devEnv, secret, nowSeconds: now })).toEqual({
      ok: true,
      dealerCode: "D1",
      via: "token",
    });
    expect(resolveEmbedIdentity({ token: "bad", dealerCode: "D9" }, { env: devEnv, secret, nowSeconds: now }).ok).toBe(false);
  });
});

describe("parseSchemeTags", () => {
  it("splits, trims, dedupes and drops invalid tags", () => {
    expect(parseSchemeTags(" FB-PAN, SP-Q3,FB-PAN,,bad tag,<x>")).toEqual(["FB-PAN", "SP-Q3"]);
    expect(parseSchemeTags(undefined)).toEqual([]);
    expect(parseSchemeTags(Array.from({ length: 20 }, (_, i) => `T${i}`).join(","))).toHaveLength(10);
  });
});
