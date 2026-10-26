/**
 * Server-side admin session helpers (Server Components and Server Actions only).
 * The proxy also checks the cookie, but every admin page and action checks it again here.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminHomeFor, type AdminRole } from "@/lib/auth/admin-users";
import {
  ADMIN_SESSION_COOKIE,
  adminCookieOptions,
  createAdminSessionValue,
  revokeAdminSessionValue,
  verifyAdminSessionValue,
  type AdminSession,
} from "@/lib/auth/admin-session";

export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return verifyAdminSessionValue(store.get(ADMIN_SESSION_COOKIE)?.value);
}

/**
 * Returns the session, or redirects to the login page. With `roles`, a user with another role goes to the first page
 * of that role (the proxy also checks the paths, src/lib/auth/admin-users.ts).
 */
export async function requireAdmin(roles?: readonly AdminRole[]): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  if (roles && !roles.includes(session.role)) redirect(adminHomeFor(session.role));
  return session;
}

/** Server Actions only. */
export async function startAdminSession(username: string): Promise<void> {
  const store = await cookies();
  store.set(ADMIN_SESSION_COOKIE, await createAdminSessionValue(username), adminCookieOptions());
}

/** Server Actions only. Revokes the session (this process), then clears the cookie. */
export async function endAdminSession(): Promise<void> {
  const store = await cookies();
  await revokeAdminSessionValue(store.get(ADMIN_SESSION_COOKIE)?.value);
  store.set(ADMIN_SESSION_COOKIE, "", { ...adminCookieOptions(), maxAge: 0 });
}
