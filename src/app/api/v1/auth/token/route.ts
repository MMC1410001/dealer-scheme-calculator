/**
 * Token endpoint: POST /api/v1/auth/token (OAuth2 client credentials). Server-to-server only. No CORS.
 * Contract: docs/api-contract.md section 3. Logic: src/lib/auth/token-endpoint.ts.
 * Per-IP limits (RATE_LIMIT_PER_SECOND and TOKEN_RATE_LIMIT_PER_MINUTE) run before the body is read.
 */
import { authEnabled } from "@/server/config";
import { handleTokenRequest, logTokenRequest, TOKEN_MAX_BODY_BYTES } from "@/lib/auth/token-endpoint";
import { jsonResponse, readBodyBytesLimited } from "@/server/api/http";
import { pipelineError, runApi, type RunOptions } from "@/server/api/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROUTE = "/api/v1/auth/token";
const ALLOW = "POST";
const OPTS: RunOptions = { route: ROUTE, limits: ["ip", "token"], envelope: "oauth", maxBodyBytes: TOKEN_MAX_BODY_BYTES };

export function POST(request: Request): Promise<Response> {
  return runApi(request, OPTS, async (ctx) => {
    const r = await handleTokenRequest(
      {
        authorization: request.headers.get("authorization"),
        contentType: request.headers.get("content-type"),
        readBody: () => readBodyBytesLimited(request, TOKEN_MAX_BODY_BYTES),
      },
      {
        enabled: authEnabled(ctx.cfg),
        clients: ctx.cfg.authClients,
        writeClients: ctx.cfg.authWriteClients,
        jwtSecret: ctx.cfg.jwtSecret,
        ttlSeconds: ctx.cfg.jwtTtlSeconds,
      },
    );
    logTokenRequest(r, ROUTE, ctx.requestId, performance.now() - ctx.started);
    return jsonResponse(r.status, r.body, ctx.requestId, r.headers);
  });
}

/** OPTIONS: 204 with Allow. No CORS headers. Same as the dealer status endpoint. */
export function OPTIONS(request: Request): Promise<Response> {
  return runApi(request, { ...OPTS, limits: ["ip"] }, (ctx) =>
    Promise.resolve(jsonResponse(204, null, ctx.requestId, { Allow: `${ALLOW}, OPTIONS` })),
  );
}

/** 405 for every other method, in the RFC 6749 error format. */
function notAllowed(request: Request): Promise<Response> {
  return runApi(request, { ...OPTS, limits: ["ip"] }, (ctx) =>
    Promise.resolve(pipelineError(OPTS, ctx, 405, "METHOD_NOT_ALLOWED", `Method not allowed. Use ${ALLOW}.`, { Allow: ALLOW })),
  );
}
export const GET = notAllowed;
export const HEAD = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
