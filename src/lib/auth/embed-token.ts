/**
 * Iframe dealer identity (CLAUDE.md section 10 and 11).
 *
 * The host application (SAP Commerce / SFA) signs a short-lived token for the logged-in dealer.
 * Token format: base64url(JSON {d: dealerCode, exp: unixSeconds, v: 1}) + "." + base64url(HMAC-SHA256(payloadPart, secret)).
 * The HMAC input is the base64url payload string exactly as it appears in the token.
 *
 * Node.js only (node:crypto). The /embed page and the token script use it.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const EMBED_TOKEN_VERSION = 1;
/** Longest token lifetime that we accept: 24 hours. */
export const EMBED_TOKEN_MAX_TTL_SECONDS = 24 * 60 * 60;
/** Minimum length of the shared secret. */
export const EMBED_SECRET_MIN_LENGTH = 32;
/** Allowed clock difference between the host system and this server. */
const CLOCK_SKEW_SECONDS = 60;
/** Longest token string that we parse. */
const MAX_TOKEN_LENGTH = 1024;

/** Dealer codes: letters, digits, "_" and "-", 1 to 32 characters. */
export const DEALER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export class EmbedTokenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbedTokenConfigError";
  }
}

export type EmbedTokenError = "MISSING" | "MALFORMED" | "BAD_SIGNATURE" | "BAD_VERSION" | "EXPIRED" | "TTL_TOO_LONG" | "CONFIG";

export type VerifyEmbedTokenResult =
  | { ok: true; dealerCode: string; exp: number }
  | { ok: false; error: EmbedTokenError };

export interface EmbedTokenOptions {
  /** Shared secret. Default: process.env.EMBED_SIGNING_SECRET. */
  secret?: string;
  /** Current time in unix seconds. Default: Date.now(). For tests. */
  nowSeconds?: number;
}

function resolveSecret(secret: string | undefined): string {
  const s = secret ?? process.env.EMBED_SIGNING_SECRET ?? "";
  if (s.length < EMBED_SECRET_MIN_LENGTH) {
    throw new EmbedTokenConfigError(`EMBED_SIGNING_SECRET must have at least ${EMBED_SECRET_MIN_LENGTH} characters.`);
  }
  return s;
}

function nowSecondsOf(opts: EmbedTokenOptions | undefined): number {
  return opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
}

function hmac(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart, "utf8").digest();
}

export function signEmbedToken(input: { dealerCode: string; ttlSeconds: number } & EmbedTokenOptions): string {
  const secret = resolveSecret(input.secret);
  if (!DEALER_CODE_PATTERN.test(input.dealerCode)) {
    throw new RangeError("dealerCode must have 1 to 32 letters, digits, '_' or '-'.");
  }
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > EMBED_TOKEN_MAX_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds must be an integer from 1 to ${EMBED_TOKEN_MAX_TTL_SECONDS}.`);
  }
  const payload = { d: input.dealerCode, exp: nowSecondsOf(input) + input.ttlSeconds, v: EMBED_TOKEN_VERSION };
  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigPart = hmac(payloadPart, secret).toString("base64url");
  return `${payloadPart}.${sigPart}`;
}

export function verifyEmbedToken(token: string | null | undefined, opts?: EmbedTokenOptions): VerifyEmbedTokenResult {
  if (!token) return { ok: false, error: "MISSING" };

  let secret: string;
  try {
    secret = resolveSecret(opts?.secret);
  } catch {
    return { ok: false, error: "CONFIG" };
  }

  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, error: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, error: "MALFORMED" };
  const [payloadPart, sigPart] = parts;
  if (!BASE64URL_PATTERN.test(payloadPart) || !BASE64URL_PATTERN.test(sigPart)) return { ok: false, error: "MALFORMED" };

  // Check the signature before we parse the payload.
  const expected = hmac(payloadPart, secret);
  const given = Buffer.from(sigPart, "base64url");
  // The decoder ignores the unused low bits of the last character, so another last character can decode to the
  // same bytes. Accept only the canonical spelling: a changed signature string never passes.
  if (given.length !== expected.length || !timingSafeEqual(given, expected) || given.toString("base64url") !== sigPart) {
    return { ok: false, error: "BAD_SIGNATURE" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "MALFORMED" };
  }
  if (typeof payload !== "object" || payload === null) return { ok: false, error: "MALFORMED" };
  const { d, exp, v } = payload as Record<string, unknown>;
  if (v !== EMBED_TOKEN_VERSION) return { ok: false, error: "BAD_VERSION" };
  if (typeof d !== "string" || !DEALER_CODE_PATTERN.test(d)) return { ok: false, error: "MALFORMED" };
  if (typeof exp !== "number" || !Number.isInteger(exp)) return { ok: false, error: "MALFORMED" };

  const now = nowSecondsOf(opts);
  if (exp <= now) return { ok: false, error: "EXPIRED" };
  if (exp - now > EMBED_TOKEN_MAX_TTL_SECONDS + CLOCK_SKEW_SECONDS) return { ok: false, error: "TTL_TOO_LONG" };

  return { ok: true, dealerCode: d, exp };
}

/** True when the plain ?dealer_code= test parameter is allowed (development only). */
export function isDevDealerParamAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" && env.ALLOW_DEV_DEALER_PARAM === "true";
}

export type EmbedIdentity =
  | { ok: true; dealerCode: string; via: "token" | "dev_param" }
  | { ok: false; error: EmbedTokenError };

/**
 * Finds the dealer for an /embed request.
 * A token always wins. The plain dealer_code parameter is used only when no token is given
 * and isDevDealerParamAllowed() is true.
 */
export function resolveEmbedIdentity(
  params: { token?: string | null; dealerCode?: string | null },
  opts?: EmbedTokenOptions & { env?: Record<string, string | undefined> },
): EmbedIdentity {
  if (params.token) {
    const r = verifyEmbedToken(params.token, opts);
    return r.ok ? { ok: true, dealerCode: r.dealerCode, via: "token" } : r;
  }
  if (params.dealerCode && isDevDealerParamAllowed(opts?.env)) {
    const code = params.dealerCode.trim();
    return DEALER_CODE_PATTERN.test(code) ? { ok: true, dealerCode: code, via: "dev_param" } : { ok: false, error: "MALFORMED" };
  }
  return { ok: false, error: "MISSING" };
}

/** Parses ?tags=FB-PAN,SP-Q3. Unknown-looking values are dropped. Max 10 tags. Empty = all schemes. */
export function parseSchemeTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (/^[A-Za-z0-9_-]{1,32}$/.test(t) && !out.includes(t)) out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}
