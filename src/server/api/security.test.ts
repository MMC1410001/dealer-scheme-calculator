/** Security behaviour of the API routes (same intent as the reference API tests/test_security.py). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/auth/clients";
import { issueToken } from "@/lib/auth/jwt";
import { resetLimitersForTests } from "@/server/ratelimit";

vi.mock("@/server/repo", () => ({
  listActiveSchemeTags: () => Promise.resolve(["FB-PAN"]),
  getDealerStatus: (code: string) => {
    if (code === "BUSY") return Promise.reject(new Error("Failed query", { cause: new Error("timeout exceeded when trying to connect") }));
    if (code === "LEAK") return Promise.reject(new Error("connection to server at 10.0.0.5 failed"));
    return Promise.resolve(null);
  },
  getDataAsOf: () => Promise.resolve(null),
}));

const dss = await import("@/app/api/v1/dealer-scheme-status/route");
const token = await import("@/app/api/v1/auth/token/route");

const JWT_SECRET = "z".repeat(40);
const saved = { ...process.env };
let spies: Array<ReturnType<typeof vi.spyOn>> = [];
let bearer = "";

beforeEach(async () => {
  Object.assign(process.env, {
    APP_ENV: "local",
    AUTH_CLIENTS: JSON.stringify({ ci: hashSecret("s") }),
    JWT_SECRET,
    RATE_LIMIT_PER_SECOND: "100000",
    API_RATE_LIMIT_PER_MINUTE: "100000",
  });
  delete process.env.REDIS_URL;
  delete process.env.CACHE_ENABLED;
  resetLimitersForTests();
  spies = (["log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  bearer = `Bearer ${await issueToken("ci", { secret: JWT_SECRET, ttlSeconds: 3600 })}`;
});
afterEach(() => {
  process.env = { ...saved };
  for (const s of spies) s.mockRestore();
});

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/dealer-scheme-status", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: bearer, ...headers },
    body,
  });
}

describe("input handling", () => {
  it.each(["<script>alert(1)</script>", "1' OR '1'='1", "../../etc/passwd", "61000\u000099", "6100\r\nX: y", "A".repeat(33), "６１００", "DROP TABLE;--"])(
    "rejects the malicious dealer_code %j with 400 and does not echo it",
    async (payload) => {
      const res = await dss.POST(post(JSON.stringify({ dealer_code: payload, scheme_tags: ["FB-PAN"] })));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toContain(payload);
      expect(JSON.parse(text).error.code).toBe("INVALID_REQUEST");
    },
  );

  it("invalid JSON gives 400 with no stack trace", async () => {
    const res = await dss.POST(post("{not json"));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toMatch(/at |\.ts:|node_modules|SyntaxError/);
  });
});

describe("credentials", () => {
  it.each(["kéy", "ÿ".repeat(14), "eyJé.x.y"])("non-ASCII credentials %j give 401, not 500", async (value) => {
    const b = await dss.POST(post("{}", { authorization: `Bearer ${value}` }));
    expect(b.status).toBe(401);
    expect(await b.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Invalid token" } });
    const basic = await token.POST(
      new Request("http://localhost/api/v1/auth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${value}` },
        body: "grant_type=client_credentials",
      }),
    );
    expect(basic.status).toBe(401);
    expect(((await basic.json()) as { error: string }).error).toBe("invalid_client");
  });

  it("an X-API-Key header alone is not accepted", async () => {
    const res = await dss.POST(post("{}", { authorization: "", "x-api-key": "anything" }));
    expect(res.status).toBe(401);
  });
});

describe("server errors", () => {
  it("no free database connection: 503 SERVICE_BUSY with Retry-After 2 and the security headers", async () => {
    const res = await dss.POST(post(JSON.stringify({ dealer_code: "BUSY", scheme_tags: ["FB-PAN"] })));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(await res.json()).toEqual({ error: { code: "SERVICE_BUSY", message: "Service busy. Try again in a few seconds." } });
  });

  it("an unexpected error gives a generic 500 that does not leak the detail", async () => {
    const res = await dss.POST(post(JSON.stringify({ dealer_code: "LEAK", scheme_tags: ["FB-PAN"] })));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("10.0.0.5");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
