/**
 * Admin login and session cookie (CLAUDE.md section 11: simple login with credentials from environment variables).
 * Users: the built-in admin (ADMIN_USERNAME / ADMIN_PASSWORD) and the users of ADMIN_USERS, each with a role
 * (src/lib/auth/admin-users.ts).
 *
 * Runtime-neutral: uses Web Crypto only, so that src/proxy.ts and server code share it.
 * Cookie value: base64url(JSON {u: username, exp: unixSeconds, v: 2, c: credentialTag}) + "." + base64url(HMAC-SHA256(payloadPart, ADMIN_SESSION_SECRET)).
 *
 * Revocation:
 * - A session is valid only for a CURRENT user, and `c` binds it to that user's current password (or password hash)
 *   and role (HMAC with the session secret). A credential or role change ends the user's sessions.
 * - Logout adds the session to an in-memory deny list (this server process only; it is cleared on restart).
 * - Emergency revoke of all sessions on all instances: rotate ADMIN_SESSION_SECRET.
 */

import { DUMMY_HASH, parseAdminUsers, verifyAdminPassword, type AdminRole, type AdminUser } from "./admin-users";

export const ADMIN_SESSION_COOKIE = "sc_admin";
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const ADMIN_COOKIE_PATH = "/admin";
export const ADMIN_SECRET_MIN_LENGTH = 32;
const SESSION_VERSION = 2;
const MAX_COOKIE_LENGTH = 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface AdminSession {
  username: string;
  exp: number;
  role: AdminRole;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

export interface AdminSessionOptions {
  /** Default: process.env.ADMIN_SESSION_SECRET. */
  secret?: string;
  /** Default: process.env.ADMIN_USERNAME / ADMIN_PASSWORD. */
  credentials?: AdminCredentials;
  /** Default: process.env.ADMIN_USERS. The other users (not the built-in admin). */
  adminUsers?: string;
  /** Unix seconds. Default: now. For tests. */
  nowSeconds?: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSecret(secret: string | undefined): string | null {
  const s = secret ?? process.env.ADMIN_SESSION_SECRET ?? "";
  return s.length >= ADMIN_SECRET_MIN_LENGTH ? s : null;
}

function nowOf(opts?: AdminSessionOptions): number {
  return opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** The current users: the built-in admin (options or env) and ADMIN_USERS (options or env). */
function getUsers(opts?: AdminSessionOptions): AdminUser[] {
  const c = opts?.credentials ?? { username: process.env.ADMIN_USERNAME ?? "", password: process.env.ADMIN_PASSWORD ?? "" };
  return parseAdminUsers({ ADMIN_USERNAME: c.username, ADMIN_PASSWORD: c.password, ADMIN_USERS: opts?.adminUsers ?? process.env.ADMIN_USERS }).users;
}

/** Binds a session to the user's current password (or hash) and role. */
async function credentialTag(secret: string, user: AdminUser): Promise<string> {
  const msg = encoder.encode(
    user.builtIn ? `admin-credentials-v1\0${user.username}\0${user.secret}` : `admin-user-v1\0${user.username}\0${user.secret}\0${user.role}`,
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), msg));
  return toBase64Url(mac.slice(0, 16));
}

/* In-memory deny list of logged-out sessions (signature -> exp). Shared through globalThis by all bundles of this process. */
const REVOKED_KEY = Symbol.for("scheme-calculator.admin-session.revoked");
const MAX_REVOKED = 10_000;

function revokedSessions(): Map<string, number> {
  const g = globalThis as unknown as Record<symbol, Map<string, number> | undefined>;
  let m = g[REVOKED_KEY];
  if (!m) {
    m = new Map();
    g[REVOKED_KEY] = m;
  }
  return m;
}

/** Creates a signed session cookie value. Throws when the secret is not configured. */
export async function createAdminSessionValue(username: string, opts?: AdminSessionOptions): Promise<string> {
  const secret = getSecret(opts?.secret);
  if (!secret) throw new Error(`ADMIN_SESSION_SECRET must have at least ${ADMIN_SECRET_MIN_LENGTH} characters.`);
  const user = getUsers(opts).find((x) => x.username === username);
  if (!user) throw new Error("The session user is not a configured admin user.");
  // n: random nonce. Without it, two logins in the same second give the same value, so a logout (which revokes the
  // value) also ends the other session, and a new login right after a logout is already revoked.
  const n = toBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const payload = { u: username, exp: nowOf(opts) + ADMIN_SESSION_TTL_SECONDS, v: SESSION_VERSION, c: await credentialTag(secret, user), n };
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payloadPart)));
  return `${payloadPart}.${toBase64Url(sig)}`;
}

