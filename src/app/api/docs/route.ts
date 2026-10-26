/**
 * Swagger UI: GET /api/docs. On only when DOCS_ENABLED (default: only with APP_ENV=local). Otherwise JSON 404.
 * Pinned swagger-ui-dist release with SRI and a strict CSP (src/server/api/docs.ts).
 */
import { DOCS_CSP, swaggerUiHtml } from "@/server/api/docs";
import { API_SECURITY_HEADERS } from "@/server/api/http";
import { pipelineError, runApi, type RunOptions } from "@/server/api/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTS: RunOptions = { route: "/api/docs", limits: ["ip"], envelope: "api" };

export function GET(request: Request): Promise<Response> {
  return runApi(request, OPTS, (ctx) => {
    if (!ctx.cfg.docsEnabled) return Promise.resolve(pipelineError(OPTS, ctx, 404, "NOT_FOUND", "Not found."));
    const headers = new Headers(API_SECURITY_HEADERS);
    headers.set("Content-Security-Policy", DOCS_CSP);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("X-Request-Id", ctx.requestId);
    return Promise.resolve(new Response(swaggerUiHtml(), { status: 200, headers }));
  });
}
