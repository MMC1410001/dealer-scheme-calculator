/**
 * Dealer status API (POST /api/v1/dealer-scheme-status). Contract: docs/api-contract.md, docs/openapi.json.
 *
 * handleStatusRequest is plain TypeScript with injected dependencies, so that tests do not need a server,
 * a database or Redis. The route file (src/app/api/v1/dealer-scheme-status/route.ts) connects it to Next.js
 * through the API pipeline (src/server/api/pipeline.ts), which runs first: settings (503), per-IP rate limit
 * (429) and declared Content-Length (413).
 *
 * Order of checks here: token (401 / 403) → per-client rate limit (429) → Content-Type (400), streamed body
 * size (413), JSON and fields (400) → response cache (when on) → scheme tags (400) → dealer (404) → 200.
 * The API reads stored results only (getDealerStatus). No new calculation.
 */
import type { RateLimiterLike } from "@/server/ratelimit";
import type { CacheEntry, CacheState, ResponseCache } from "@/server/cache";
import type { DealerStatus, RewardChoice, SchemeStatus } from "@/engine/types";
import type { EmbedTokenResponse } from "@/server/api/embed-token";

/** 200 body of POST /api/v1/dealer-reward-choice. */
export interface RewardChoiceResponse {
  /** The code the choice is stored under: the parent code for a child dealer. */
  dealer_code: string;
  scheme_tag: string;
  /** False when the same choice was already saved (nothing written). */
  changed: boolean;
  reward_choice: RewardChoice;
}

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_SCHEME_TAGS = 10;
export const MAX_TAG_LENGTH = 32;
/** Same rule as the iframe token: letters, digits, "_" and "-", 1 to 32 characters. */
export const API_DEALER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export type ApiErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_SCHEME_TAG"
  | "DEALER_NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "METHOD_NOT_ALLOWED"
  | "API_DISABLED"
  | "INTERNAL_ERROR"
  | "INSUFFICIENT_SCOPE"
  | "PAYLOAD_TOO_LARGE"
  | "SERVICE_BUSY"
  | "NOT_FOUND"
  | "CHOICE_NOT_ALLOWED";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}

export interface ApiResult {
  status: number;
  /** DealerStatus (this endpoint), the reward choice or iframe token result (src/server/api/), or an error. */
  body: DealerStatus | RewardChoiceResponse | EmbedTokenResponse | ApiErrorBody | null;
  /** JSON text to send as is (a cached answer). When set, `body` is null. */
  rawBody?: string;
  headers: Record<string, string>;
  /** For the log line only. Never sent. */
  log: ApiLogContext & { code: ApiErrorCode | null; error?: string };
  /** X-Cache value when the response cache is on and the request reached it. */
  cache?: CacheState;
}

/** What the log line knows about the request. handle() fills it in step by step, so that a 500 keeps it. */
export interface ApiLogContext {
  clientId: string | null;
  tagCount: number;
  dealerCode: string | null;
}

export type BodyRead = { ok: true; text: string } | { ok: false; reason: "TOO_LARGE" };

export interface StatusRequestInput {
  authorization: string | null;
  contentType: string | null;
  /** Reads the body (at most MAX_BODY_BYTES). Called only after the token and the rate limit pass. */
  readBody: () => Promise<BodyRead>;
}

/** Result of the token check. clientId is null when auth is off (APP_ENV=local with no auth settings). */
export type AuthCheck =
  | { ok: true; clientId: string | null }
  | { ok: false; status: 401 | 403; code: "UNAUTHORIZED" | "INSUFFICIENT_SCOPE"; message: string; wwwAuthenticate: string };

export interface StatusRequestDeps {
  authenticate: (authorization: string | null) => Promise<AuthCheck>;
  /** Per-client limiter (API_RATE_LIMIT_PER_MINUTE). Null when rate limits are off. */
  limiter: RateLimiterLike | null;
  listActiveTags: () => Promise<string[]>;
  getDealerStatus: (dealerCode: string, schemeTags: string[]) => Promise<DealerStatus | null>;
  /** Response cache. Null or missing when the cache is off. */
  cache?: ResponseCache | null;
}

/** Limiter key when auth is off: all callers share one bucket. */
export const AUTH_OFF_CLIENT_KEY = "auth-off";

export interface StatusRequest {
  dealer_code: string;
  scheme_tags: string[];
}

export function errorResult(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: { headers?: Record<string, string>; clientId?: string | null; tagCount?: number; dealerCode?: string | null } = {},
): ApiResult {
  return {
    status,
    body: { error: { code, message } },
    headers: extra.headers ?? {},
    log: { clientId: extra.clientId ?? null, code, tagCount: extra.tagCount ?? 0, dealerCode: extra.dealerCode ?? null },
  };
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Validates the parsed JSON body. Returns the request, or an error message for INVALID_REQUEST. */
export function validateStatusRequest(body: unknown): { ok: true; value: StatusRequest } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.dealer_code !== "string") return { ok: false, message: "dealer_code is required and must be a string." };
  const dealerCode = b.dealer_code.trim();
  if (!dealerCode) return { ok: false, message: "dealer_code must not be empty." };
  if (dealerCode.length > 32) return { ok: false, message: "dealer_code must have 32 characters or fewer." };
  if (!API_DEALER_CODE_PATTERN.test(dealerCode)) {
    return { ok: false, message: "dealer_code can contain only letters, digits, '_' and '-'." };
  }

  if (!Array.isArray(b.scheme_tags)) return { ok: false, message: "scheme_tags is required and must be an array of strings." };
  if (b.scheme_tags.length < 1) return { ok: false, message: "scheme_tags must have at least 1 item." };
  if (b.scheme_tags.length > MAX_SCHEME_TAGS) {
    return { ok: false, message: `scheme_tags must have ${MAX_SCHEME_TAGS} items or fewer.` };
  }
  const tags: string[] = [];
  for (const t of b.scheme_tags) {
    if (typeof t !== "string") return { ok: false, message: "Each item of scheme_tags must be a string." };
    const tag = t.trim();
    if (!tag) return { ok: false, message: "Each item of scheme_tags must be a non-empty string." };
    if (tag.length > MAX_TAG_LENGTH || CONTROL_CHARS.test(tag)) {
      return { ok: false, message: `Each item of scheme_tags must have ${MAX_TAG_LENGTH} characters or fewer, with no control characters.` };
    }
    if (tags.includes(tag)) return { ok: false, message: `scheme_tags must be unique. ${tag} is in the list more than once.` };
    tags.push(tag);
  }
  return { ok: true, value: { dealer_code: dealerCode, scheme_tags: tags } };
}