/**
 * Verifies a session cookie value. Returns null when it is missing, malformed, wrongly signed, expired, logged out,
 * or made for other credentials (a user that is gone, or another password or role).
 */
export async function verifyAdminSessionValue(value: string | null | undefined, opts?: AdminSessionOptions): Promise<AdminSession | null> {
  if (!value || value.length > MAX_COOKIE_LENGTH) return null;
  const secret = getSecret(opts?.secret);
  if (!secret) return null;
  const users = getUsers(opts);
  if (users.length === 0) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  if (!BASE64URL_PATTERN.test(payloadPart) || !BASE64URL_PATTERN.test(sigPart)) return null;

  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = fromBase64Url(sigPart);
  } catch {
    return null;
  }
  // The decoder ignores the unused low bits of the last character, so 3 other last characters decode to the same
  // signature. Accept only the canonical spelling: the logout deny list is keyed by the signature text.
  if (toBase64Url(sig) !== sigPart) return null;
  // crypto.subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(payloadPart));
  if (!valid) return null;
  if (revokedSessions().has(sigPart)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decoder.decode(fromBase64Url(payloadPart)));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { u, exp, v, c } = payload as Record<string, unknown>;
  if (v !== SESSION_VERSION || typeof u !== "string" || typeof exp !== "number" || typeof c !== "string") return null;
  const now = nowOf(opts);
  if (exp <= now || exp - now > ADMIN_SESSION_TTL_SECONDS + 60) return null;
  const user = users.find((x) => x.username === u);
  if (!user || c !== (await credentialTag(secret, user))) return null;
  return { username: u, exp, role: user.role };
}

/**
 * Logout: puts a valid session on the deny list of this server process until it expires.
 * Other instances and a restarted process do not know it; rotate ADMIN_SESSION_SECRET to revoke everywhere.
 */
export async function revokeAdminSessionValue(value: string | null | undefined, opts?: AdminSessionOptions): Promise<void> {
  const session = await verifyAdminSessionValue(value, opts);
  if (!session || !value) return;
  const m = revokedSessions();
  const now = nowOf(opts);
  for (const [k, exp] of m) if (exp <= now) m.delete(k);
  while (m.size >= MAX_REVOKED) {
    const first = m.keys().next();
    if (first.done) break;
    m.delete(first.value);
  }
  m.set(value.split(".")[1], session.exp);
}

/** Constant-time comparison of two strings (compares SHA-256 digests, so the length does not leak). */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(da);
  const y = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * Checks a login against the built-in admin (ADMIN_USERNAME / ADMIN_PASSWORD) and ADMIN_USERS.
 * Returns the role, or null. The built-in values and one PBKDF2 hash are always compared, so that the time does not
 * show whether the user exists or which value is wrong.
 */
export async function authenticateAdminUser(
  username: string,
  password: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AdminRole | null> {
  const expectedUser = env.ADMIN_USERNAME ?? "";
  const expectedPass = env.ADMIN_PASSWORD ?? "";
  const builtInConfigured = expectedUser.length > 0 && expectedPass.length > 0;
  const [userOk, passOk] = await Promise.all([safeEqual(username, expectedUser), safeEqual(password, expectedPass)]);
  const other = parseAdminUsers({ ADMIN_USERS: env.ADMIN_USERS }).users.find((u) => u.username === username && u.username !== expectedUser);
  const otherOk = await verifyAdminPassword(password, other?.secret ?? DUMMY_HASH);
  if (builtInConfigured && userOk && passOk) return "ADMIN";
  return other && otherOk ? other.role : null;
}

/** True when the login matches a configured user. */
export async function checkAdminCredentials(
  username: string,
  password: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  return (await authenticateAdminUser(username, password, env)) !== null;
}

export function isAdminLoginConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return parseAdminUsers(env).users.length > 0 && (env.ADMIN_SESSION_SECRET ?? "").length >= ADMIN_SECRET_MIN_LENGTH;
}

/** Cookie attributes for the session cookie. */
export function adminCookieOptions(env: Record<string, string | undefined> = process.env) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    path: ADMIN_COOKIE_PATH,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

/** Accepts only local admin paths as a post-login target (no open redirect). */
export function safeAdminNext(next: string | null | undefined): string {
  if (!next || !(next === "/admin" || next.startsWith("/admin/") || next.startsWith("/admin?")) || next.includes("\\") || next.startsWith("/admin/login")) {
    return "/admin";
  }
  return next;
}
