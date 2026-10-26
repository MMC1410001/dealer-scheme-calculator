/**
 * Consistency checks of the hand-written OpenAPI spec (docs/openapi.json) against the code.
 * FastAPI generates its spec; this app keeps a hand-written one, so these checks keep it true:
 * 1. Every route.ts under src/app/api/v1 has its path in the spec, and every method in the spec is exported
 *    by the route file. (The docs route /api/v1/openapi.json is not in the spec, as in the reference API.)
 * 2. Every $ref resolves.
 * 3. Every valid_* request example of the dealer status endpoint passes validateStatusRequest, and every
 *    invalid_* example fails it. The same for the reward choice endpoint with validateChoiceRequest.
 * 4. The documented responses include 200, 400, 401, 403, 405, 413, 429, 500 and 503 (and 404 / 409 for the choice).
 * HEAD /api/v1/health is answered (same check, no body) but not listed in the spec, so Swagger UI shows one health row.
 * Used by scripts/check-openapi.ts (npm run openapi:check) and by a Vitest test.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { validateStatusRequest } from "@/server/api/dealer-status";
import { validateEmbedTokenRequest } from "@/server/api/embed-token";
import { validateChoiceRequest } from "@/server/api/reward-choice";

type Json = Record<string, unknown>;
const METHODS = ["get", "head", "post", "put", "patch", "delete", "options"] as const;
/** Routes under src/app/api/v1 that are not API operations (kept out of the spec). */
export const SPEC_EXCLUDED_ROUTES = new Set(["/api/v1/openapi.json"]);

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

export function exportedMethods(source: string): Set<string> {
  const m = new Set<string>();
  const re = /export\s+(?:async\s+)?(?:function|const)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/g;
  for (let x = re.exec(source); x; x = re.exec(source)) m.add(x[1].toLowerCase());
  return m;
}

function resolveRef(spec: Json, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cur: unknown = spec;
  for (const part of ref.slice(2).split("/")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Json)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return cur;
}

function refs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) refs(n, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Json)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refs(v, out);
    }
  }
  return out;
}

export function checkOpenApi(spec: Json, appApiV1Dir: string): string[] {
  const problems: string[] = [];
  const paths = (spec.paths ?? {}) as Record<string, Json>;

  for (const file of routeFiles(appApiV1Dir)) {
    const rel = path.relative(appApiV1Dir, path.dirname(file)).split(path.sep).join("/");
    const route = `/api/v1/${rel}`;
    if (SPEC_EXCLUDED_ROUTES.has(route)) continue;
    const item = paths[route];
    if (!item) {
      problems.push(`${route}: route.ts exists but the path is not in the spec`);
      continue;
    }
    const exported = exportedMethods(readFileSync(file, "utf8"));
    for (const m of METHODS) if (item[m] && !exported.has(m)) problems.push(`${route}: spec has ${m.toUpperCase()} but route.ts does not export it`);
  }
  for (const p of Object.keys(paths)) {
    if (!p.startsWith("/api/v1/")) problems.push(`${p}: path is not under /api/v1/`);
  }

  for (const r of refs(spec)) if (resolveRef(spec, r) === undefined) problems.push(`$ref does not resolve: ${r}`);

  const dss = paths["/api/v1/dealer-scheme-status"]?.post as Json | undefined;
  const drc = paths["/api/v1/dealer-reward-choice"]?.post as Json | undefined;
  const emb = paths["/api/v1/embed-token"]?.post as Json | undefined;
  const checkExamples = (label: string, op: Json | undefined, validate: (body: unknown) => { ok: boolean }) => {
    const examples = ((((op?.requestBody as Json | undefined)?.content as Json | undefined)?.["application/json"] as Json | undefined)?.examples ??
      {}) as Record<string, { value: unknown }>;
    if (Object.keys(examples).length === 0) problems.push(`${label}: no request examples`);
    for (const [name, ex] of Object.entries(examples)) {
      const ok = validate(ex.value).ok;
      if (name.startsWith("valid_") && !ok) problems.push(`${label} example ${name} does not pass validation`);
      if (name.startsWith("invalid_") && ok) problems.push(`${label} example ${name} passes validation`);
      if (!name.startsWith("valid_") && !name.startsWith("invalid_")) problems.push(`${label} example ${name}: name must start with valid_ or invalid_`);
    }
  };
  checkExamples("dealer-scheme-status", dss, validateStatusRequest);
  checkExamples("dealer-reward-choice", drc, validateChoiceRequest);
  checkExamples("embed-token", emb, validateEmbedTokenRequest);

  const need: Array<[string, string, string[]]> = [
    ["/api/v1/dealer-scheme-status", "post", ["200", "400", "401", "403", "413", "429", "500", "503"]],
    ["/api/v1/dealer-scheme-status", "get", ["405"]],
    ["/api/v1/dealer-reward-choice", "post", ["200", "400", "401", "403", "404", "409", "413", "429", "500", "503"]],
    ["/api/v1/dealer-reward-choice", "get", ["405"]],
    ["/api/v1/embed-token", "post", ["200", "400", "401", "403", "413", "429", "500", "503"]],
    ["/api/v1/embed-token", "get", ["405"]],
    ["/api/v1/auth/token", "post", ["200", "400", "401", "413", "429", "500", "503"]],
    ["/api/v1/auth/token", "get", ["405"]],
    ["/api/v1/health", "get", ["200", "503"]],
  ];
  for (const [p, m, codes] of need) {
    const responses = ((paths[p]?.[m] as Json | undefined)?.responses ?? {}) as Json;
    for (const c of codes) if (!responses[c]) problems.push(`${m.toUpperCase()} ${p}: response ${c} is not documented`);
  }

  const schemes = (spec.components as Json | undefined)?.securitySchemes as Json | undefined;
  const oauth = schemes?.OAuth2ClientCredentials as Json | undefined;
  const tokenUrl = ((oauth?.flows as Json | undefined)?.clientCredentials as Json | undefined)?.tokenUrl;
  if (tokenUrl !== "/api/v1/auth/token") problems.push("OAuth2ClientCredentials tokenUrl must be /api/v1/auth/token");
  if (JSON.stringify(dss?.security) !== JSON.stringify([{ OAuth2ClientCredentials: ["schemes:read"] }])) {
    problems.push("dealer-scheme-status must need OAuth2ClientCredentials with schemes:read");
  }
  if (JSON.stringify(drc?.security) !== JSON.stringify([{ OAuth2ClientCredentials: ["choices:write"] }])) {
    problems.push("dealer-reward-choice must need OAuth2ClientCredentials with choices:write");
  }
  if (JSON.stringify(emb?.security) !== JSON.stringify([{ OAuth2ClientCredentials: ["schemes:read"] }])) {
    problems.push("embed-token must need OAuth2ClientCredentials with schemes:read");
  }
  return problems;
}

export function loadSpec(root: string): Json {
  return JSON.parse(readFileSync(path.join(root, "docs", "openapi.json"), "utf8")) as Json;
}
