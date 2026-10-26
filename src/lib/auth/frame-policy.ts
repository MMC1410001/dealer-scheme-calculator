/**
 * Frame (iframe embedding) policy. CLAUDE.md section 10: only the client's SAP Commerce / SFA domains
 * may frame /embed. The list comes from EMBED_ALLOWED_ORIGINS. Never allow all origins.
 */

/** Accepts "https://host", "https://host:port", "http://host[:port]". No path, no wildcard. */
const ORIGIN_PATTERN = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export interface ParsedOrigins {
  origins: string[];
  rejected: string[];
}

export function parseAllowedOrigins(raw: string | null | undefined): ParsedOrigins {
  const origins: string[] = [];
  const rejected: string[] = [];
  for (const part of (raw ?? "").split(/[,\s]+/)) {
    const v = part.trim().replace(/\/+$/, "");
    if (!v) continue;
    if (ORIGIN_PATTERN.test(v) && !v.includes("..")) {
      const lower = v.toLowerCase();
      if (!origins.includes(lower)) origins.push(lower);
    } else {
      rejected.push(v);
    }
  }
  return { origins, rejected };
}

/** CSP for /embed: only 'self' and the configured origins may frame the page. */
export function embedCsp(origins: string[]): string {
  const ancestors = ["'self'", ...origins].join(" ");
  return `frame-ancestors ${ancestors}; object-src 'none'; base-uri 'self'; form-action 'self'`;
}

/** CSP for every other route: no framing at all. */
export const DENY_FRAMING_CSP = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
