/**
 * Next.js 16 proxy (formerly middleware). Runs on the Node.js runtime by default.
 *
 * - /embed: CSP frame-ancestors 'self' + EMBED_ALLOWED_ORIGINS (never "*").
 * - every other route: frame-ancestors 'none' + X-Frame-Options DENY.
 * - /admin/** except /admin/login: redirect to the login page when the session cookie is missing or not valid, and
 *   to the first page of the role when the role may not open the path (role CHOICES: dealers and reward choices).
 * - /api/**: the proxy does NOT run (see the matcher). When a proxy runs, Next.js copies the request body into
 *   memory (up to experimental.proxyClientMaxBodySize, 10 MB) before the route can reject it. The route handlers
 *   check the API key and the 8 KB body limit themselves. next.config.ts headers() sets the framing, nosniff and
 *   Referrer-Policy headers for /api/:path*. The route handlers set no-store. No CORS headers.
 * - Security headers on all other routes. Cache-Control no-store for /embed and /admin.
 */
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionValue } from "@/lib/auth/admin-session";
import { adminHomeFor, canAccessAdminPath } from "@/lib/auth/admin-users";
import { DENY_FRAMING_CSP, embedCsp, parseAllowedOrigins } from "@/lib/auth/frame-policy";

let cachedOriginsRaw: string | undefined;
let cachedEmbedCsp = embedCsp([]);

function currentEmbedCsp(): string {
  const raw = process.env.EMBED_ALLOWED_ORIGINS ?? "";
  if (raw !== cachedOriginsRaw) {
    const { origins, rejected } = parseAllowedOrigins(raw);
    if (rejected.length > 0) {
      console.warn(`[proxy] EMBED_ALLOWED_ORIGINS: ignored ${rejected.length} value(s) that are not valid origins.`);
    }
    cachedOriginsRaw = raw;
    cachedEmbedCsp = embedCsp(origins);
  }
  return cachedEmbedCsp;
}

function isPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function applyHeaders(res: NextResponse, pathname: string): NextResponse {
  const h = res.headers;
  if (isPath(pathname, "/embed")) {
    h.set("Content-Security-Policy", currentEmbedCsp());
    // X-Frame-Options cannot list several origins. CSP frame-ancestors controls framing for /embed.
    h.delete("X-Frame-Options");
  } else {
    h.set("Content-Security-Policy", DENY_FRAMING_CSP);
    // A fixed value, not user input (Semgrep false positive, reviewed in qa/TEST_RESULTS.md).
    h.set("X-Frame-Options", "DENY"); // nosemgrep: javascript.express.security.x-frame-options-misconfiguration.x-frame-options-misconfiguration
  }
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (isPath(pathname, "/embed") || isPath(pathname, "/admin")) {
    h.set("Cache-Control", "no-store");
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPath(pathname, "/admin") && !isPath(pathname, "/admin/login")) {
    const session = await verifyAdminSessionValue(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
    if (!session) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin/login";
      url.search = "";
      if (request.method === "GET") url.searchParams.set("next", `${pathname}${search}`);
      // 303 for POST (Server Actions), so that the browser follows with GET.
      const res = NextResponse.redirect(url, request.method === "GET" ? 307 : 303);
      return applyHeaders(res, pathname);
    }
    if (!canAccessAdminPath(session.role, pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = adminHomeFor(session.role);
      url.search = "";
      return applyHeaders(NextResponse.redirect(url, request.method === "GET" ? 307 : 303), pathname);
    }
  }

  return applyHeaders(NextResponse.next(), pathname);
}

export const config = {
  // "/api" and "/api/..." are excluded: the proxy must not buffer API request bodies (see the comment at the top),
  // and /api gets the API headers of its route handler, not the page headers (QA-3). "/apix" still runs the proxy.
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
