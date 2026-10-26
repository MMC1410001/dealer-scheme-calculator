/**
 * Reward choice API: POST /api/v1/dealer-reward-choice (SAP / SFA send the dealer's gift / CN choice).
 * Server-to-server only. No CORS. Token scope: choices:write (AUTH_WRITE_CLIENTS).
 * Contract: docs/api-contract.md section 13 and docs/openapi.json. Logic: src/server/api/reward-choice.ts.
 * The pipeline (src/server/api/pipeline.ts) runs first: settings (503), per-IP limit (429), Content-Length (413).
 */
import { getDb } from "@/db/client";
import { WRITE_SCOPE } from "@/lib/auth/jwt";
import { MAX_BODY_BYTES } from "@/server/api/dealer-status";
import { jsonResponse, logApiRequest, methodNotAllowed, readBodyLimited, toResponse } from "@/server/api/http";
import { bearerAuthenticator, runApi, type RunOptions } from "@/server/api/pipeline";
import { handleChoiceRequest } from "@/server/api/reward-choice";
import { getLimiter } from "@/server/ratelimit";
import { saveRewardChoices } from "@/server/reward-choice-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/dealer-reward-choice";
const ALLOW = "POST";
const OPTS: RunOptions = { route: ROUTE, limits: ["ip"], envelope: "api", maxBodyBytes: MAX_BODY_BYTES };

export function POST(request: Request): Promise<Response> {
  return runApi(request, OPTS, async (ctx) => {
    const result = await handleChoiceRequest(
      {
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type"),
        readBody: () => readBodyLimited(request),
      },
      {
        authenticate: bearerAuthenticator(ctx.cfg, WRITE_SCOPE),
        limiter: getLimiter("client", ctx.cfg),
        save: async (input, actor) => (await saveRewardChoices(getDb(), [input], { source: "API", actor }))[0],
      },
    );
    logApiRequest({ route: ROUTE, requestId: ctx.requestId, status: result.status, durationMs: performance.now() - ctx.started, result });
    return toResponse(result, ctx.requestId);
  });
}

/** OPTIONS: 204 with Allow and X-Request-Id. No CORS headers. */
export function OPTIONS(request: Request): Promise<Response> {
  return runApi(request, OPTS, (ctx) => {
    const log = { clientId: null, code: null, tagCount: 0, dealerCode: null };
    logApiRequest({ route: ROUTE, requestId: ctx.requestId, status: 204, durationMs: 0, result: { log } });
    return Promise.resolve(jsonResponse(204, null, ctx.requestId, { Allow: `${ALLOW}, OPTIONS` }));
  });
}

/** 405 METHOD_NOT_ALLOWED for every method except POST and OPTIONS. */
function notAllowed(request: Request): Promise<Response> {
  return runApi(request, OPTS, (ctx) => {
    const result = methodNotAllowed(ALLOW);
    logApiRequest({ route: ROUTE, requestId: ctx.requestId, status: result.status, durationMs: 0, result });
    return Promise.resolve(toResponse(result, ctx.requestId));
  });
}
export const GET = notAllowed;
export const HEAD = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
