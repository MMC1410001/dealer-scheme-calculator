import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "@/proxy";
import nextConfig from "../../../next.config";
import { API_CSP, API_SECURITY_HEADERS } from "@/server/api/http";
import { ADMIN_SESSION_COOKIE, createAdminSessionValue } from "./admin-session";

const secret = "p".repeat(40);
const saved = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = secret;
  process.env.ADMIN_USERNAME = "admin";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.EMBED_ALLOWED_ORIGINS = "https://dms.example.com";
});
afterEach(() => {
  process.env = { ...saved };
});

function req(path: string, init?: { cookie?: string; method?: string }) {
  const headers = new Headers();
  if (init?.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers, method: init?.method ?? "GET" });
}

describe("proxy", () => {
  it("lets configured origins frame /embed, with no-store", async () => {
    const res = await proxy(req("/embed?token=x"));
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://dms.example.com");
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("denies framing on other routes", async () => {
    const res = await proxy(req("/"));
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("does not treat /embedded as /embed", async () => {
    const res = await proxy(req("/embedded"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("redirects admin pages without a valid session", async () => {
    const res = await proxy(req("/admin/runs"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/admin/login?next=%2Fadmin%2Fruns");
    expect(res.headers.get("x-frame-options")).toBe("DENY");

    const bad = await proxy(req("/admin", { cookie: `${ADMIN_SESSION_COOKIE}=forged.value` }));
    expect(bad.status).toBe(307);

    const post = await proxy(req("/admin", { method: "POST" }));
    expect(post.status).toBe(303);
  });

  it("does not run for /api/** (Next.js must not buffer API request bodies), but runs for other routes", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ["/api", "/api/v1/dealer-scheme-status", "/api/v1/health", "/api/x"]) expect(re.test(p)).toBe(false);
    for (const p of ["/", "/embed", "/admin", "/admin/login", "/apix", "/apidocs"]) expect(re.test(p)).toBe(true);
  });

  it("sets the same API security headers in next.config.ts headers() as the route handlers (API_SECURITY_HEADERS)", async () => {
    const rules = await nextConfig.headers!();
    const lower = (hs: Array<{ key: string; value: string }> | undefined) =>
      Object.fromEntries((hs ?? []).map((x) => [x.key.toLowerCase(), x.value]));
    const all = lower(rules.find((r) => r.source === "/api/:path*")?.headers);
    const csp = lower(rules.find((r) => r.source === "/api/:path((?!docs$).*)")?.headers);
    const expected = Object.fromEntries(Object.entries(API_SECURITY_HEADERS).map(([k, v]) => [k.toLowerCase(), v]));
    const { "content-security-policy": apiCsp, ...rest } = expected;
    expect(all).toEqual(rest);
    expect(csp).toEqual({ "content-security-policy": apiCsp });
    expect(apiCsp).toBe(API_CSP);
    expect(all["access-control-allow-origin"]).toBeUndefined();
  });

  it("excludes only /api/docs from the API CSP rule (the Swagger UI page sets its own CSP)", () => {
    const re = /^\/api\/((?!docs$).*)$/;
    for (const p of ["/api/v1/dealer-scheme-status", "/api/v1/health", "/api/v1/openapi.json", "/api/docsx", "/api/x/docs"]) {
      expect(re.test(p)).toBe(true);
    }
    expect(re.test("/api/docs")).toBe(false);
  });

  it("lets the login page and valid sessions through", async () => {
    const login = await proxy(req("/admin/login"));
    expect(login.headers.get("location")).toBeNull();
    expect(login.headers.get("cache-control")).toBe("no-store");

    const v = await createAdminSessionValue("admin", { secret });
    const ok = await proxy(req("/admin/dealers", { cookie: `${ADMIN_SESSION_COOKIE}=${v}` }));
    expect(ok.headers.get("location")).toBeNull();
    expect(ok.status).toBe(200);
  });
});
