/** Admin root: applies the saved theme (cookie sc_theme) on the server, so the first paint has the right theme. */
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme/theme";

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div data-theme-root className={`flex min-h-full flex-1 flex-col ${theme === "dark" ? "dark" : ""}`}>
      {children}
    </div>
  );
}
