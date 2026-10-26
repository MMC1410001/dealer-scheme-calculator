/**
 * Reward choice API (POST /api/v1/dealer-reward-choice). Contract: docs/api-contract.md section 13, docs/openapi.json.
 * SAP / SFA send the dealer's choice (gift or CN, and the destination of the Star Points extra tickets).
 * The token needs the scope choices:write (AUTH_WRITE_CLIENTS).
 *
 * Same pattern as src/server/api/dealer-status.ts: plain TypeScript with injected dependencies. The route file runs
 * the API pipeline first (503, per-IP 429, declared Content-Length 413).
 * Order: token (401 / 403) → per-client rate limit (429) → Content-Type (400), body size (413), JSON and fields (400)
 * → save: scheme tag (400), dealer (404), dealer in a slab and destination (409) → 200.
 * The response is never cached. A change raises the cache data version (the dealer status shows the choice).
 */
import type { RateLimiterLike } from "@/server/ratelimit";
import type { RewardChoiceValue, TripDestination } from "@/engine/types";
import { CHOSEN_BY_PATTERN, REWARD_CHOICE_VALUES, TRIP_DESTINATIONS, type RewardChoiceInput } from "@/server/reward-choice";
import type { SaveOutcome } from "@/server/reward-choice-store";
import {
  API_DEALER_CODE_PATTERN,
  AUTH_OFF_CLIENT_KEY,
  ECHO_SAFE_TAG,
  MAX_BODY_BYTES,
  SERVICE_BUSY_RETRY_AFTER,
  errorResult,
  isDatabaseBusy,
  unknownTagMessage,
  type ApiLogContext,
  type ApiResult,
  type AuthCheck,
  type StatusRequestInput,
} from "@/server/api/dealer-status";

export interface ChoiceRequestDeps {
  authenticate: (authorization: string | null) => Promise<AuthCheck>;
  limiter: RateLimiterLike | null;
  /** actor: the client_id of the token (history on /admin/choices). */
  save: (input: RewardChoiceInput, actor: string | null) => Promise<SaveOutcome>;
}

/** Validates the parsed JSON body. Unknown fields are ignored (same as the dealer status request). */
export function validateChoiceRequest(body: unknown): { ok: true; value: RewardChoiceInput } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "The request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.dealer_code !== "string") return { ok: false, message: "dealer_code is required and must be a string." };
  const dealerCode = b.dealer_code.trim();
  if (!API_DEALER_CODE_PATTERN.test(dealerCode)) {
    return { ok: false, message: "dealer_code must have 1 to 32 letters, digits, '_' or '-'." };
  }
  if (typeof b.scheme_tag !== "string") return { ok: false, message: "scheme_tag is required and must be a string." };
  const schemeTag = b.scheme_tag.trim();
  if (!ECHO_SAFE_TAG.test(schemeTag)) return { ok: false, message: "scheme_tag must have 1 to 32 letters, digits, '_' or '-'." };
  if (typeof b.choice !== "string" || !(REWARD_CHOICE_VALUES as readonly string[]).includes(b.choice)) {
    return { ok: false, message: "choice is required and must be GIFT or CN." };
  }
  const destination = b.destination ?? null;
  if (destination !== null && (typeof destination !== "string" || !(TRIP_DESTINATIONS as readonly string[]).includes(destination))) {
    return { ok: false, message: "destination must be CRUISE, OVERSEAS or null." };
  }
  if (typeof b.chosen_by !== "string" || !CHOSEN_BY_PATTERN.test(b.chosen_by.trim())) {
    return { ok: false, message: "chosen_by is required: the user ID, 1 to 64 letters, digits, '.', '_', '@' or '-'." };
  }
  return {
    ok: true,
    value: {
      dealerCode,
      schemeTag,
      choice: b.choice as RewardChoiceValue,
      destination: destination as TripDestination | null,
      chosenBy: b.chosen_by.trim(),
    },
  };
}

/** Never throws. Same error handling as handleStatusRequest (500 INTERNAL_ERROR, 503 SERVICE_BUSY). */
export async function handleChoiceRequest(input: StatusRequestInput, deps: ChoiceRequestDeps): Promise<ApiResult> {
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

async function handle(input: StatusRequestInput, deps: ChoiceRequestDeps, ctx: ApiLogContext): Promise<ApiResult> {
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
  const v = validateChoiceRequest(parsed);
  if (!v.ok) return errorResult(400, "INVALID_REQUEST", v.message, { clientId });
  ctx.tagCount = 1;
  ctx.dealerCode = v.value.dealerCode;

  const r = await deps.save(v.value, clientId);
  if (!r.ok) {
    switch (r.code) {
      case "UNKNOWN_SCHEME_TAG":
        return errorResult(400, "UNKNOWN_SCHEME_TAG", unknownTagMessage(v.value.schemeTag), ctx);
      case "DEALER_NOT_FOUND":
        return errorResult(404, "DEALER_NOT_FOUND", `Dealer ${v.value.dealerCode} does not exist.`, ctx);
      default:
        return errorResult(409, "CHOICE_NOT_ALLOWED", r.message, ctx);
    }
  }
  return {
    status: 200,
    body: { dealer_code: r.dealerCode, scheme_tag: r.schemeTag, changed: r.changed, reward_choice: r.rewardChoice },
    headers: {},
    log: { ...ctx, code: null },
  };
}