function isJsonContentType(ct: string | null): boolean {
  if (!ct) return false;
  return ct.split(";")[0].trim().toLowerCase() === "application/json";
}

/** Puts the schemes in the order of the requested tags (getDealerStatus keeps this order; this makes it certain). */
function inRequestOrder(status: DealerStatus, tags: string[]): DealerStatus {
  const byTag = new Map<string, SchemeStatus>(status.schemes.map((s) => [s.scheme_tag, s]));
  const ordered = tags.map((t) => byTag.get(t)).filter((s): s is SchemeStatus => s !== undefined);
  return ordered.length === status.schemes.length ? { ...status, schemes: ordered } : status;
}

/** True for "no free database connection" errors (pg Pool connectionTimeoutMillis, database not reachable). */
export function isDatabaseBusy(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 5; depth++) {
    const x = e as { message?: unknown; code?: unknown; cause?: unknown };
    const msg = typeof x.message === "string" ? x.message : "";
    if (
      msg.includes("timeout exceeded when trying to connect") ||
      msg.includes("Connection terminated due to connection timeout") ||
      x.code === "ECONNREFUSED"
    ) {
      return true;
    }
    e = x.cause;
  }
  return false;
}

export const SERVICE_BUSY_RETRY_AFTER = "2";

/**
 * Never throws. An unexpected error gives 500 INTERNAL_ERROR with no detail in the body.
 * No free database connection gives 503 SERVICE_BUSY with Retry-After: 2.
 * The detail goes to result.log.error, so that the route writes it on the same log line as the request ID.
 */
export async function handleStatusRequest(input: StatusRequestInput, deps: StatusRequestDeps): Promise<ApiResult> {
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

/** Answers that may be cached: they are fixed for one data version. */
function cacheable(status: number, code: ApiErrorCode | null): boolean {
  return status === 200 || code === "DEALER_NOT_FOUND" || code === "UNKNOWN_SCHEME_TAG";
}

/** A tag that the error message may name. Any other text is not repeated (QA-2: never echo arbitrary input). */
export const ECHO_SAFE_TAG = /^[A-Za-z0-9_-]{1,32}$/;

/** Message of 400 UNKNOWN_SCHEME_TAG: names the tag only when it matches ECHO_SAFE_TAG. */
export function unknownTagMessage(tag: string): string {
  return ECHO_SAFE_TAG.test(tag) ? `Scheme tag ${tag} does not exist.` : "A scheme tag does not exist.";
}

async function lookup(tags: string[], dealerCode: string, deps: StatusRequestDeps, ctx: ApiLogContext): Promise<ApiResult> {
  const active = new Set(await deps.listActiveTags());
  const unknown = tags.find((t) => !active.has(t));
  if (unknown !== undefined) {
    return errorResult(400, "UNKNOWN_SCHEME_TAG", unknownTagMessage(unknown), ctx);
  }
  const status = await deps.getDealerStatus(dealerCode, tags);
  if (!status) return errorResult(404, "DEALER_NOT_FOUND", `Dealer ${dealerCode} does not exist.`, ctx);
  return { status: 200, body: inRequestOrder(status, tags), headers: {}, log: { ...ctx, code: null } };
}

async function handle(input: StatusRequestInput, deps: StatusRequestDeps, ctx: ApiLogContext): Promise<ApiResult> {
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

  if (!isJsonContentType(input.contentType)) {
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
  const v = validateStatusRequest(parsed);
  if (!v.ok) return errorResult(400, "INVALID_REQUEST", v.message, { clientId });
  const { dealer_code: dealerCode, scheme_tags: tags } = v.value;
  ctx.tagCount = tags.length;
  ctx.dealerCode = dealerCode;

  if (!deps.cache) return lookup(tags, dealerCode, deps, ctx);

  // The key keeps the tag order, because the response keeps it.
  const key = `dss:${dealerCode}:${JSON.stringify(tags)}`;
  const { entry, state } = await deps.cache.getOrBuild(key, async () => {
    const r = await lookup(tags, dealerCode, deps, ctx);
    const e: CacheEntry = { status: r.status, code: r.log.code, body: JSON.stringify(r.body) };
    return { entry: e, cacheable: cacheable(r.status, r.log.code) };
  });
  return {
    status: entry.status,
    body: null,
    rawBody: entry.body,
    headers: { "X-Cache": state },
    log: { ...ctx, code: entry.code as ApiErrorCode | null },
    cache: state,
  };
}
