/**
 * Access tokens of the dealer status API: JWT, HS256, signed with JWT_SECRET (RFC 6750 bearer tokens).
 *
 * - issueToken: claims iss = aud = "scheme-calculator", sub = client_id, scope = the granted scopes ("schemes:read",
 *   and "choices:write" for a client in AUTH_WRITE_CLIENTS),
 *   iat = nbf = now, exp = now + JWT_TTL_SECONDS, jti = 32 random hex characters.
 * - verifyBearer: pins HS256, requires iss/aud/sub/iat/nbf/exp/jti (not null), allows 30 s of clock skew, and
 *   needs no database or Redis call. Like PyJWT in the reference, it also refuses iat in the future (beyond the
 *   leeway), a jti that is not a string, and a scope that is not a string. A token's client must still be in AUTH_CLIENTS: removing a client revokes
 *   its tokens at once. For the write scope, the client must also still be in AUTH_WRITE_CLIENTS: removing it there
 *   takes the write access away at once (its tokens keep the read scope).
 * - Key rotation without downtime: move JWT_SECRET to JWT_PREVIOUS_SECRET, set a new JWT_SECRET, and remove
 *   JWT_PREVIOUS_SECRET after JWT_TTL_SECONDS. The previous key is tried only when the signature fails.
 */
import { randomUUID } from "node:crypto";
import { SignJWT, errors, jwtVerify } from "jose";

export const ISSUER = "scheme-calculator";
export const AUDIENCE = "scheme-calculator";
export const SCOPE = "schemes:read";
/** Scope of POST /api/v1/dealer-reward-choice. Only clients in AUTH_WRITE_CLIENTS get it. */
export const WRITE_SCOPE = "choices:write";
export const KNOWN_SCOPES: readonly string[] = [SCOPE, WRITE_SCOPE];
export const ALGORITHM = "HS256";
export const LEEWAY_SECONDS = 30;
export const REQUIRED_CLAIMS = ["iss", "aud", "sub", "iat", "nbf", "exp", "jti"];
export const REALM = 'realm="scheme-calculator"';
/** Longest token that is checked. A real token is about 300 characters. */
const MAX_TOKEN_LENGTH = 4096;

export interface JwtSettings {
  secret: string;
  previousSecret: string | null;
  ttlSeconds: number;
  /** Configured client ids (AUTH_CLIENTS keys). */
  clients: ReadonlyMap<string, string>;
  /** Clients that may use the write scope now (AUTH_WRITE_CLIENTS). Not set = none. */
  writeClients?: ReadonlySet<string>;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueToken(
  clientId: string,
  s: Pick<JwtSettings, "secret" | "ttlSeconds">,
  nowSec?: number,
  scopes: readonly string[] = [SCOPE],
): Promise<string> {
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: scopes.join(" ") })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(clientId)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + s.ttlSeconds)
    .setJti(randomUUID().replaceAll("-", ""))
    .sign(key(s.secret));
}

export type BearerResult =
  | { ok: true; clientId: string }
  | { ok: false; status: 401 | 403; code: "UNAUTHORIZED" | "INSUFFICIENT_SCOPE"; message: string; wwwAuthenticate: string };

function unauthorized(message: string, error?: string): BearerResult {
  const challenge = `Bearer ${REALM}` + (error ? `, error="${error}", error_description="${message}"` : "");
  return { ok: false, status: 401, code: "UNAUTHORIZED", message, wwwAuthenticate: challenge };
}

/** Splits "Scheme value" at the first space (same as Starlette's get_authorization_scheme_param). */
export function authorizationScheme(header: string | null | undefined): { scheme: string; value: string } {
  const h = header ?? "";
  const i = h.indexOf(" ");
  return i < 0 ? { scheme: h, value: "" } : { scheme: h.slice(0, i), value: h.slice(i + 1) };
}

/**
 * Checks "Authorization: Bearer <token>". The scheme name is case-insensitive.
 * Missing or another scheme: 401 "Not authenticated". Expired: 401 "Token expired". Other problems: 401
 * "Invalid token". Valid token without the required scope: 403 "Insufficient scope".
 */
export async function verifyBearer(
  authorization: string | null | undefined,
  s: JwtSettings,
  nowMs?: number,
  requiredScope: string = SCOPE,
): Promise<BearerResult> {
  const { scheme, value } = authorizationScheme(authorization);
  if (scheme.toLowerCase() !== "bearer" || !value) return unauthorized("Not authenticated");
  const token = value;
  // Header values reach the server as latin-1 text. A JWT is ASCII only.
  if (token.length > MAX_TOKEN_LENGTH || !/^[\x21-\x7e]+$/.test(token)) return unauthorized("Invalid token", "invalid_token");

  const keys = [s.secret, s.previousSecret].filter((k): k is string => !!k);
  let payload: Record<string, unknown> | null = null;
  for (const k of keys) {
    try {
      const r = await jwtVerify(token, key(k), {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: LEEWAY_SECONDS,
        requiredClaims: REQUIRED_CLAIMS,
        currentDate: nowMs !== undefined ? new Date(nowMs) : undefined,
      });
      payload = r.payload as Record<string, unknown>;
      break;
    } catch (err) {
      if (err instanceof errors.JWSSignatureVerificationFailed) continue; // try the previous key while rotating
      if (err instanceof errors.JWTExpired) return unauthorized("Token expired", "invalid_token");
      return unauthorized("Invalid token", "invalid_token");
    }
  }
  if (!payload) return unauthorized("Invalid token", "invalid_token");
  // jose checks only that a required claim is present. PyJWT also refuses null, iat in the future and a jti that
  // is not a string.
  if (REQUIRED_CLAIMS.some((c) => payload[c] === null)) return unauthorized("Invalid token", "invalid_token");
  const nowSec = Math.floor((nowMs ?? Date.now()) / 1000);
  if (typeof payload.iat !== "number" || payload.iat > nowSec + LEEWAY_SECONDS) return unauthorized("Invalid token", "invalid_token");
  if (typeof payload.jti !== "string" || payload.jti === "") return unauthorized("Invalid token", "invalid_token");
  const sub = payload.sub;
  if (typeof sub !== "string" || !s.clients.has(sub)) return unauthorized("Invalid token", "invalid_token");
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  // The write scope in a token counts only while the client is still a write client (the token may be older).
  const writeRevoked = requiredScope === WRITE_SCOPE && !s.writeClients?.has(sub);
  if (!scopes.includes(requiredScope) || writeRevoked) {
    return {
      ok: false,
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      message: "Insufficient scope",
      wwwAuthenticate: `Bearer ${REALM}, error="insufficient_scope", scope="${requiredScope}"`,
    };
  }
  return { ok: true, clientId: sub };
}
