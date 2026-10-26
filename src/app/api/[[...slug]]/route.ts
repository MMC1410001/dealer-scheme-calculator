/**
 * Every /api/* path that has no route, and /api itself: JSON 404 NOT_FOUND for every method (Next.js would send
 * an HTML page). The optional catch-all [[...slug]] also matches /api with no segment (QA-3).
 * The per-IP rate limit applies, as on all API paths except the health probe.
 * A trailing slash (for example /api/ or /api/v1/health/) still gets the Next.js 308 redirect to the path without it.
 */
import { pipelineError, runApi, type RunOptions } from "@/server/api/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTS: RunOptions = { route: "/api/*", limits: ["ip"], envelope: "api" };

function notFound(request: Request): Promise<Response> {
  return runApi(request, OPTS, (ctx) => Promise.resolve(pipelineError(OPTS, ctx, 404, "NOT_FOUND", "Not found.")));
}

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
