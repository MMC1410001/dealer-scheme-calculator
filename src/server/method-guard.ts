/**
 * Guard for HTTP methods that the Next.js route handlers never see (QA-1 in qa/TEST_RESULTS.md).
 *
 * - TRACE: Next.js makes a Fetch `Request` for the route handler and for the proxy. The Fetch standard forbids
 *   TRACE, so Next.js fails before any app code runs: 500 text/plain and a stack trace in the server log.
 *   Route handlers, src/proxy.ts and next.config.ts cannot change this (checked on Next.js 16.4.2).
 * - Other methods that are not GET, HEAD, POST, PUT, PATCH, DELETE or OPTIONS (for example PROPFIND): Next.js
 *   gives 400 with an empty body on /api/* before the route runs.
 *   (TRACK and CONNECT never reach Next.js: Node.js refuses them.)
 *
 * installMethodGuard() wraps http.Server.prototype.emit("request"), so that the guard answers these requests
 * before Next.js: 405 METHOD_NOT_ALLOWED in the API envelope (404 NOT_FOUND for an /api path with no route),
 * with the API security headers and X-Request-Id, and one api_request log line. src/instrumentation.ts installs it
 * once for each server process. All other requests go to Next.js with no change.
 * The reverse proxy in front of the app should also refuse TRACE (defence in depth, docs/api-contract.md 10).
 * No Next.js dependency.
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { API_SECURITY_HEADERS, JSON_CONTENT_TYPE } from "@/server/api/http";

/** Methods that Next.js passes to the route handlers. */
const ROUTE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** Allow header of the API routes (same values as their own 405 answers). */
const API_ALLOW: Readonly<Record<string, string>> = {
  "/api/v1/dealer-scheme-status": "POST",
  "/api/v1/auth/token": "POST",
  "/api/v1/health": "GET, HEAD",
  "/api/v1/openapi.json": "GET, HEAD",
  "/api/docs": "GET, HEAD",
};

function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function isApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

/** True when the guard must answer this request (Next.js cannot give a clean answer). */
export function isRefusedMethod(method: string | undefined, url: string | undefined): boolean {
  const m = method ?? "GET";
  if (m === "TRACE") return true;
  return !ROUTE_METHODS.has(m) && isApiPath(pathOf(url));
}

export interface GuardAnswer {
  status: 404 | 405;
  code: "NOT_FOUND" | "METHOD_NOT_ALLOWED";
  message: string;
  allow: string | null;
  route: string;
}

/** The answer for a refused request. An /api path with no route keeps its 404 NOT_FOUND (as for every method). */
export function guardAnswer(url: string | undefined): GuardAnswer {
  const path = pathOf(url);
  const allow = API_ALLOW[path];
  if (allow) {
    const message = allow === "POST" ? "Method not allowed. Use POST." : "Method not allowed.";
    return { status: 405, code: "METHOD_NOT_ALLOWED", message, allow, route: path };
  }
  if (isApiPath(path)) return { status: 404, code: "NOT_FOUND", message: "Not found.", allow: null, route: "/api/*" };
  return { status: 405, code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", allow: "GET, HEAD", route: "(page)" };
}

/** Writes the guard answer: JSON envelope, security headers, X-Request-Id and one log line. */
export function writeGuardAnswer(req: http.IncomingMessage, res: http.ServerResponse): void {
  const started = performance.now();
  const a = guardAnswer(req.url);
  const requestId = randomUUID();
  const body = JSON.stringify({ error: { code: a.code, message: a.message } });
  res.statusCode = a.status;
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader("Content-Type", JSON_CONTENT_TYPE);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.setHeader("X-Request-Id", requestId);
  if (a.allow) res.setHeader("Allow", a.allow);
  res.end(body);
  console.log(
    JSON.stringify({
      evt: "api_request",
      route: a.route,
      request_id: requestId,
      client_id: null,
      status: a.status,
      code: a.code,
      method: (req.method ?? "").slice(0, 16),
      tags: 0,
      dealer_code: null,
      duration_ms: Math.round(performance.now() - started),
    }),
  );
}

const g = globalThis as unknown as { __schemeMethodGuard?: () => void };

/**
 * Installs the guard on http.Server.prototype (all HTTP servers of this process, also one that already listens).
 * Installs only one time for each process. Returns a function that removes the guard (tests).
 */
export function installMethodGuard(): () => void {
  if (g.__schemeMethodGuard) return g.__schemeMethodGuard;
  const proto = http.Server.prototype;
  const hadOwn = Object.prototype.hasOwnProperty.call(proto, "emit");
  const original = proto.emit;
  const guarded = function (this: http.Server, event: string | symbol, ...args: unknown[]): boolean {
    if (event === "request") {
      const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
      if (isRefusedMethod(req.method, req.url)) {
        writeGuardAnswer(req, res);
        return true;
      }
    }
    return Reflect.apply(original, this, [event, ...args]) as boolean;
  };
  proto.emit = guarded as typeof proto.emit;
  const uninstall = (): void => {
    if (proto.emit === (guarded as typeof proto.emit)) {
      if (hadOwn) proto.emit = original;
      else delete (proto as { emit?: unknown }).emit;
    }
    delete g.__schemeMethodGuard;
  };
  g.__schemeMethodGuard = uninstall;
  return uninstall;
}
