import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin-server";
import { logoutAction } from "../actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { LogoutIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/admin/ThemeToggle";
import { THEME_COOKIE, parseTheme } from "@/lib/theme/theme";
import { cookies } from "next/headers";

const ROLE_LABELS: Record<string, string> = { ADMIN: "Administrator", CHOICES: "Reward choices" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const isAdmin = session.role === "ADMIN";
  const links = [
    ...(isAdmin ? [{ href: "/admin", label: "Report" }] : []),
    { href: "/admin/dealers", label: "Dealers" },
    { href: "/admin/choices", label: "Reward choices" },
    ...(isAdmin ? [{ href: "/admin/runs", label: "Sync runs" }] : []),
  ];
  return (
    <div className="flex min-h-full flex-1 flex-col bg-gray-50">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
          <Link
            href={isAdmin ? "/admin" : "/admin/choices"}
            className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50"
          >
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-lg bg-brand-green-dark text-sm font-bold text-white">
              SC
            </span>
            <span className="leading-tight">
              <span className="block font-semibold text-gray-900">Scheme Calculator</span>
              <span className="block text-xs text-gray-500">Acme Paints · Admin</span>
            </span>
          </Link>

          <form action={logoutAction} className="ml-auto flex items-center gap-3 sm:order-last">
            <ThemeToggle initial={theme} />
            <span className="flex items-center gap-2" title={`Signed in as ${session.username}`}>
              <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-brand-violet/10 text-sm font-semibold text-brand-violet uppercase">
                {session.username.slice(0, 1)}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-sm font-medium text-gray-900">{session.username}</span>
                <span className="block text-xs text-gray-500">{ROLE_LABELS[session.role] ?? session.role}</span>
              </span>
              <span className="sr-only sm:hidden">Signed in as {session.username}</span>
            </span>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-green/50"
            >
              <LogoutIcon className="h-4 w-4" />
              Log out
            </button>
          </form>

          {/* Own row on phones, between brand and user on wider screens. */}
          <div className="w-full sm:w-auto">
            <AdminNav links={links} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
