import { describe, expect, it } from "vitest";
import { hashAdminPassword } from "./admin-users";
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminCookieOptions,
  authenticateAdminUser,
  checkAdminCredentials,
  createAdminSessionValue,
  isAdminLoginConfigured,
  revokeAdminSessionValue,
  safeAdminNext,
  verifyAdminSessionValue,
} from "./admin-session";

const secret = "k".repeat(40);
const now = 1_790_000_000;
const credentials = { username: "admin", password: "correct horse" };

describe("admin session cookie", () => {
  it("round-trips and expires after 8 hours", async () => {
    const v = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now });
    expect(await verifyAdminSessionValue(v, { secret, credentials, nowSeconds: now + 60 })).toEqual({ username: "admin", exp: now + ADMIN_SESSION_TTL_SECONDS, role: "ADMIN" });
    expect(await verifyAdminSessionValue(v, { secret, credentials, nowSeconds: now + ADMIN_SESSION_TTL_SECONDS })).toBeNull();
  });

  it("rejects a wrong secret, tampering and garbage", async () => {
    const v = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now });
    expect(await verifyAdminSessionValue(v, { secret: "z".repeat(40), credentials, nowSeconds: now })).toBeNull();
    const [p, s] = v.split(".");
    const flipped = s.slice(0, -2) + (s.at(-2) === "A" ? "B" : "A") + s.at(-1);
    expect(await verifyAdminSessionValue(`${p}.${flipped}`, { secret, credentials, nowSeconds: now })).toBeNull();
    const other = Buffer.from(JSON.stringify({ u: "root", exp: now + 100, v: 2, c: "x" })).toString("base64url");
    expect(await verifyAdminSessionValue(`${other}.${s}`, { secret, credentials, nowSeconds: now })).toBeNull();
    for (const g of [undefined, "", "abc", "a.b.c", "!!.??"]) {
      expect(await verifyAdminSessionValue(g, { secret, credentials, nowSeconds: now })).toBeNull();
    }
  });

  it("rejects everything when the secret is too short", async () => {
    await expect(createAdminSessionValue("admin", { secret: "short", credentials })).rejects.toThrow(/32/);
    const v = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now });
    expect(await verifyAdminSessionValue(v, { secret: "short", credentials, nowSeconds: now })).toBeNull();
  });

  it("ends all sessions when the username or the password changes", async () => {
    const v = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now });
    expect(await verifyAdminSessionValue(v, { secret, credentials, nowSeconds: now })).not.toBeNull();
    expect(await verifyAdminSessionValue(v, { secret, credentials: { username: "new-admin", password: "correct horse" }, nowSeconds: now })).toBeNull();
    expect(await verifyAdminSessionValue(v, { secret, credentials: { username: "admin", password: "rotated" }, nowSeconds: now })).toBeNull();
    expect(await verifyAdminSessionValue(v, { secret, credentials: { username: "", password: "" }, nowSeconds: now })).toBeNull();
    await expect(createAdminSessionValue("someone-else", { secret, credentials, nowSeconds: now })).rejects.toThrow();
  });

  it("two logins in the same second get different sessions; a logout ends only its own session", async () => {
    const a = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now });
    const b = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now });
    expect(a).not.toBe(b);
    await revokeAdminSessionValue(a, { secret, credentials, nowSeconds: now });
    expect(await verifyAdminSessionValue(a, { secret, credentials, nowSeconds: now })).toBeNull();
    expect(await verifyAdminSessionValue(b, { secret, credentials, nowSeconds: now })).not.toBeNull();
  });

  it("logout revokes the session (a saved cookie no longer works)", async () => {
    const v = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now + 5 });
    const other = await createAdminSessionValue("admin", { secret, credentials, nowSeconds: now + 6 });
    expect(await verifyAdminSessionValue(v, { secret, credentials, nowSeconds: now + 10 })).not.toBeNull();
    await revokeAdminSessionValue(v, { secret, credentials, nowSeconds: now + 10 });
    expect(await verifyAdminSessionValue(v, { secret, credentials, nowSeconds: now + 11 })).toBeNull();
    expect(await verifyAdminSessionValue(other, { secret, credentials, nowSeconds: now + 11 })).not.toBeNull();
  });

  it("accepts only the canonical signature: another last character never passes, also after a logout", async () => {
    const opts = { secret, credentials, nowSeconds: now + 20 };
    const v = await createAdminSessionValue("admin", opts);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    // 32-byte HMAC = 43 characters; the last one carries 4 data bits, so 3 other characters decode to the same bytes.
    const others = [...alphabet.replace(v.slice(-1), "")].map((c) => `${v.slice(0, -1)}${c}`);
    for (const o of others) expect(await verifyAdminSessionValue(o, opts)).toBeNull();
    await revokeAdminSessionValue(v, opts);
    expect(await verifyAdminSessionValue(v, opts)).toBeNull();
    for (const o of others) expect(await verifyAdminSessionValue(o, opts)).toBeNull();
  });

  it("sets safe cookie options", () => {
    expect(adminCookieOptions({ NODE_ENV: "production" })).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/admin", maxAge: 28800 });
    expect(adminCookieOptions({ NODE_ENV: "development" }).secure).toBe(false);
  });
});

