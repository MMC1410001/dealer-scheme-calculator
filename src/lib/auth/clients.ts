/**
 * OAuth2 clients of the dealer status API (client credentials, RFC 6749 section 4.4).
 *
 * Env AUTH_CLIENTS: a JSON object {"<client_id>": "<sha256 hex of client_secret>"}. Only hashes are stored.
 * A client secret is 32 random bytes in base64url (43 characters), so a fast hash is enough: a leaked
 * settings file does not leak the secrets. `npm run auth:client -- <client_id>` makes a client.
 *
 * Node.js only (node:crypto). Never log a secret or a hash.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** client_id: letters, digits, ".", "_" and "-", 1 to 64 characters. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const SECRET_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The published local example client secret in .env.example. Refused everywhere except APP_ENV=local. */
export const LOCAL_EXAMPLE_CLIENT_SECRET = "local-test-secret";
/** Marker in the published local example JWT_SECRET in .env.example. Refused everywhere except APP_ENV=local. */
export const LOCAL_EXAMPLE_JWT_MARKER = "local-only";

/** SHA-256 of the secret (UTF-8), as lowercase hex. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export const LOCAL_EXAMPLE_SECRET_HASH = hashSecret(LOCAL_EXAMPLE_CLIENT_SECRET);
/** Compared when the client_id is unknown, so that a wrong id takes as long as a wrong secret. */
const UNKNOWN_CLIENT_HASH = createHash("sha256").update("unknown client", "utf8").digest();

export interface ParsedAuthClients {
  /** client_id -> SHA-256 hex, exactly as configured (not checked here; see clientProblems). */
  clients: Map<string, string>;
  /** Set when AUTH_CLIENTS is not a JSON object of strings. The value itself is never included. */
  error: string | null;
}

/** Reads AUTH_CLIENTS. Blank = no clients. */
export function parseAuthClients(raw: string | null | undefined): ParsedAuthClients {
  const text = (raw ?? "").trim();
  if (!text) return { clients: new Map(), error: null };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { clients: new Map(), error: 'AUTH_CLIENTS must be a JSON object {"<client_id>": "<sha256 hex>"}' };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { clients: new Map(), error: 'AUTH_CLIENTS must be a JSON object {"<client_id>": "<sha256 hex>"}' };
  }
  const clients = new Map<string, string>();
  for (const [id, hash] of Object.entries(value as Record<string, unknown>)) {
    if (typeof hash !== "string") {
      return { clients: new Map(), error: "AUTH_CLIENTS: every value must be a string (the SHA-256 hex of the secret)" };
    }
    clients.set(id, hash);
  }
  return { clients, error: null };
}

/** Problems of the client list (format only). Empty when usable. */
export function clientProblems(clients: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [id, hash] of clients) {
    const shown = JSON.stringify(id.slice(0, 64));
    if (!CLIENT_ID_PATTERN.test(id)) problems.push(`AUTH_CLIENTS: client_id ${shown} must be 1-64 of A-Z a-z 0-9 . _ -`);
    if (!SECRET_HASH_PATTERN.test(hash)) problems.push(`AUTH_CLIENTS: the value for ${shown} must be the SHA-256 hex of its secret`);
  }
  return problems;
}

/**
 * True when the secret belongs to the client. Constant time: the hash is always compared once,
 * with a dummy hash for an unknown client, so the response time does not show which ids exist.
 */
export function authenticateClient(clients: ReadonlyMap<string, string>, clientId: string, secret: string): boolean {
  const stored = clients.get(clientId);
  const storedBuf = stored !== undefined && SECRET_HASH_PATTERN.test(stored) ? Buffer.from(stored, "hex") : null;
  const presented = createHash("sha256").update(secret, "utf8").digest();
  const equal = timingSafeEqual(presented, storedBuf ?? UNKNOWN_CLIENT_HASH);
  return equal && storedBuf !== null;
}

/** A new client secret: 32 random bytes, base64url, no padding (43 characters). */
export function newClientSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** A new JWT signing key: 48 random bytes, base64url (64 characters). */
export function newJwtSecret(): string {
  return randomBytes(48).toString("base64url");
}
