import type { NextConfig } from "next";

/**
 * Security headers for /api/**. The proxy (src/proxy.ts) does not run for /api, so that Next.js does not copy
 * API request bodies into memory. The route handlers set the same headers (API_SECURITY_HEADERS in
 * src/server/api/http.ts; a test checks that the values are equal). They are a second layer for API responses.
 * Next.js does not add a header from the route handler when this config already set it, so no header appears twice.
 * Known gap: the Next.js 308 trailing-slash redirect (/api/v1/health/ -> /api/v1/health) is sent before these
 * rules and has no security headers (checked with curl on next start, 17-10-2026). See docs/api-contract.md 10.
 * The Content-Security-Policy rule excludes /api/docs: the Swagger UI page sets its own CSP (src/server/api/docs.ts).
 */
const API_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Cache-Control", value: "no-store" },
];
const API_CSP = { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" };

const nextConfig: NextConfig = {
  // Do not send "X-Powered-By: Next.js".
  poweredByHeader: false,
  // No Next.js dev badge in the corner of the page (it shows in `next dev` only).
  devIndicators: false,
  headers() {
    return Promise.resolve([
      { source: "/api/:path*", headers: [...API_SECURITY_HEADERS] },
      { source: "/api/:path((?!docs$).*)", headers: [API_CSP] },
    ]);
  },
  serverExternalPackages: ["@google-cloud/bigquery", "pg", "ioredis", "exceljs"],
  // Reward choice upload (/admin/choices): files up to 5 MB (UPLOAD_MAX_BYTES) plus the form overhead.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
