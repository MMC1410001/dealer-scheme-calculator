"use client";

/** Admin top navigation. Client component only to mark the current page (usePathname). */
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNav({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  // "/admin" is active only on the report itself; the other links also on their sub-pages (/admin/dealers/[code]).
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Admin" className="-mx-1 flex gap-1 overflow-x-auto text-sm">
      {links.map((l) => {
        const active = isActive(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-brand-green/50 ${
              active ? "bg-brand-green/10 font-semibold text-brand-green-dark" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
