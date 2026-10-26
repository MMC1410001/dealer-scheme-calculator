"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { authenticateAdminUser, isAdminLoginConfigured, safeAdminNext } from "@/lib/auth/admin-session";
import { adminHomeFor, canAccessAdminPath } from "@/lib/auth/admin-users";
import { startAdminSession } from "@/lib/auth/admin-server";
import { adminLoginLimiter, clientIpFromHeaders } from "@/lib/auth/rate-limit";

export interface LoginState {
  error: string | null;
}

const GENERIC_ERROR = "The username or password is not correct.";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ip = clientIpFromHeaders(await headers());
  if (!adminLoginLimiter.isAllowed(ip)) {
    return { error: "Too many attempts. Try again later." };
  }

  if (!isAdminLoginConfigured()) {
    console.error("[admin] Login is not configured (ADMIN_USERNAME / ADMIN_PASSWORD or ADMIN_USERS, ADMIN_SESSION_SECRET >= 32 chars).");
    return { error: "Login is not available. Contact the administrator." };
  }

  const username = String(formData.get("username") ?? "").slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 200);
  const role = await authenticateAdminUser(username, password);
  if (!role) {
    adminLoginLimiter.recordFailure(ip);
    return { error: GENERIC_ERROR };
  }

  adminLoginLimiter.reset(ip);
  await startAdminSession(username);
  const next = safeAdminNext(String(formData.get("next") ?? ""));
  redirect(canAccessAdminPath(role, next.split("?")[0]) ? next : adminHomeFor(role));
}
