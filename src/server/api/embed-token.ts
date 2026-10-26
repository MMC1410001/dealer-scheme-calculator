/**
 * Iframe token API (POST /api/v1/embed-token). Contract: docs/api-contract.md section 14, docs/openapi.json.
 * The SAP Commerce / SFA back end asks for a signed /embed URL for the logged-in dealer, so that it does not need
 * the shared secret (EMBED_SIGNING_SECRET) or its own HMAC code. Token format: src/lib/auth/embed-token.ts.
 *
 * Same pattern as src/server/api/dealer-status.ts: plain TypeScript with injected dependencies. The route file runs
 * the API pipeline first (503, per-IP 429, declared Content-Length 413).
 * Order: token (401 / 403) → per-client rate limit (429) → Content-Type (400), body size (413), JSON and fields (400)
 * → scheme tags (400) → signing secret (503) → 200.
 * Scope: schemes:read. A client that may read the status of any dealer may also open the iframe for any dealer.
 * The dealer is not looked up: the iframe shows "No scheme data" for an unknown dealer.
 */
import type { RateLimiterLike } from "@/server/ratelimit";
import { EMBED_TOKEN_MAX_TTL_SECONDS } from "@/lib/auth/embed-token";
import {
  API_DEALER_CODE_PATTERN,
  AUTH_OFF_CLIENT_KEY,
  ECHO_SAFE_TAG,
  MAX_BODY_BYTES,
  MAX_SCHEME_TAGS,
  SERVICE_BUSY_RETRY_AFTER,
  errorResult,
  isDatabaseBusy,
  unknownTagMessage,
  type ApiLogContext,
  type ApiResult,
  type AuthCheck,
  type StatusRequestInput,
} from "@/server/api/dealer-status";

export const EMBED_TOKEN_DEFAULT_TTL_SECONDS = 3600;
export const EMBED_TOKEN_MIN_TTL_SECONDS = 60;

/** 200 body of POST /api/v1/embed-token. */
export interface EmbedTokenResponse {
  token: string;
  /** Path and query of the iframe page. The host puts this host name in front of it. */
  embed_path: string;
  /** ISO 8601 (UTC). */
  expires_at: string;
}

export interface EmbedTokenRequest {
  dealerCode: string;
  /** Empty = all schemes of the dealer. */
  schemeTags: string[];
  ttlSeconds: number;
}

export interface EmbedTokenDeps {
  authenticate: (authorization: string | null) => Promise<AuthCheck>;
  limiter: RateLimiterLike | null;
  listActiveTags: () => Promise<string[]>;
  /** Signs the token (signEmbedToken). Throws EmbedTokenConfigError when the secret is not set. */
  sign: (dealerCode: string, ttlSeconds: number, nowSeconds: number) => string;
  /** Current time in unix seconds. Default: Date.now(). For tests. */
  nowSeconds?: () => number;
}

/** Validates the parsed JSON body. Unknown fields are ignored (same as the dealer status request). */
export function validateEmbedTokenRequest(body: unknown): { ok: true; value: EmbedTokenRequest } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.dealer_code !== "string") return { ok: false, message: "dealer_code is required and must be a string." };
  const dealerCode = b.dealer_code.trim();
  if (!API_DEALER_CODE_PATTERN.test(dealerCode)) {
    return { ok: false, message: "dealer_code must have 1 to 32 letters, digits, '_' or '-'." };
  }

  const schemeTags: string[] = [];
  if (b.scheme_tags !== undefined && b.scheme_tags !== null) {
    if (!Array.isArray(b.scheme_tags)) return { ok: false, message: "scheme_tags must be an array of strings." };
    if (b.scheme_tags.length > MAX_SCHEME_TAGS) {
      return { ok: false, message: `scheme_tags must have ${MAX_SCHEME_TAGS} items or fewer.` };
    }
    for (const t of b.scheme_tags) {
      if (typeof t !== "string" || !ECHO_SAFE_TAG.test(t.trim())) {
        return { ok: false, message: "Each item of scheme_tags must have 1 to 32 letters, digits, '_' or '-'." };
      }
      const tag = t.trim();
      if (schemeTags.includes(tag)) return { ok: false, message: `scheme_tags must be unique. ${tag} is in the list more than once.` };
      schemeTags.push(tag);
    }
  }

  let ttlSeconds = EMBED_TOKEN_DEFAULT_TTL_SECONDS;
  if (b.ttl_seconds !== undefined && b.ttl_seconds !== null) {
    if (
      typeof b.ttl_seconds !== "number" ||
      !Number.isInteger(b.ttl_seconds) ||
      b.ttl_seconds < EMBED_TOKEN_MIN_TTL_SECONDS ||
      b.ttl_seconds > EMBED_TOKEN_MAX_TTL_SECONDS
    ) {
      return {
        ok: false,
        message: `ttl_seconds must be an integer from ${EMBED_TOKEN_MIN_TTL_SECONDS} to ${EMBED_TOKEN_MAX_TTL_SECONDS}.`,
      };
    }
    ttlSeconds = b.ttl_seconds;
  }
  return { ok: true, value: { dealerCode, schemeTags, ttlSeconds } };
}

