/**
 * Writes one Swagger (OpenAPI 3.0.3) file for the dealer scheme status API, cut from the contract docs/openapi.json:
 * the dealer status, token and health paths, only the components they use, and the Local and Dev servers.
 *
 *   npm run qa:swagger
 *
 * Open the file in Swagger Editor (https://editor.swagger.io, File > Import file) or any OpenAPI tool (Postman,
 * Insomnia, a code generator). qa/swagger/specs.test.ts fails when the file is stale.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fullSpec from "../../docs/openapi.json";

const OUT = path.dirname(fileURLToPath(import.meta.url));
type Json = Record<string, unknown>;

export const SPEC_FILE = "Scheme_Calculator_Dealer_Status.openapi.json";
export const DSS_PATH = "/api/v1/dealer-scheme-status";
export const SPEC_PATHS = [DSS_PATH, "/api/v1/auth/token", "/api/v1/health"];

/** Dev server (decision Q8, 18-10-2026; Swagger UI there at /api/docs). UAT and production: same pattern, to be confirmed. */
export const DEV_SERVER_URL = "https://dev.scheme-calculator.example.com";
const SERVERS = [
  { url: "http://localhost:3400", description: "Local (qa/README.md Step 1)" },
  { url: DEV_SERVER_URL, description: "Dev" },
];
const HOW_TO =
  "\n\n**Try it:** select a server, click **Authorize** and enter your client_id and client_secret (OAuth2 client " +
  "credentials; Local: local-client / local-test-secret). Swagger gets a Bearer token from POST /api/v1/auth/token " +
  "and sends it on every call. Then click **Try it out** on the request and select an example. Examples named " +
  "`invalid_*` must return 400; the other examples return 200.\n\nFull guide: docs/API_GUIDE.md in the repository.";

/** Every $ref under node. */
export function refs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) refs(n, out);
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Json)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refs(v, out);
    }
  }
  return out;
}

export function build(full: Json = fullSpec as unknown as Json): Json {
  const allPaths = full.paths as Record<string, unknown>;
  const paths = Object.fromEntries(SPEC_PATHS.map((p) => [p, structuredClone(allPaths[p])]));
  const components = full.components as Record<string, Record<string, unknown>>;
  const kept: Record<string, Record<string, unknown>> = {};
  const todo = refs(paths);
  while (todo.length) {
    // Keep only the components that these paths use, following refs inside components too.
    const [, , section, name] = todo.pop()!.split("/");
    kept[section] ??= {};
    if (!(name in kept[section])) {
      kept[section][name] = structuredClone(components[section][name]);
      todo.push(...refs(kept[section][name]));
    }
  }
  const sorted = Object.fromEntries(
    Object.entries(kept).sort(([a], [b]) => a.localeCompare(b)).map(([s, items]) => [s, Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b)))]),
  );
  const info = full.info as Json;
  return {
    openapi: full.openapi,
    info: {
      ...info,
      title: "Scheme Calculator - Dealer scheme status API",
      description:
        "POST {dealer_code, scheme_tags} returns the stored scheme status of one dealer: slabs with LOCKED / UNLOCKED, " +
        "gift and CN, for Festive Bonanza (FB-PAN, FB-TNHPJK) and Star Points (SP-Q3). Server-to-server only (no CORS)." + HOW_TO,
    },
    servers: SERVERS,
    tags: full.tags,
    paths,
    components: { ...sorted, securitySchemes: components.securitySchemes },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(path.join(OUT, SPEC_FILE), JSON.stringify(build(), null, 2) + "\n");
  console.log(`wrote qa/swagger/${SPEC_FILE}`);
}
