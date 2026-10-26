"use client";

/** Light / dark switch for the admin area. Changes the class on the admin root at once and saves the cookie. */
import { useState } from "react";
import { MoonIcon, SunIcon } from "@/components/icons";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, THEME_COOKIE_PATH, type Theme } from "@/lib/theme/theme";

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const dark = theme === "dark";
  const toggle = () => {
    const next: Theme = dark ? "light" : "dark";
    setTheme(next);
    document.querySelector("[data-theme-root]")?.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE}=${next}; Path=${THEME_COOKIE_PATH}; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
  };
  const label = dark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid h-9 w-9 place-items-center rounded-md border border-gray-300 bg-white text-gray-700 outline-none hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-brand-green/50"
    >
      {dark ? <SunIcon className="h-4.5 w-4.5" /> : <MoonIcon className="h-4.5 w-4.5" />}
    </button>
  );
}
