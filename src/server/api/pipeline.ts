/**
 * The common start of every /api/* route handler (except the health probe), in place of a middleware chain.
 * The Next.js proxy does not run for /api (it would copy request bodies into memory), so each route handler
 * calls runApi. Order:
 * 1. Request ID and start time.
 * 2. Settings: when the startup rules refuse the settings (src/server/config.ts), 503 API_DISABLED.
 *    The server normally does not start in that case (src/instrumentation.ts). This is defence in depth.
 * 3. Rate limits by client IP (ip; token for the token endpoint), before authentication and before the body.
 * 4. Declared Content-Length above the limit: 413 PAYLOAD_TOO_LARGE, before authentication.
 * 5. The handler. An exception gives a generic 500 (no detail in the body).
 * Every response has the security headers and X-Request-Id. Each response that runApi makes writes one log line.
 */
import { randomUUID } from "node:crypto";
import { SCOPE, verifyBearer } from "@/lib/auth/jwt";
import { authEnabled, currentConfig, type ApiConfig } from "@/server/config";
import { clientIpKey, getLimiter } from "@/server/ratelimit";
import { MAX_BODY_BYTES, type AuthCheck } from "@/server/api/dealer-status";
import { declaredTooLarge, jsonResponse } from "@/server/api/http";

export type ErrorEnvelope = "api" | "oauth";

export interface ApiContext {
  requestId: string;
  started: number;
  cfg: ApiConfig;
}

export interface RunOptions {
  route: string;
  /** Limiters by client IP to apply, in order. */
  limits: ReadonlyArray<"ip" | "token">;
  /** Error body format: the API envelope {error:{code,message}}, or RFC 6749 {error, error_description}. */
  envelope: ErrorEnvelope;
  /** Check the declared Content-Length against this limit. */
  maxBodyBytes?: number;
}

const OAUTH_ERROR: Record<string, string> = {
  API_DISABLED: "temporarily_unavailable",
  RATE_LIMITED: "rate_limited",
  PAYLOAD_TOO_LARGE: "invalid_request",
  INTERNAL_ERROR: "server_error",
};

function errorBody(envelope: ErrorEnvelope, code: string, message: string): unknown {
  return envelope === "api" ? { error: { code, message } } : { error: OAUTH_ERROR[code] ?? "invalid_request", error_description: message };
}

function logLine(route: string, requestId: string, status: number, code: string, started: number, error?: string): void {
  const write = status >= 500 ? console.error : console.log;
  write(
    JSON.stringify({
      evt: "api_request",
      route,
      request_id: requestId,
      client_id: null,
      status,
      code,
      tags: 0,
      dealer_code: null,
      duration_ms: Math.round(performance.now() - started),
      ...(error !== undefined ? { error } : {}),
    }),
  );
}

/** An error response made by the pipeline (or a route) with one log line. */
export function pipelineError(
  opts: Pick<RunOptions, "route" | "envelope">,
  ctx: Pick<ApiContext, "requestId" | "started">,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
  error?: string,
): Response {
  logLine(opts.route, ctx.requestId, status, code, ctx.started, error);
  const extra = opts.envelope === "oauth" ? { Pragma: "no-cache", ...headers } : headers;
  return jsonResponse(status, errorBody(opts.envelope, code, message), ctx.requestId, extra);
}

export async function runApi(request: Request, opts: RunOptions, handler: (ctx: ApiContext) => Promise<Response>): Promise<Response> {
  const requestId = randomUUID();
  const started = performance.now();
  const base = { requestId, started };
  try {
    const { cfg, decision } = currentConfig();
    if (decision.action === "refuse") {
      return pipelineError(opts, base, 503, "API_DISABLED", "The API is not enabled on this server.");
    }
    const ip = clientIpKey(request.headers, cfg);
    for (const name of opts.limits) {
      const limiter = getLimiter(name, cfg);
      if (!limiter) continue;
      const r = await limiter.take(ip);
      if (!r.allowed) {
        return pipelineError(opts, base, 429, "RATE_LIMITED", "Too many requests. Wait and try again.", {
          "Retry-After": String(r.retryAfterSeconds),
        });
      }
    }
    if (opts.maxBodyBytes !== undefined && declaredTooLarge(request, opts.maxBodyBytes)) {
      return pipelineError(opts, base, 413, "PAYLOAD_TOO_LARGE", `The request body must be ${opts.maxBodyBytes} bytes or smaller.`);
    }
    return await handler({ requestId, started, cfg });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return pipelineError(opts, base, 500, "INTERNAL_ERROR", "Internal error. Try again later.", {}, msg.slice(0, 300));
  }
}

/**
 * The token check of a data endpoint for these settings, with the scope that the endpoint needs.
 * Auth off: every caller passes with clientId null.
 */
export function bearerAuthenticator(cfg: ApiConfig, scope: string = SCOPE): (authorization: string | null) => Promise<AuthCheck> {
  if (!authEnabled(cfg)) return () => Promise.resolve({ ok: true, clientId: null });
  const settings = {
    secret: cfg.jwtSecret!,
    previousSecret: cfg.jwtPreviousSecret,
    ttlSeconds: cfg.jwtTtlSeconds,
    clients: cfg.authClients,
    writeClients: cfg.authWriteClients,
  };
  return (authorization) => verifyBearer(authorization, settings, undefined, scope);
}

export { MAX_BODY_BYTES };
