/**
 * Health probe: GET and HEAD /api/v1/health. No authentication. No dealer data. Never rate limited.
 * 200 {status: "ok", data_as_of} when the database answers. 503 {status: "unavailable", data_as_of: null} when it does not.
 * This is a readiness probe (it checks the database). The reference Other Scheme API has a liveness probe only.
 * data_as_of is kept for 15 s in memory, so that frequent probes do not load the database.
 * HEAD gives the same status with no body (some load balancers probe with HEAD).
 */
import { jsonResponse } from "@/server/api/http";
import { getDataAsOf } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MS = 15_000;
let cached: { at: number; dataAsOf: string | null } | null = null;

async function probe(): Promise<{ status: number; body: { status: string; data_as_of: string | null } }> {
  const now = Date.now();
  try {
    if (!cached || now - cached.at > CACHE_MS) cached = { at: now, dataAsOf: await getDataAsOf() };
    return { status: 200, body: { status: "ok", data_as_of: cached.dataAsOf } };
  } catch (err) {
    cached = null;
    console.error(`[api] health: database check failed: ${err instanceof Error ? err.name : "Error"}`);
    return { status: 503, body: { status: "unavailable", data_as_of: null } };
  }
}

export async function GET(): Promise<Response> {
  const r = await probe();
  return jsonResponse(r.status, r.body, null);
}

export async function HEAD(): Promise<Response> {
  const r = await probe();
  return jsonResponse(r.status, null, null, { "Content-Type": "application/json; charset=utf-8" });
}
