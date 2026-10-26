/** Route-level tests: Next.js route handlers (pipeline, token endpoint, data endpoint) with the data layer mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/auth/clients";
import { resetLimitersForTests } from "@/server/ratelimit";
import { readBodyLimited } from "./http";

vi.mock("@/server/repo", () => ({
  listActiveSchemeTags: () => Promise.resolve(["FB-PAN", "FB-TNHPJK", "SP-Q3"]),
  getDealerStatus: (code: string, tags: string[]) =>
    code === "DBDOWN"
      ? Promise.reject(new Error('Failed query: select "tag" from "scheme"'))
      : Promise.resolve(
          code === "D10001"
            ? { dealer_code: code, dealer_name: null, data_as_of: null, schemes: tags.map((t) => ({ scheme_tag: t, participation: "NOT_IN_SCOPE" })) }
            : null,
        ),
  getDataAsOf: () => Promise.resolve("2026-10-16T05:30:00+05:30"),
}));

const dss = await import("@/app/api/v1/dealer-scheme-status/route");
const token = await import("@/app/api/v1/auth/token/route");
const health = await import("@/app/api/v1/health/route");
const notFound = await import("@/app/api/[[...slug]]/route");

const SECRET = "route-test-client-secret";
const URL_ = "http://localhost/api/v1/dealer-scheme-status";
const TOKEN_URL = "http://localhost/api/v1/auth/token";
const saved = { ...process.env };
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

function setAuthEnv(): void {
  process.env.APP_ENV = "local";
  process.env.AUTH_CLIENTS = JSON.stringify({ ci: hashSecret(SECRET) });
  process.env.JWT_SECRET = "j".repeat(40);
  delete process.env.JWT_PREVIOUS_SECRET;
  delete process.env.REDIS_URL;
  delete process.env.CACHE_ENABLED;
  process.env.API_RATE_LIMIT_PER_MINUTE = "1000";
  process.env.RATE_LIMIT_PER_SECOND = "1000";
  process.env.TOKEN_RATE_LIMIT_PER_MINUTE = "1000";
}

beforeEach(() => {
  setAuthEnv();
  resetLimitersForTests();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...saved };
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

async function getToken(): Promise<string> {
  const res = await token.POST(
    new Request(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=ci&client_secret=${SECRET}`,
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

function post(body: string | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    ...(typeof body === "string" ? {} : { duplex: "half" }),
  } as RequestInit);
}

const SECURITY = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
function expectSecurityHeaders(res: Response): void {
  for (const [k, v] of Object.entries(SECURITY)) expect(res.headers.get(k), k).toBe(v);
  expect(res.headers.get("access-control-allow-origin")).toBeNull();
}

describe("POST /api/v1/dealer-scheme-status", () => {
  it("returns 200 JSON with the security headers and a request id, and logs one line without the token", async () => {
    const t = await getToken();
    logSpy.mockClear();
    const res = await dss.POST(post(JSON.stringify({ dealer_code: "D10001", scheme_tags: ["SP-Q3", "FB-PAN"] }), { authorization: `Bearer ${t}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expectSecurityHeaders(res);
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-cache")).toBeNull(); // cache off
    const body = (await res.json()) as { schemes: Array<{ scheme_tag: string }> };
    expect(body.schemes.map((s) => s.scheme_tag)).toEqual(["SP-Q3", "FB-PAN"]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({ evt: "api_request", client_id: "ci", status: 200, tags: 2, dealer_code: "D10001" });
    expect(line).not.toContain(t);
  });

  it("returns 413 for a body over 8 KB: declared Content-Length before auth, and streamed (chunked)", async () => {
    const big = JSON.stringify({ dealer_code: "D10001", scheme_tags: ["FB-PAN"], pad: "x".repeat(9000) });
    const declared = await dss.POST(post(big, { "content-length": String(big.length) }));
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: { code: string } }).error.code).toBe("PAYLOAD_TOO_LARGE");
    expectSecurityHeaders(declared);

    const t = await getToken();
    const enc = new TextEncoder();
    let n = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (n++ < 10) c.enqueue(enc.encode("1".repeat(1000)));
        else c.close();
      },
    });
    const chunked = await dss.POST(post(stream, { authorization: `Bearer ${t}` }));
    expect(chunked.status).toBe(413);
    expectSecurityHeaders(chunked);
  });

  it("returns 503 API_DISABLED when the settings are refused (APP_ENV not set, no auth)", async () => {
    delete process.env.APP_ENV;
    delete process.env.AUTH_CLIENTS;
    delete process.env.JWT_SECRET;
    const res = await dss.POST(post("{}"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "API_DISABLED", message: "The API is not enabled on this server." } });
    expectSecurityHeaders(res);
  });

  it("is open with APP_ENV=local and no auth settings (auth off)", async () => {
    delete process.env.AUTH_CLIENTS;
    delete process.env.JWT_SECRET;
    const res = await dss.POST(post(JSON.stringify({ dealer_code: "D10001", scheme_tags: ["FB-PAN"] })));
    expect(res.status).toBe(200);
  });

  it("returns 500 with no detail and the security headers, and logs one line with the detail", async () => {
    const t = await getToken();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      logSpy.mockClear();
      const res = await dss.POST(post(JSON.stringify({ dealer_code: "DBDOWN", scheme_tags: ["FB-PAN", "FB-TNHPJK"] }), { authorization: `Bearer ${t}` }));
      expect(res.status).toBe(500);
      expectSecurityHeaders(res);
      const text = await res.text();
      expect(text).not.toContain("select");
      expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal error. Try again later." } });
      const id = res.headers.get("x-request-id");
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
      expect(JSON.parse(String(errSpy.mock.calls[0][0]))).toMatchObject({
        evt: "api_request",
        request_id: id,
        client_id: "ci",
        status: 500,
        code: "INTERNAL_ERROR",
        tags: 2,
        dealer_code: "DBDOWN",
        error: 'Error: Failed query: select "tag" from "scheme"',
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it("returns 401 for a wrong token, with the security headers and the Bearer challenge", async () => {
    const res = await dss.POST(post("{}", { authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="scheme-calculator", error="invalid_token", error_description="Invalid token"');
    expectSecurityHeaders(res);
  });

  it("per-IP limit: 429 with Retry-After, the security headers and a log line, before authentication", async () => {
    process.env.RATE_LIMIT_PER_SECOND = "2";
    resetLimitersForTests();
    const codes: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 4; i++) {
      last = await dss.POST(post("{}"));
      codes.push(last.status);
    }
    // Two pass the limit (401: no token); then 429. The window can roll over during the loop, so check the last one.
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(1);
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(((await last!.json()) as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    expectSecurityHeaders(last!);
    expect(last!.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const lines = logSpy.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])) as { status: number; code: string });
    expect(lines.some((l: { status: number; code: string }) => l.status === 429 && l.code === "RATE_LIMITED")).toBe(true);
    // The health probe is never limited.
    for (let i = 0; i < 5; i++) expect((await health.GET()).status).toBe(200);
  });

  it("RATE_LIMIT_ENABLED=false turns the limits off", async () => {
    process.env.RATE_LIMIT_ENABLED = "false";
    process.env.RATE_LIMIT_PER_SECOND = "1";
    for (let i = 0; i < 4; i++) expect((await dss.POST(post("{}"))).status).toBe(401);
  });
});

describe("other methods", () => {
  it("returns 405 with Allow: POST, the security headers and X-Request-Id, and logs one line", async () => {
    for (const h of [dss.GET, dss.HEAD, dss.PUT, dss.PATCH, dss.DELETE]) {
      logSpy.mockClear();
      const res = await h(new Request(URL_));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expectSecurityHeaders(res);
      const id = res.headers.get("x-request-id");
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toMatchObject({ request_id: id, status: 405, code: "METHOD_NOT_ALLOWED" });
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("METHOD_NOT_ALLOWED");
    }
  });

  it("answers OPTIONS with Allow and no CORS headers", async () => {
    const res = await dss.OPTIONS(new Request(URL_, { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("allow")).toBe("POST, OPTIONS");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("token endpoint: 405 for other methods, in the RFC 6749 format", async () => {
    for (const h of [token.GET, token.PUT, token.PATCH, token.DELETE]) {
      const res = await h(new Request(TOKEN_URL));
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
      expect(((await res.json()) as { error: string }).error).toBe("invalid_request");
    }
  });
});

describe("token endpoint route", () => {
  it("per-IP token limit: 429 after TOKEN_RATE_LIMIT_PER_MINUTE, before the body is read", async () => {
    process.env.TOKEN_RATE_LIMIT_PER_MINUTE = "2";
    resetLimitersForTests();
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await token.POST(new Request(TOKEN_URL, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([400, 400, 429]);
  });

  it("logs token_issued with the client_id and never the secret or the token", async () => {
    logSpy.mockClear();
    const t = await getToken();
    const all = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(all).toContain('"evt":"token_issued"');
    expect(all).toContain('"client_id":"ci"');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(t);
  });

  it("logs token_refused for bad credentials, without the secret", async () => {
    await token.POST(
      new Request(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&client_id=ci&client_secret=wrong-secret-value",
      }),
    );
    const all = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(all).toContain('"evt":"token_refused"');
    expect(all).not.toContain("wrong-secret-value");
  });
});

describe("GET and HEAD /api/v1/health", () => {
  it("returns status ok and data_as_of only, with the security headers", async () => {
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", data_as_of: "2026-10-16T05:30:00+05:30" });
    expectSecurityHeaders(res);
  });

  it("answers HEAD with 200 and no body", async () => {
    const res = await health.HEAD();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("unknown /api/* paths", () => {
  it("returns JSON 404 NOT_FOUND for every method, with the security headers", async () => {
    for (const h of [notFound.GET, notFound.POST, notFound.PUT, notFound.DELETE, notFound.OPTIONS]) {
      const res = await h(new Request("http://localhost/api/v1/nope"));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
      expectSecurityHeaders(res);
    }
  });
});

describe("readBodyLimited", () => {
  it("reads a small body and stops at the limit", async () => {
    expect(await readBodyLimited(new Request(URL_, { method: "POST", body: "héllo" }), 10)).toEqual({ ok: true, text: "héllo" });
    expect(await readBodyLimited(new Request(URL_, { method: "POST", body: "x".repeat(11) }), 10)).toEqual({ ok: false, reason: "TOO_LARGE" });
    expect(await readBodyLimited(new Request(URL_, { method: "POST" }), 10)).toEqual({ ok: true, text: "" });
  });

  it("rejects a declared Content-Length above the limit before reading", async () => {
    const r = new Request(URL_, { method: "POST", body: "x", headers: { "content-length": "99999" } });
    expect(await readBodyLimited(r, 10)).toEqual({ ok: false, reason: "TOO_LARGE" });
  });

  it("stops a streamed body without Content-Length at the limit", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(4096));
      },
    });
    const r = new Request(URL_, { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect(await readBodyLimited(r, 8192)).toEqual({ ok: false, reason: "TOO_LARGE" });
  });
});
