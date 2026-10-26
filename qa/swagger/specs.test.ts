/**
 * Keeps the Swagger spec in qa/swagger/ in step with docs/openapi.json, and its examples truthful
 * (same checks as the reference tests/test_swagger_specs.py).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateStatusRequest } from "@/server/api/dealer-status";
import { build, DSS_PATH, refs, SPEC_FILE, SPEC_PATHS } from "./build-specs";

type Json = Record<string, unknown>;
const spec = JSON.parse(readFileSync(path.join(__dirname, SPEC_FILE), "utf8")) as Json;
const paths = spec.paths as Record<string, Record<string, Json>>;
const post = paths[DSS_PATH].post as Json & { requestBody: Json; responses: Record<string, Json> };

function resolve(ref: string): unknown {
  let cur: unknown = spec;
  for (const part of ref.slice(2).split("/")) cur = (cur as Json | undefined)?.[part];
  return cur;
}

/** Checks a value against a schema of the spec: types, required fields, no unknown fields, enums. */
function conforms(value: unknown, schema: Json, at: string, problems: string[]): void {
  if (schema.$ref) return conforms(value, resolve(schema.$ref as string) as Json, at, problems);
  if (value === null) {
    if (!schema.nullable) problems.push(`${at}: null but not nullable`);
    return;
  }
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) problems.push(`${at}: ${String(value)} not in enum`);
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return void problems.push(`${at}: not an object`);
      const props = (schema.properties ?? {}) as Record<string, Json>;
      for (const r of (schema.required ?? []) as string[]) if (!(r in (value as Json))) problems.push(`${at}.${r}: required, missing`);
      for (const [k, v] of Object.entries(value as Json)) {
        if (!props[k]) problems.push(`${at}.${k}: not in the schema`);
        else conforms(v, props[k], `${at}.${k}`, problems);
      }
      return;
    }
    case "array":
      if (!Array.isArray(value)) return void problems.push(`${at}: not an array`);
      value.forEach((v, i) => conforms(v, schema.items as Json, `${at}[${i}]`, problems));
      return;
    case "string":
      if (typeof value !== "string") problems.push(`${at}: not a string`);
      return;
    case "integer":
      if (!Number.isInteger(value)) problems.push(`${at}: not an integer`);
      return;
    case "number":
      if (typeof value !== "number") problems.push(`${at}: not a number`);
      return;
    case "boolean":
      if (typeof value !== "boolean") problems.push(`${at}: not a boolean`);
      return;
  }
}

describe("Swagger spec (qa/swagger)", () => {
  it("is up to date with docs/openapi.json (run npm run qa:swagger)", () => {
    expect(spec).toEqual(build());
  });

  it("has only the dealer status, token and health paths, and the Local and Dev servers", () => {
    expect(Object.keys(paths).sort()).toEqual([...SPEC_PATHS].sort());
    expect((spec.servers as Array<{ url: string }>).map((s) => s.url)).toEqual(["http://localhost:3400", "https://dev.scheme-calculator.example.com"]);
  });

  it("resolves every $ref inside the file", () => {
    for (const ref of refs(spec)) expect(resolve(ref), ref).toBeDefined();
  });

  it("has request examples that the API accepts or rejects as their names say", () => {
    const content = (post.requestBody.content as Record<string, Json>)["application/json"];
    const examples = content.examples as Record<string, { value: unknown }>;
    expect(Object.keys(examples).some((n) => !n.startsWith("invalid_"))).toBe(true);
    expect(Object.keys(examples).some((n) => n.startsWith("invalid_"))).toBe(true);
    for (const [name, example] of Object.entries(examples)) {
      expect(validateStatusRequest(example.value).ok, name).toBe(!name.startsWith("invalid_"));
    }
  });

  it("has a 200 example that matches the StatusResponse schema (no missing or extra keys)", () => {
    const content = (post.responses["200"].content as Record<string, Json>)["application/json"];
    const examples = content.example !== undefined ? [content.example] : Object.values(content.examples as Record<string, { value: unknown }>).map((e) => e.value);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const problems: string[] = [];
      conforms(example, content.schema as Json, "200", problems);
      expect(problems).toEqual([]);
    }
  });

  it("documents the error responses", () => {
    expect(Object.keys(post.responses)).toEqual(expect.arrayContaining(["200", "400", "401", "403", "404", "413", "429", "500", "503"]));
    const token = paths["/api/v1/auth/token"].post as Json & { responses: Json };
    expect(Object.keys(token.responses)).toEqual(expect.arrayContaining(["200", "400", "401", "413", "429"]));
  });

  it("holds no real dealer codes", () => {
    expect(readFileSync(path.join(__dirname, SPEC_FILE), "utf8")).not.toMatch(/\b6\d{9}\b/);
  });
});
