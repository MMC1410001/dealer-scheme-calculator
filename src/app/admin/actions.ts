"use server";

import { redirect } from "next/navigation";
import { endAdminSession } from "@/lib/auth/admin-server";

export async function logoutAction(): Promise<void> {
  await endAdminSession();
  redirect("/admin/login");
}
