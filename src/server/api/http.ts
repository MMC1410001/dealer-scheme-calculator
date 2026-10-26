/**
 * HTTP helpers for the API route handlers (Web Request / Response, no Next.js dependency).
 */
import { MAX_BODY_BYTES, errorResult, type ApiResult, type BodyRead } from "@/server/api/dealer-status";

/** Content-Security-Policy of every API response except the Swagger UI page (/api/docs). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/**
 * Security headers on every API response, errors included (same set as the reference Other Scheme API).
 * next.config.ts headers() sets the same values for /api/:path* as a second layer (a test checks that they are
 * equal). The Next.js 308 trailing-slash redirect has none of them (known gap, see next.config.ts).
 * The API is server-to-server: no CORS headers, so a browser on another origin cannot read it.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cache-Control": "no-store",
  "Content-Security-Policy": API_CSP,
};

export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

export function securityHeaders(extra: Record<string, string> = {}): Headers {
  const h = new Headers(API_SECURITY_HEADERS);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

/** A JSON response with the security headers and X-Request-Id. */
export function jsonResponse(status: number, body: unknown, requestId: string | null, extra: Record<string, string> = {}): Response {
  const h = securityHeaders(body === null ? extra : { "Content-Type": JSON_CONTENT_TYPE, ...extra });
  if (requestId) h.set("X-Request-Id", requestId);
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: h });
}

/** True when the declared Content-Length is above the limit (checked before any read). */
export function declaredTooLarge(request: Request, max: number = MAX_BODY_BYTES): boolean {
  const raw = request.headers.get("content-length");
  if (raw === null) return false;
  if (!/^\d+$/.test(raw.trim())) return true;
  return Number(raw) > max;
}

export type BytesRead = { ok: true; bytes: Uint8Array } | { ok: false; reason: "TOO_LARGE" };

/**
 * Reads the request body as bytes, at most `max` bytes. A Content-Length above the limit is rejected before
 * any read. A streamed (chunked) body stops at the limit.
 */
export async function readBodyBytesLimited(request: Request, max: number = MAX_BODY_BYTES): Promise<BytesRead> {
  if (declaredTooLarge(request, max)) return { ok: false, reason: "TOO_LARGE" };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, reason: "TOO_LARGE" };
    }
    chunks.push(value);
  }
  return { ok: true, bytes: Buffer.concat(chunks) };
}

/** Reads the request body as UTF-8 text, at most `max` bytes (see readBodyBytesLimited). */
export async function readBodyLimited(request: Request, max: number = MAX_BODY_BYTES): Promise<BodyRead> {
  const r = await readBodyBytesLimited(request, max);
  return r.ok ? { ok: true, text: Buffer.from(r.bytes).toString("utf8") } : r;
}

export function toResponse(result: ApiResult, requestId: string): Response {
  const headers = securityHeaders({ "Content-Type": JSON_CONTENT_TYPE });
  headers.set("X-Request-Id", requestId);
  for (const [k, v] of Object.entries(result.headers)) headers.set(k, v);
  const body = result.rawBody ?? JSON.stringify(result.body);
  return new Response(body, { status: result.status, headers });
}

/** 405 for every method except POST (and OPTIONS). The route sends it with toResponse, so it has X-Request-Id. */
export function methodNotAllowed(allow: string): ApiResult {
  return errorResult(405, "METHOD_NOT_ALLOWED", `Method not allowed. Use ${allow}.`, { headers: { Allow: allow } });
}

/**
 * One structured log line for each API request. No key, no token, no request body, no dealer data beyond the code.
 * For a 500, the line also has the error detail (`error`), so that support can find it by the request ID.
 * A 5xx line goes to stderr. All other lines go to stdout.
 */
export function logApiRequest(entry: {
  route: string;
  requestId: string;
  status: number;
  durationMs: number;
  result: Pick<ApiResult, "log">;
  cache?: string | null;
}): void {
  const write = entry.status >= 500 ? console.error : console.log;
  write(
    JSON.stringify({
      evt: "api_request",
      route: entry.route,
      request_id: entry.requestId,
      client_id: entry.result.log.clientId,
      status: entry.status,
      code: entry.result.log.code,
      tags: entry.result.log.tagCount,
      dealer_code: entry.result.log.dealerCode,
      duration_ms: Math.round(entry.durationMs),
      ...(entry.cache ? { cache: entry.cache } : {}),
      ...(entry.result.log.error !== undefined ? { error: entry.result.log.error } : {}),
    }),
  );
}
