/**
 * Simple in-memory limit for failed admin logins, per client IP (see clientIpFromHeaders and TRUSTED_PROXY_HOPS).
 * One server process only. If the app runs on several instances, each instance counts on its own.
 * The API rate limits (per IP, token endpoint, per client) are in src/server/ratelimit.ts (Redis, memory fallback).
 */
import { isIP } from "node:net";

export interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  /** Upper limit of tracked keys, so that memory stays small. */
  maxKeys?: number;
}

interface Entry {
  failures: number;
  resetAt: number;
}

export class FailureRateLimiter {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly opts: RateLimiterOptions) {}

  /** True when the key may try again. */
  isAllowed(key: string, now = Date.now()): boolean {
    const e = this.entries.get(key);
    if (!e) return true;
    if (e.resetAt <= now) {
      this.entries.delete(key);
      return true;
    }
    return e.failures < this.opts.maxFailures;
  }

  /** Seconds until the key may try again (0 when allowed). */
  retryAfterSeconds(key: string, now = Date.now()): number {
    if (this.isAllowed(key, now)) return 0;
    const e = this.entries.get(key);
    return e ? Math.max(0, Math.ceil((e.resetAt - now) / 1000)) : 0;
  }

  recordFailure(key: string, now = Date.now()): void {
    const e = this.entries.get(key);
    if (!e || e.resetAt <= now) {
      this.prune(now);
      this.entries.set(key, { failures: 1, resetAt: now + this.opts.windowMs });
      return;
    }
    e.failures += 1;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    const maxKeys = this.opts.maxKeys ?? 10_000;
    if (this.entries.size < maxKeys) return;
    for (const [k, e] of this.entries) if (e.resetAt <= now) this.entries.delete(k);
    // Still full: drop the oldest entries (Map keeps insertion order).
    while (this.entries.size >= maxKeys) {
      const first = this.entries.keys().next();
      if (first.done) break;
      this.entries.delete(first.value);
    }
  }
}

/** Shared limiter for the admin login: 5 failures per IP in 15 minutes. */
export const adminLoginLimiter = new FailureRateLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });

/** TRUSTED_PROXY_HOPS: number of trusted reverse proxies in front of the app (0..10). Default 0. */
export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number((env.TRUSTED_PROXY_HOPS ?? "").trim() || "0");
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 0;
}

/** Limiter key when X-Forwarded-For cannot be trusted: one shared bucket for all clients. */
export const UNTRUSTED_CLIENT_KEY = "untrusted-client";

/**
 * Key for the login limiter and the API per-IP limits: the client IP as seen by the trusted proxies.
 *
 * X-Forwarded-For entries on the LEFT come from the client and can be forged. Each trusted proxy appends the address
 * it received the request from, so with N trusted proxies the real client IP is the N-th entry from the RIGHT.
 * - hops = 0 (no trusted proxy, default): the header is not trusted at all. All clients share one bucket, so that
 *   a forged header cannot reset the limit. (Next.js sets the header from the socket only when it is absent.)
 * - Fewer entries than hops: the request did not pass all proxies; it goes to the shared bucket.
 * - The chosen entry is not an IP address: it goes to the shared bucket.
 *
 * IMPORTANT: the app cannot see the socket peer, so it cannot check that the request came through a proxy.
 * When hops >= 1, the app port must accept connections only from the trusted proxies (firewall or private
 * network). Otherwise a caller that reaches the app directly sets X-Forwarded-For and picks its own bucket.
 */
export function clientIpFromHeaders(h: Headers, hops: number = trustedProxyHops()): string {
  if (hops <= 0) return UNTRUSTED_CLIENT_KEY;
  const entries = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length < hops) return UNTRUSTED_CLIENT_KEY;
  const ip = entries[entries.length - hops];
  return isIP(ip) ? ip.toLowerCase() : UNTRUSTED_CLIENT_KEY;
}
