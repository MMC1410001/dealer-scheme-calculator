/**
 * OpenAPI spec: GET /api/v1/openapi.json (docs/openapi.json). On only when DOCS_ENABLED. Otherwise JSON 404.
 * The QA ZAP scan reads this URL, so the QA server runs with DOCS_ENABLED=true.
 */
import { servedSpec } from "@/server/api/docs";
import { jsonResponse } from "@/server/api/http";
import { pipelineError, runApi, type RunOptions } from "@/server/api/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTS: RunOptions = { route: "/api/v1/openapi.json", limits: ["ip"], envelope: "api" };

export function GET(request: Request): Promise<Response> {
  return runApi(request, OPTS, (ctx) => {
    if (!ctx.cfg.docsEnabled) return Promise.resolve(pipelineError(OPTS, ctx, 404, "NOT_FOUND", "Not found."));
    return Promise.resolve(jsonResponse(200, servedSpec(), ctx.requestId));
  });
}
