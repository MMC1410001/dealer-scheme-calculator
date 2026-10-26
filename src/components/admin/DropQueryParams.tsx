"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Removes the named query parameters from the address bar after each navigation (no new request).
 * A reload then opens the page with their defaults. The links on the page still carry them.
 */
export function DropQueryParams({ names }: { names: string[] }) {
  const key = names.join(",");
  // Runs again on each navigation inside the app (tab and page links), not only on the first load.
  const search = useSearchParams().toString();
  useEffect(() => {
    const url = new URL(window.location.href);
    const found = key.split(",").filter((n) => url.searchParams.has(n));
    if (found.length === 0) return;
    for (const n of found) url.searchParams.delete(n);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [key, search]);
  return null;
}
