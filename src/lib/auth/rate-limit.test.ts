import { describe, expect, it } from "vitest";
import { FailureRateLimiter, UNTRUSTED_CLIENT_KEY, clientIpFromHeaders, trustedProxyHops } from "./rate-limit";

describe("FailureRateLimiter", () => {
  it("blocks after max failures and opens after the window", () => {
    const l = new FailureRateLimiter({ maxFailures: 3, windowMs: 1000 });
    const t = 10_000;
    for (let i = 0; i < 3; i++) {
      expect(l.isAllowed("ip", t)).toBe(true);
      l.recordFailure("ip", t);
    }
    expect(l.isAllowed("ip", t + 10)).toBe(false);
    expect(l.retryAfterSeconds("ip", t + 10)).toBe(1);
    expect(l.isAllowed("other", t)).toBe(true);
    expect(l.isAllowed("ip", t + 1000)).toBe(true);
  });

  it("reset clears the failures", () => {
    const l = new FailureRateLimiter({ maxFailures: 1, windowMs: 1000 });
    l.recordFailure("ip", 0);
    expect(l.isAllowed("ip", 1)).toBe(false);
    l.reset("ip");
    expect(l.isAllowed("ip", 1)).toBe(true);
  });

  it("keeps memory bounded", () => {
    const l = new FailureRateLimiter({ maxFailures: 1, windowMs: 60_000, maxKeys: 3 });
    for (let i = 0; i < 10; i++) l.recordFailure(`ip${i}`, 0);
    expect(l.isAllowed("ip0", 1)).toBe(true); // evicted
    expect(l.isAllowed("ip9", 1)).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("does not trust X-Forwarded-For without trusted proxies (default)", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4" }), 0)).toBe(UNTRUSTED_CLIENT_KEY);
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.9.8.1" }), 0)).toBe(UNTRUSTED_CLIENT_KEY);
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "5.6.7.8" }), 0)).toBe(UNTRUSTED_CLIENT_KEY);
  });

  it("with N trusted proxies takes the N-th entry from the right, so a forged left entry changes nothing", () => {
    // Client forges "10.9.8.N"; the one trusted proxy appends the real peer 203.0.113.7.
    for (let i = 1; i <= 10; i++) {
      expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": `10.9.8.${i}, 203.0.113.7` }), 1)).toBe("203.0.113.7");
    }
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 10.0.0.2" }), 2)).toBe("203.0.113.7");
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.7" }), 2)).toBe(UNTRUSTED_CLIENT_KEY);
    expect(clientIpFromHeaders(new Headers(), 1)).toBe(UNTRUSTED_CLIENT_KEY);
  });

  it("an entry that is not an IP address goes to the shared bucket", () => {
    for (const v of ["not-an-ip", "203.0.113.7:443", "unknown", "x".repeat(200), "203.0.113.999"]) {
      expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": v }), 1)).toBe(UNTRUSTED_CLIENT_KEY);
    }
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "2001:DB8::1" }), 1)).toBe("2001:db8::1");
  });

  it("a blocked client stays blocked when it changes a forged X-Forwarded-For", () => {
    const l = new FailureRateLimiter({ maxFailures: 5, windowMs: 1000 });
    for (let i = 0; i < 5; i++) l.recordFailure(clientIpFromHeaders(new Headers({ "x-forwarded-for": `10.9.8.${i}` }), 0), 0);
    expect(l.isAllowed(clientIpFromHeaders(new Headers({ "x-forwarded-for": "10.9.8.99" }), 0), 1)).toBe(false);
  });

  it("reads TRUSTED_PROXY_HOPS (invalid values = 0)", () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "1" })).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "-1" })).toBe(0);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "x" })).toBe(0);
  });
});
