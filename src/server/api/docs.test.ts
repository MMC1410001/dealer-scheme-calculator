/** Swagger UI and the served spec (same intent as the reference API tests/test_docs.py). */
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLimitersForTests } from "@/server/ratelimit";
import { DOCS_CSP, SWAGGER_CSS_SRI, SWAGGER_CSS_URL, SWAGGER_JS_SRI, SWAGGER_JS_URL, SWAGGER_UI_BASE, SWAGGER_UI_VERSION } from "./docs";
import { checkOpenApi, exportedMethods, loadSpec } from "./openapi-check";

const docsRoute = await import("@/app/api/docs/route");
const specRoute = await import("@/app/api/v1/openapi.json/route");

const saved = { ...process.env };
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.APP_ENV = "local";
  for (const k of ["AUTH_CLIENTS", "JWT_SECRET", "DOCS_ENABLED", "REDIS_URL"]) delete process.env[k];
  resetLimitersForTests();
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = { ...saved };
  log.mockRestore();
});

const get = (u: string) => new Request(`http://localhost${u}`);

describe("GET /api/docs", () => {
  it("loads one pinned release with integrity hashes", async () => {
    const res = await docsRoute.GET(get("/api/docs"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(SWAGGER_UI_VERSION).toMatch(/^\d+\.\d+\.\d+$/); // exact, never "@5"
    expect(html).not.toContain("swagger-ui-dist@5/");
    expect(html).toContain(`<script src="${SWAGGER_JS_URL}" integrity="${SWAGGER_JS_SRI}" crossorigin="anonymous"></script>`);
    expect(html).toContain(`href="${SWAGGER_CSS_URL}" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous">`);
    expect(html).toContain('url:"/api/v1/openapi.json"');
  });

  it("the CSP allows only the pinned release and the one inline script (by hash)", async () => {
    const res = await docsRoute.GET(get("/api/docs"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toBe(DOCS_CSP);
    expect(csp).toContain(`script-src 'sha256-`);
    expect(csp).toContain(` ${SWAGGER_UI_BASE};`);
    expect(csp).not.toMatch(/https:\/\/cdn\.jsdelivr\.net[; ]/);
    expect(csp.split("script-src")[1].split(";")[0]).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    const html = await res.text();
    const inline = /<script>(.*)<\/script>/.exec(html)![1];
    expect(csp).toContain(`'sha256-${createHash("sha256").update(inline).digest("base64")}'`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("DOCS_ENABLED=false hides the page and the spec (JSON 404)", async () => {
    process.env.DOCS_ENABLED = "false";
    expect((await docsRoute.GET(get("/api/docs"))).status).toBe(404);
    const s = await specRoute.GET(get("/api/v1/openapi.json"));
    expect(s.status).toBe(404);
    expect(await s.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("is off by default outside APP_ENV=local", async () => {
    process.env.APP_ENV = "prod";
    process.env.AUTH_CLIENTS = JSON.stringify({ x: "a".repeat(64) });
    process.env.JWT_SECRET = "q".repeat(40);
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect((await docsRoute.GET(get("/api/docs"))).status).toBe(404);
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("serves docs/openapi.json with this server first", async () => {
    const res = await specRoute.GET(get("/api/v1/openapi.json"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { openapi: string; servers: Array<{ url: string }>; paths: Record<string, unknown> };
    expect(body.openapi).toBe("3.0.3");
    expect(body.servers[0].url).toBe("/");
    expect(Object.keys(body.paths)).toEqual(["/api/v1/auth/token", "/api/v1/dealer-scheme-status", "/api/v1/dealer-reward-choice", "/api/v1/embed-token", "/api/v1/health"]);
  });
});

describe("docs/openapi.json consistency (M6)", () => {
  const root = path.resolve(__dirname, "../../..");
  it("matches the route files, resolves every $ref, and has valid and invalid examples", () => {
    expect(checkOpenApi(loadSpec(root), path.join(root, "src/app/api/v1"))).toEqual([]);
  });

  it("finds a missing path, a bad $ref and a wrong example", () => {
    const spec = loadSpec(root) as { paths: Record<string, Record<string, unknown>>; components: Record<string, unknown> };
    delete spec.paths["/api/v1/health"];
    (spec.components as { x?: unknown }).x = { $ref: "#/components/schemas/Nope" };
    const post = spec.paths["/api/v1/dealer-scheme-status"].post as { requestBody: { content: Record<string, { examples: Record<string, unknown> }> } };
    post.requestBody.content["application/json"].examples.valid_bad = { value: { dealer_code: "", scheme_tags: [] } };
    const p = checkOpenApi(spec, path.join(root, "src/app/api/v1"));
    expect(p).toContain("/api/v1/health: route.ts exists but the path is not in the spec");
    expect(p).toContain("$ref does not resolve: #/components/schemas/Nope");
    expect(p).toContain("dealer-scheme-status example valid_bad does not pass validation");
  });

  it("reads exported methods of a route file", () => {
    expect([...exportedMethods("export async function GET() {}\nexport const HEAD = GET;\nexport function POST(){}")].sort()).toEqual(["get", "head", "post"]);
  });
});