/** The /embed path for a token. The same query as the dev host page (src/app/dev/host/page.tsx). */
export function embedPath(token: string, schemeTags: string[]): string {
  const qs = new URLSearchParams({ token });
  if (schemeTags.length > 0) qs.set("tags", schemeTags.join(","));
  return `/embed?${qs.toString()}`;
}

/** Never throws. Same error handling as handleStatusRequest (500 INTERNAL_ERROR, 503 SERVICE_BUSY). */
export async function handleEmbedTokenRequest(input: StatusRequestInput, deps: EmbedTokenDeps): Promise<ApiResult> {
  const ctx: ApiLogContext = { clientId: null, tagCount: 0, dealerCode: null };
  try {
    return await handle(input, deps, ctx);
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const r = isDatabaseBusy(err)
      ? errorResult(503, "SERVICE_BUSY", "Service busy. Try again in a few seconds.", {
          ...ctx,
          headers: { "Retry-After": SERVICE_BUSY_RETRY_AFTER },
        })
      : errorResult(500, "INTERNAL_ERROR", "Internal error. Try again later.", ctx);
    return { ...r, log: { ...r.log, error: msg.slice(0, 300) } };
  }
}

async function handle(input: StatusRequestInput, deps: EmbedTokenDeps, ctx: ApiLogContext): Promise<ApiResult> {
  const auth = await deps.authenticate(input.authorization);
  if (!auth.ok) {
    return errorResult(auth.status, auth.code, auth.message, { headers: { "WWW-Authenticate": auth.wwwAuthenticate } });
  }
  const clientId = auth.clientId;
  ctx.clientId = clientId;

  if (deps.limiter) {
    const rl = await deps.limiter.take(clientId ?? AUTH_OFF_CLIENT_KEY);
    if (!rl.allowed) {
      return errorResult(429, "RATE_LIMITED", "Too many requests. Wait and try again.", {
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
        clientId,
      });
    }
  }

  const ct = input.contentType;
  if (!ct || ct.split(";")[0].trim().toLowerCase() !== "application/json") {
    return errorResult(400, "INVALID_REQUEST", "Content-Type must be application/json.", { clientId });
  }
  const read = await input.readBody();
  if (!read.ok) {
    return errorResult(413, "PAYLOAD_TOO_LARGE", `The request body must be ${MAX_BODY_BYTES} bytes or smaller.`, { clientId });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return errorResult(400, "INVALID_REQUEST", "The request body is not valid JSON.", { clientId });
  }
  const v = validateEmbedTokenRequest(parsed);
  if (!v.ok) return errorResult(400, "INVALID_REQUEST", v.message, { clientId });
  const { dealerCode, schemeTags, ttlSeconds } = v.value;
  ctx.tagCount = schemeTags.length;
  ctx.dealerCode = dealerCode;

  if (schemeTags.length > 0) {
    const active = new Set(await deps.listActiveTags());
    const unknown = schemeTags.find((t) => !active.has(t));
    if (unknown !== undefined) return errorResult(400, "UNKNOWN_SCHEME_TAG", unknownTagMessage(unknown), ctx);
  }

  const nowSeconds = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  let token: string;
  try {
    token = deps.sign(dealerCode, ttlSeconds, nowSeconds);
  } catch (err) {
    if (err instanceof Error && err.name === "EmbedTokenConfigError") {
      const r = errorResult(503, "API_DISABLED", "Iframe tokens are not enabled on this server.", ctx);
      return { ...r, log: { ...r.log, error: "EMBED_SIGNING_SECRET is not configured." } };
    }
    throw err;
  }
  const body: EmbedTokenResponse = {
    token,
    embed_path: embedPath(token, schemeTags),
    expires_at: new Date((nowSeconds + ttlSeconds) * 1000).toISOString(),
  };
  return { status: 200, body, headers: {}, log: { ...ctx, code: null } };
}
