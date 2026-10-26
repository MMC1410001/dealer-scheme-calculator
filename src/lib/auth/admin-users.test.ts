import { describe, expect, it } from "vitest";
import { adminHomeFor, canAccessAdminPath, hashAdminPassword, parseAdminUsers, verifyAdminPassword } from "./admin-users";

describe("admin users", () => {
  it("hashes and verifies passwords (PBKDF2-SHA256)", async () => {
    const h = await hashAdminPassword("s3cret", 1000);
    expect(h).toMatch(/^pbkdf2-sha256:1000:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/);
    expect(await verifyAdminPassword("s3cret", h)).toBe(true);
    expect(await verifyAdminPassword("s3cret!", h)).toBe(false);
    expect(await verifyAdminPassword("s3cret", "plain-text")).toBe(false);
    expect(await hashAdminPassword("s3cret", 1000)).not.toBe(h); // random salt
  });

  it("parses the built-in admin and ADMIN_USERS, and reports bad entries without secrets", async () => {
    const h = await hashAdminPassword("x", 1000);
    const r = parseAdminUsers({
      ADMIN_USERNAME: "admin",
      ADMIN_PASSWORD: "pw",
      ADMIN_USERS: JSON.stringify({ ops1: { role: "CHOICES", password: h }, "bad name": { role: "CHOICES", password: h }, ops2: { role: "OWNER", password: h }, ops3: { role: "ADMIN", password: "plain" } }),
    });
    expect(r.users.map((u) => [u.username, u.role, u.builtIn])).toEqual([
      ["admin", "ADMIN", true],
      ["ops1", "CHOICES", false],
    ]);
    expect(r.problems).toHaveLength(3);
    expect(r.problems.join(" ")).not.toContain("plain");
    expect(parseAdminUsers({ ADMIN_USERS: "[1]" }).problems).toHaveLength(1);
    expect(parseAdminUsers({}).users).toEqual([]);
  });

  it("limits the CHOICES role to the dealer pages and the reward choices page", () => {
    for (const p of ["/admin", "/admin/runs", "/admin/choices", "/admin/dealers/D1"]) expect(canAccessAdminPath("ADMIN", p)).toBe(true);
    for (const p of ["/admin/choices", "/admin/dealers", "/admin/dealers/D1"]) expect(canAccessAdminPath("CHOICES", p)).toBe(true);
    for (const p of ["/admin", "/admin/runs", "/admin/choicesx", "/admin/dealersx"]) expect(canAccessAdminPath("CHOICES", p)).toBe(false);
    expect([adminHomeFor("ADMIN"), adminHomeFor("CHOICES")]).toEqual(["/admin", "/admin/choices"]);
  });
});
