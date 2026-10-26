import { describe, expect, it } from "vitest";
import { DENY_FRAMING_CSP, embedCsp, parseAllowedOrigins } from "./frame-policy";

describe("parseAllowedOrigins", () => {
  it("accepts http(s) origins with optional port and drops the rest", () => {
    const r = parseAllowedOrigins("https://dms.example.com, https://SFA.example.com:8443/ ,*, https://*.x.com, ftp://a.com, https://a.com/path, javascript:alert(1), https://dms.example.com");
    expect(r.origins).toEqual(["https://dms.example.com", "https://sfa.example.com:8443"]);
    expect(r.rejected).toEqual(["*", "https://*.x.com", "ftp://a.com", "https://a.com/path", "javascript:alert(1)"]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseAllowedOrigins("").origins).toEqual([]);
    expect(parseAllowedOrigins(undefined).origins).toEqual([]);
  });
});

describe("CSP", () => {
  it("allows only self when the list is empty", () => {
    expect(embedCsp([])).toContain("frame-ancestors 'self';");
  });

  it("lists the configured origins and never *", () => {
    const csp = embedCsp(parseAllowedOrigins("https://dms.example.com,*").origins);
    expect(csp).toContain("frame-ancestors 'self' https://dms.example.com;");
    expect(csp).not.toContain("*");
  });

  it("denies framing elsewhere", () => {
    expect(DENY_FRAMING_CSP).toContain("frame-ancestors 'none'");
  });
});
