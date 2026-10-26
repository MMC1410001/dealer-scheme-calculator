/**
 * Admin-area users and roles (Mayur, 22-10-2026: "admin is one user, another user can enter the choices").
 *
 * - The built-in admin: ADMIN_USERNAME / ADMIN_PASSWORD, role ADMIN (as before).
 * - More users: ADMIN_USERS, a JSON object {"<username>": {"role": "ADMIN" | "CHOICES", "password": "<hash>"}}.
 *   The hash is "pbkdf2-sha256:<iterations>:<salt base64url>:<hash base64url>". Only hashes are stored. The separator
 *   is ":", not "$": Next.js expands "$NAME" in .env files, which would break a "$"-separated hash.
 *   `npm run admin:user -- <username> [ADMIN|CHOICES]` makes a user with a random password.
 * - Role CHOICES may use only the dealer pages and the reward choices page (canAccessAdminPath).
 *
 * Runtime-neutral: Web Crypto only (the proxy and server code share it).
 */

export type AdminRole = "ADMIN" | "CHOICES";
export const ADMIN_ROLES: readonly AdminRole[] = ["ADMIN", "CHOICES"];
export const ADMIN_USERNAME_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/;
export const PBKDF2_ITERATIONS = 600_000;
const HASH_PATTERN = /^pbkdf2-sha256:(\d{4,7}):([A-Za-z0-9_-]{16,}):([A-Za-z0-9_-]{43})$/;

export interface AdminUser {
  username: string;
  role: AdminRole;
  /** Built-in admin: the plain password from ADMIN_PASSWORD. Other users: the PBKDF2 hash. */
  secret: string;
  builtIn: boolean;
}

export interface ParsedAdminUsers {
  users: AdminUser[];
  /** Entries that were ignored, with the reason. Never contains a password or a hash. */
  problems: string[];
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The built-in admin and the users of ADMIN_USERS. A name that is used twice keeps its first entry. */
export function parseAdminUsers(env: Record<string, string | undefined> = process.env): ParsedAdminUsers {
  const users: AdminUser[] = [];
  const problems: string[] = [];
  const builtInName = env.ADMIN_USERNAME ?? "";
  if (builtInName && env.ADMIN_PASSWORD) users.push({ username: builtInName, role: "ADMIN", secret: env.ADMIN_PASSWORD, builtIn: true });

  const raw = (env.ADMIN_USERS ?? "").trim();
  if (!raw) return { users, problems };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { users, problems: ['ADMIN_USERS must be a JSON object {"<username>": {"role": "...", "password": "<hash>"}}'] };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { users, problems: ['ADMIN_USERS must be a JSON object {"<username>": {"role": "...", "password": "<hash>"}}'] };
  }
  for (const [username, entry] of Object.entries(value as Record<string, unknown>)) {
    const shown = JSON.stringify(username.slice(0, 64));
    const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    if (!ADMIN_USERNAME_PATTERN.test(username)) problems.push(`ADMIN_USERS: user ${shown} must be 1-64 of A-Z a-z 0-9 . _ @ -`);
    else if (users.some((u) => u.username === username)) problems.push(`ADMIN_USERS: user ${shown} is already defined (ignored)`);
    else if (!ADMIN_ROLES.includes(e.role as AdminRole)) problems.push(`ADMIN_USERS: user ${shown} needs role ADMIN or CHOICES`);
    else if (typeof e.password !== "string" || !HASH_PATTERN.test(e.password)) {
      problems.push(`ADMIN_USERS: user ${shown} needs a password hash from npm run admin:user`);
    } else users.push({ username, role: e.role as AdminRole, secret: e.password, builtIn: false });
  }
  return { users, problems };
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** The stored form of a password: "pbkdf2-sha256:<iterations>:<salt>:<hash>". */
export async function hashAdminPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  return `pbkdf2-sha256:${iterations}:${toBase64Url(salt)}:${toBase64Url(await pbkdf2(password, salt, iterations))}`;
}

/** A dummy hash, so that an unknown user name takes as long as a wrong password. */
const DUMMY_HASH = `pbkdf2-sha256:${PBKDF2_ITERATIONS}:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

/** True when the password matches the stored hash (constant-time comparison of the derived bits). */
export async function verifyAdminPassword(password: string, stored: string): Promise<boolean> {
  const m = HASH_PATTERN.exec(stored);
  if (!m) return false;
  const expected = fromBase64Url(m[3]);
  const got = await pbkdf2(password, fromBase64Url(m[2]), Number(m[1]));
  let diff = expected.length ^ got.length;
  for (let i = 0; i < Math.min(expected.length, got.length); i++) diff |= expected[i] ^ got[i];
  return diff === 0;
}

/** A new random password: 18 bytes, base64url (24 characters). */
export function newAdminPassword(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

/** Paths that a role may open. ADMIN: all of /admin. CHOICES: the dealer pages and the reward choices page. */
export function canAccessAdminPath(role: AdminRole, pathname: string): boolean {
  if (role === "ADMIN") return true;
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return under("/admin/choices") || under("/admin/dealers");
}

/** The first page after login for a role. */
export function adminHomeFor(role: AdminRole): string {
  return role === "ADMIN" ? "/admin" : "/admin/choices";
}

export { DUMMY_HASH };