describe("admin credentials", () => {
  const env = { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "correct horse", ADMIN_SESSION_SECRET: secret };

  it("accepts only the exact credentials", async () => {
    expect(await checkAdminCredentials("admin", "correct horse", env)).toBe(true);
    expect(await checkAdminCredentials("admin", "correct hors", env)).toBe(false);
    expect(await checkAdminCredentials("Admin", "correct horse", env)).toBe(false);
    expect(await checkAdminCredentials("", "", env)).toBe(false);
  });

  it("rejects all logins when credentials are not configured", async () => {
    expect(await checkAdminCredentials("", "", {})).toBe(false);
    expect(await checkAdminCredentials("admin", "", { ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "" })).toBe(false);
    expect(isAdminLoginConfigured({})).toBe(false);
    expect(isAdminLoginConfigured({ ...env, ADMIN_SESSION_SECRET: "short" })).toBe(false);
    expect(isAdminLoginConfigured(env)).toBe(true);
  });
});

describe("safeAdminNext", () => {
  it("allows only local admin paths", () => {
    expect(safeAdminNext("/admin/runs")).toBe("/admin/runs");
    expect(safeAdminNext("/admin")).toBe("/admin");
    expect(safeAdminNext("/admin?x=1")).toBe("/admin?x=1");
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/adminx", "/admin/login", "/admin\\..\\x", "/embed"]) {
      expect(safeAdminNext(bad)).toBe("/admin");
    }
  });
});

describe("more users with roles (ADMIN_USERS)", () => {
  const ITER = 1000; // fast hashes for the test
  let adminUsers = "";
  const env = () => ({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "correct horse", ADMIN_SESSION_SECRET: secret, ADMIN_USERS: adminUsers });

  it("logs in a CHOICES user by its hashed password and binds the session to the hash and the role", async () => {
    adminUsers = JSON.stringify({ ops1: { role: "CHOICES", password: await hashAdminPassword("ops-pass", ITER) } });
    expect(await authenticateAdminUser("ops1", "ops-pass", env())).toBe("CHOICES");
    expect(await authenticateAdminUser("ops1", "wrong", env())).toBeNull();
    expect(await authenticateAdminUser("nobody", "ops-pass", env())).toBeNull();
    expect(await authenticateAdminUser("admin", "correct horse", env())).toBe("ADMIN");
    expect(isAdminLoginConfigured({ ADMIN_USERS: adminUsers, ADMIN_SESSION_SECRET: secret })).toBe(true);

    const v = await createAdminSessionValue("ops1", { secret, credentials, adminUsers, nowSeconds: now });
    expect(await verifyAdminSessionValue(v, { secret, credentials, adminUsers, nowSeconds: now })).toMatchObject({ username: "ops1", role: "CHOICES" });
    const asAdmin = adminUsers.replace('"CHOICES"', '"ADMIN"');
    expect(await verifyAdminSessionValue(v, { secret, credentials, adminUsers: asAdmin, nowSeconds: now })).toBeNull();
    const newHash = JSON.stringify({ ops1: { role: "CHOICES", password: await hashAdminPassword("ops-pass", ITER) } });
    expect(await verifyAdminSessionValue(v, { secret, credentials, adminUsers: newHash, nowSeconds: now })).toBeNull();
    expect(await verifyAdminSessionValue(v, { secret, credentials, adminUsers: "", nowSeconds: now })).toBeNull();
  });

  it("does not let ADMIN_USERS replace the built-in admin", async () => {
    adminUsers = JSON.stringify({ admin: { role: "ADMIN", password: await hashAdminPassword("other", ITER) } });
    expect(await authenticateAdminUser("admin", "other", env())).toBeNull();
    expect(await authenticateAdminUser("admin", "correct horse", env())).toBe("ADMIN");
  });
});
