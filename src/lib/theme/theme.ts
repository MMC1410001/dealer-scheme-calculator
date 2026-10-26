/** Admin theme (light / dark). Stored in a cookie so that the server renders the right theme (no white flash). */
export type Theme = "light" | "dark";
export const THEME_COOKIE = "sc_theme";
export const THEME_COOKIE_PATH = "/admin";
export const THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function parseTheme(value: string | undefined | null): Theme {
  return value === "dark" ? "dark" : "light";
}
