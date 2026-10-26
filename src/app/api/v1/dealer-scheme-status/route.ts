/**
 * Dealer status API: POST /api/v1/dealer-scheme-status (second option, CLAUDE.md section 1).
 * Server-to-server only (SAP Commerce / SFA back end). No CORS. The browser path is the iframe (/embed).
 * Contract: docs/api-contract.md and docs/openapi.json. Logic: src/server/api/dealer-status.ts.
 * The pipeline (src/server/api/pipeline.ts) runs first: settings (503), per-IP limit (429), Content-Length (413).
 */
import { handleStatusRequest, MAX_BODY_BYTES } from "@/server/api/dealer-status";
import { jsonResponse, logApiRequest, methodNotAllowed, readBodyLimited, toResponse } from "@/server/api/http";
import { bearerAuthenticator, runApi, type RunOptions } from "@/server/api/pipeline";
import { getResponseCache } from "@/server/cache";
import { getLimiter } from "@/server/ratelimit";
import { getDealerStatus, listActiveSchemeTags } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/dealer-scheme-status";
const ALLOW = "POST";
const OPTS: RunOptions = { route: ROUTE, limits: ["ip"], envelope: "api", maxBodyBytes: MAX_BODY_BYTES };

export function POST(request: Request): Promise<Response> {
  return runApi(request, OPTS, async (ctx) => {
    const result = await handleStatusRequest(
      {
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type"),
        readBody: () => readBodyLimited(request),
      },
      {
        authenticate: bearerAuthenticator(ctx.cfg),
        limiter: getLimiter("client", ctx.cfg),
        listActiveTags: listActiveSchemeTags,
        getDealerStatus: (code, tags) => getDealerStatus(code, tags),
        cache: getResponseCache(ctx.cfg),
      },
    );
    logApiRequest({
      route: ROUTE,
      requestId: ctx.requestId,
      status: result.status,
      durationMs: performance.now() - ctx.started,
      result,
      cache: result.cache,
    });
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

/** 405 METHOD_NOT_ALLOWED for every method except POST and OPTIONS. Has X-Request-Id and one log line. */
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
