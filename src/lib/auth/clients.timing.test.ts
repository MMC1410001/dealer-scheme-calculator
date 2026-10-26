/** authenticateClient compares exactly once in constant time, also for an unknown client (dummy hash). */
import { describe, expect, it, vi } from "vitest";

const calls: Array<[Buffer, Buffer]> = [];
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    timingSafeEqual: (a: Buffer, b: Buffer) => {
      calls.push([a, b]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

const { authenticateClient, hashSecret } = await import("./clients");

describe("authenticateClient timing", () => {
  it("does one 32-byte constant-time compare for a known and for an unknown client", () => {
    const clients = new Map([["partner", hashSecret("right")]]);
    calls.length = 0;
    expect(authenticateClient(clients, "partner", "wrong")).toBe(false);
    expect(authenticateClient(clients, "nobody", "right")).toBe(false);
    expect(calls).toHaveLength(2);
    for (const [a, b] of calls) {
      expect(a.length).toBe(32);
      expect(b.length).toBe(32);
    }
    // The unknown client is compared against the dummy hash, not against a real client's hash.
    expect(calls[1][1].equals(Buffer.from(hashSecret("right"), "hex"))).toBe(false);
  });
});
