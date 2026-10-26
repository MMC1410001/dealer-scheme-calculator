/**
 * Keeps the Postman collection in step with the code (same checks as the reference tests/test_postman_collection.py):
 * the committed JSON equals the generator output, every operation of docs/openapi.json has a request, every
 * request has tests, and the collection calls only API paths that exist (plus the documented 404 probe).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import spec from "../../docs/openapi.json";
import { buildAll, COLLECTION_FILE, DEV_BASE_URL, uuidV5 } from "./build-collection";

const DIR = path.resolve(__dirname);
type Item = { name: string; item?: Item[]; request?: { method: string; url: { path: string[] } }; event?: unknown[] };

function requestsIn(items: Item[]): Item[] {
  return items.flatMap((i) => (i.item ? requestsIn(i.item) : [i]));
}
const load = (file: string) => JSON.parse(readFileSync(path.join(DIR, file), "utf8"));
const collection = load(COLLECTION_FILE) as { item: Item[] };
const requests = requestsIn(collection.item);
const requestPath = (r: Item) => "/" + r.request!.url.path.join("/");

describe("Postman collection", () => {
  it("is up to date with build-collection.ts (run npm run qa:postman)", () => {
    for (const [file, built] of Object.entries(buildAll())) expect(load(file), file).toEqual(built);
  });

  it("has a request for every operation in docs/openapi.json", () => {
    const covered = new Set(requests.map((r) => `${r.request!.method} ${requestPath(r)}`));
    const missing: string[] = [];
    for (const [p, item] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
      for (const method of Object.keys(item)) {
        if (["get", "head", "post", "put", "patch", "delete", "options"].includes(method) && !covered.has(`${method.toUpperCase()} ${p}`)) {
          missing.push(`${method.toUpperCase()} ${p}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("has tests on every request", () => {
    const untested = requests.filter((r) => !(r.event ?? []).some((e) => (e as { listen: string }).listen === "test"));
    expect(untested.map((r) => r.name)).toEqual([]);
  });

  it("calls only paths of the spec, the API docs page, the unknown-route probe and the iframe page", () => {
    // /embed: opened with the token that POST /api/v1/embed-token returns.
    const allowed = new Set([...Object.keys(spec.paths), "/api/docs", "/api/v1/schemes/unknown", "/embed"]);
    expect(requests.map(requestPath).filter((p) => !allowed.has(p))).toEqual([]);
  });

  it("holds no real credentials: Local has the published example client, Dev is empty", () => {
    const values = (file: string) => Object.fromEntries((load(file).values as Array<{ key: string; value: string }>).map((v) => [v.key, v.value]));
    expect(values("Local.postman_environment.json")).toMatchObject({ clientId: "local-client", clientSecret: "local-test-secret" });
    expect(values("Dev.postman_environment.json")).toMatchObject({ clientId: "", clientSecret: "" });
    // Dev base URL (decision Q8): auth on, no DEMO data on a real environment.
    expect(DEV_BASE_URL).toBe("https://dev.scheme-calculator.example.com");
    expect(values("Dev.postman_environment.json")).toMatchObject({ baseUrl: DEV_BASE_URL, authEnabled: "true", sampleData: "false" });
    expect(readFileSync(path.join(DIR, COLLECTION_FILE), "utf8")).not.toMatch(/\b6\d{9}\b/); // no real dealer codes
  });

  it("does not retry a failed token request before each request (no 429 storm)", () => {
    // 18-10-2026: after a ZAP scan used up the token limit, a retry before each request sent 67 more token
    // requests, kept the limit used up and gave 111 failed checks. The script waits 60 s after a failure.
    const pre = (collection as unknown as { event: Array<{ listen: string; script: { exec: string[] } }> }).event
      .filter((e) => e.listen === "prerequest").flatMap((e) => e.script.exec).join("\n");
    expect(pre).toContain('pm.collectionVariables.get("accessTokenFailedAt")');
    expect(pre).toMatch(/Date\.now\(\) - failedAt < 60000\) return;/);
    expect(pre).toContain('pm.collectionVariables.set("accessTokenFailedAt", String(Date.now()))');
    expect(pre).toContain("TOKEN_RATE_LIMIT_PER_MINUTE");
  });

  it("uses stable UUID v5 ids (RFC 4122 test vector)", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });
});
