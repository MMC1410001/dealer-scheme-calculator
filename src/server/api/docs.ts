/**
 * API docs (on only when DOCS_ENABLED; default on only with APP_ENV=local):
 * - GET /api/v1/openapi.json: docs/openapi.json (the hand-written OpenAPI 3.0.3 contract), with this server first.
 * - GET /api/docs: Swagger UI from ONE pinned swagger-ui-dist release, with Subresource Integrity.
 *   The browser refuses the files unless their SHA-384 matches. The page CSP allows only that release path
 *   and the one inline start script (by its SHA-256 hash; no 'unsafe-inline' for scripts).
 *
 * To upgrade Swagger UI: pick a release at least 2 weeks old, download swagger-ui-bundle.js and swagger-ui.css,
 * and replace the version and both hashes (`openssl dgst -sha384 -binary <file> | openssl base64 -A`).
 */
import { createHash } from "node:crypto";
import spec from "../../../docs/openapi.json";

export const SWAGGER_UI_VERSION = "5.32.15";
export const SWAGGER_UI_BASE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/`;
export const SWAGGER_JS_URL = `${SWAGGER_UI_BASE}swagger-ui-bundle.js`;
export const SWAGGER_CSS_URL = `${SWAGGER_UI_BASE}swagger-ui.css`;
export const SWAGGER_JS_SRI = "sha384-m7zaGj7MPzU+G4lz2eyy73GxK9bbRDr9bB2CSdj8wodg2wu/Wnt6wsoLP3JD+RS9";
export const SWAGGER_CSS_SRI = "sha384-fgyWYkUAamzuI8mJFu/xpRP0JWCJRwkwUwsYDoOYVHUJ8NQE5cENn8ib3ppwFFSX";
export const OPENAPI_URL = "/api/v1/openapi.json";
export const DOCS_URL = "/api/docs";

const INIT_SCRIPT =
  "window.onload=function(){window.ui=SwaggerUIBundle({" +
  `url:${JSON.stringify(OPENAPI_URL)},dom_id:"#swagger-ui",deepLinking:true,` +
  'presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],layout:"BaseLayout"});};';

const INIT_SCRIPT_HASH = `sha256-${createHash("sha256").update(INIT_SCRIPT, "utf8").digest("base64")}`;

/** CSP of the Swagger UI page. */
export const DOCS_CSP =
  `default-src 'self'; script-src '${INIT_SCRIPT_HASH}' ${SWAGGER_UI_BASE}; ` +
  `style-src 'self' 'unsafe-inline' ${SWAGGER_UI_BASE}; img-src 'self' data:; connect-src 'self'; ` +
  "base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function swaggerUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dealer Scheme Status API | Swagger UI</title>
<link rel="stylesheet" href="${SWAGGER_CSS_URL}" integrity="${SWAGGER_CSS_SRI}" crossorigin="anonymous">
</head>
<body>
<div id="swagger-ui"></div>
<script src="${SWAGGER_JS_URL}" integrity="${SWAGGER_JS_SRI}" crossorigin="anonymous"></script>
<script>${INIT_SCRIPT}</script>
</body>
</html>
`;
}

/** The spec as served: this server ("/") first, then the configured servers. */
export function servedSpec(): unknown {
  const s = spec as { servers?: unknown[] } & Record<string, unknown>;
  return { ...s, servers: [{ url: "/", description: "This server" }, ...(s.servers ?? [])] };
}

export { spec as OPENAPI_SPEC };
