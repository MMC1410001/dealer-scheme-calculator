/**
 * Token endpoint: POST /api/v1/auth/token (OAuth2 client credentials, RFC 6749 section 4.4).
 *
 * The caller sends grant_type=client_credentials, form-encoded (RFC 6749) or as a JSON object of strings,
 * with its client_id and client_secret in HTTP Basic auth or in the body (not both). It gets a Bearer token
 * that is valid for JWT_TTL_SECONDS (default 1 hour), and must reuse it until it expires.
 *
 * Errors use the RFC 6749 section 5.2 format {"error", "error_description"}. Every response has
 * Cache-Control: no-store and Pragma: no-cache. A 401 has WWW-Authenticate: Basic realm="scheme-calculator" only when the
 * caller sent an Authorization header (RFC 6749 section 5.2). With the credentials in the body there is no challenge:
 * a browser (for example Swagger UI) would otherwise open its own sign-in dialog and the request would never finish.
 *
 * handleTokenRequest is plain TypeScript with injected dependencies (no Next.js). The route file
 * (src/app/api/v1/auth/token/route.ts) runs the per-IP limits first (before the body is read).
 * Never log the secret.
 */
import { authenticateClient } from "@/lib/auth/clients";
import { KNOWN_SCOPES, REALM, SCOPE, WRITE_SCOPE, authorizationScheme, issueToken } from "@/lib/auth/jwt";
import { formDecode, parseTokenBody, tokenBodyType, DESC_CONTENT_TYPE } from "@/lib/auth/token-body";

export const TOKEN_MAX_BODY_BYTES = 8 * 1024;

export interface TokenRequestInput {
  authorization: string | null;
  contentType: string | null;
  readBody: () => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "TOO_LARGE" }>;
}

export interface TokenDeps {
  /** True when auth is on (clients and a signing key). When false, every request gets invalid_client. */
  enabled: boolean;
  clients: ReadonlyMap<string, string>;
  /** Clients that may get the write scope (AUTH_WRITE_CLIENTS). */
  writeClients?: ReadonlySet<string>;
  jwtSecret: string | null;
  ttlSeconds: number;
  nowSec?: () => number;
}

export interface TokenResult {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** For the log line only. */
  log: { evt: "token_issued" | "token_refused"; clientId: string | null; error: string | null };
}

class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
    readonly status: number = 400,
  ) {
    super(error);
  }
}

const invalidRequest = (d: string) => new OAuthError("invalid_request", d);
const invalidClient = () => new OAuthError("invalid_client", "Client authentication failed", 401);

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Credentials from "Authorization: Basic ...". Null when there is no Authorization header. */
function basicCredentials(authorization: string | null): [string, string] | null {
  const { scheme, value } = authorizationScheme(authorization);
  if (!scheme) return null;
  if (scheme.toLowerCase() !== "basic") throw invalidClient();
  if (!value || !BASE64.test(value)) throw invalidClient();
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value, "base64"));
  } catch {
    throw invalidClient();
  }
  const i = decoded.indexOf(":");
  if (i < 0) throw invalidClient();
  try {
    // RFC 6749 section 2.3.1: both parts are form-encoded before the Basic encoding.
    return [formDecode(decoded.slice(0, i)), formDecode(decoded.slice(i + 1))];
  } catch {
    throw invalidClient();
  }
}

const NO_CACHE = { "Cache-Control": "no-store", Pragma: "no-cache" };

function errorResult(e: OAuthError, clientId: string | null, sentAuthorization: boolean): TokenResult {
  const headers: Record<string, string> = { ...NO_CACHE };
  if (e.status === 401 && sentAuthorization) headers["WWW-Authenticate"] = `Basic ${REALM}`;
  return {
    status: e.status,
    body: { error: e.error, error_description: e.description },
    headers,
    log: { evt: "token_refused", clientId, error: e.error },
  };
}

export async function handleTokenRequest(input: TokenRequestInput, deps: TokenDeps): Promise<TokenResult> {
  let clientId: string | null = null;
  const sentAuthorization = authorizationScheme(input.authorization).scheme !== "";
  try {
    const type = tokenBodyType(input.contentType);
    if (!type) throw invalidRequest(DESC_CONTENT_TYPE);
    const read = await input.readBody();
    if (!read.ok) throw new OAuthError("invalid_request", `The request body must be ${TOKEN_MAX_BODY_BYTES} bytes or smaller`, 413);
    const parsed = parseTokenBody(type, read.bytes);
    if (!parsed.ok) throw invalidRequest(parsed.description);
    const params = parsed.params;

    const basic = basicCredentials(input.authorization);
    if (basic && (params.has("client_secret") || params.has("client_id"))) {
      throw invalidRequest("Send the client credentials in one place: Basic auth or the body");
    }
    const grantType = params.get("grant_type");
    if (!grantType) throw invalidRequest("grant_type is required");
    if (grantType !== "client_credentials") throw new OAuthError("unsupported_grant_type", "Only client_credentials is supported");

    const [id, secret] = basic ?? [params.get("client_id") ?? "", params.get("client_secret") ?? ""];
    clientId = id ? id.slice(0, 64) : null;
    if (!id || !secret) throw invalidClient();

    // Absent or blank: all scopes that the client may use.
    const requested = [...new Set((params.get("scope") ?? "").split(/\s+/).filter(Boolean))];
    if (requested.some((s) => !KNOWN_SCOPES.includes(s))) {
      throw new OAuthError("invalid_scope", `Unknown scope. The scopes are ${KNOWN_SCOPES.join(" and ")}`);
    }

    if (!deps.enabled || !deps.jwtSecret || !authenticateClient(deps.clients, id, secret)) throw invalidClient();

    const allowed = deps.writeClients?.has(id) ? [SCOPE, WRITE_SCOPE] : [SCOPE];
    const granted = requested.length > 0 ? requested : allowed;
    if (granted.some((s) => !allowed.includes(s))) throw new OAuthError("invalid_scope", `This client may use only ${allowed.join(" ")}`);

    const nowSec = deps.nowSec ? deps.nowSec() : Math.floor(Date.now() / 1000);
    const token = await issueToken(id, { secret: deps.jwtSecret, ttlSeconds: deps.ttlSeconds }, nowSec, granted);
    return {
      status: 200,
      body: { access_token: token, token_type: "Bearer", expires_in: deps.ttlSeconds, scope: granted.join(" ") },
      headers: { ...NO_CACHE },
      log: { evt: "token_issued", clientId: id, error: null },
    };
  } catch (err) {
    if (err instanceof OAuthError) return errorResult(err, clientId, sentAuthorization);
    throw err;
  }
}

/** One JSON log line for the token request. Never the secret or the token. */
export function logTokenRequest(r: TokenResult, route: string, requestId: string, durationMs: number): void {
  const write = r.status >= 500 ? console.error : r.log.evt === "token_refused" && r.status === 401 ? console.warn : console.log;
  write(
    JSON.stringify({
      evt: r.log.evt,
      route,
      request_id: requestId,
      client_id: r.log.clientId,
      status: r.status,
      ...(r.log.error ? { error: r.log.error } : {}),
      duration_ms: Math.round(durationMs),
    }),
  );
}
