import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin-server";
import { safeAdminNext } from "@/lib/auth/admin-session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Admin login | Scheme Calculator" };

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawNext = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = safeAdminNext(rawNext);
  if (await getAdminSession()) redirect(next);

  return (
    <main className="flex flex-1 items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold text-gray-900">Admin login</h1>
        <p className="mb-5 text-sm text-gray-600">Acme Paints Scheme Calculator</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
