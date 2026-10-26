import { describe, expect, it } from "vitest";
import {
  LOCAL_EXAMPLE_SECRET_HASH,
  authenticateClient,
  clientProblems,
  hashSecret,
  newClientSecret,
  newJwtSecret,
  parseAuthClients,
} from "./clients";
import { newClientCommand, newJwtSecretCommand } from "./cli";

describe("parseAuthClients", () => {
  it("reads a JSON object; blank means no clients", () => {
    expect(parseAuthClients(`{"partner": "${"a".repeat(64)}"}`)).toEqual({ clients: new Map([["partner", "a".repeat(64)]]), error: null });
    for (const raw of ["", " ", undefined, null]) expect(parseAuthClients(raw)).toEqual({ clients: new Map(), error: null });
  });

  it("gives an error (without the value) for JSON that is not an object of strings", () => {
    for (const raw of ["{bad", "[]", '"x"', '{"a": 1}', "null"]) {
      const p = parseAuthClients(raw);
      expect(p.error).toMatch(/AUTH_CLIENTS/);
      expect(p.clients.size).toBe(0);
    }
  });
});

describe("clientProblems", () => {
  it("checks the client_id format and the SHA-256 hex format", () => {
    expect(clientProblems(new Map([["partner", hashSecret("x")]]))).toEqual([]);
    const p = clientProblems(
      new Map([
        ["bad id!", hashSecret("x")],
        ["partner", "plain-secret"],
        ["UP", "A".repeat(64)],
      ]),
    );
    expect(p).toEqual([
      'AUTH_CLIENTS: client_id "bad id!" must be 1-64 of A-Z a-z 0-9 . _ -',
      'AUTH_CLIENTS: the value for "partner" must be the SHA-256 hex of its secret',
      'AUTH_CLIENTS: the value for "UP" must be the SHA-256 hex of its secret',
    ]);
  });
});

describe("authenticateClient", () => {
  const clients = new Map([["partner", hashSecret("right")]]);
  it("accepts the right secret only", () => {
    expect(authenticateClient(clients, "partner", "right")).toBe(true);
    expect(authenticateClient(clients, "partner", "wrong")).toBe(false);
    expect(authenticateClient(clients, "nobody", "right")).toBe(false);
    expect(authenticateClient(clients, "__proto__", "right")).toBe(false);
    expect(authenticateClient(new Map([["bad", "not-hex"]]), "bad", "x")).toBe(false);
  });

  it("knows the published local example hash (sha256 of local-test-secret)", () => {
    expect(LOCAL_EXAMPLE_SECRET_HASH).toBe("0b1f90b824765bd860b58a3ebc0396a4f6f4c4ad8f1eed10135c0cb6cf3bd171");
  });
});

describe("secrets and CLI", () => {
  it("makes 43-character client secrets and 64-character JWT keys", () => {
    expect(newClientSecret()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newJwtSecret()).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(newClientSecret()).not.toBe(newClientSecret());
  });

  it("auth:client prints a secret whose hash is in the AUTH_CLIENTS entry", () => {
    const out: string[] = [];
    expect(newClientCommand(["partner"], (l) => out.push(l), () => undefined)).toBe(0);
    const text = out.join("\n");
    const secret = text.split("client_secret: ")[1].split(/\s/)[0];
    expect(secret.length).toBeGreaterThanOrEqual(43);
    const entry = JSON.parse(out[out.length - 1].trim()) as Record<string, string>;
    expect(entry).toEqual({ partner: hashSecret(secret) });
  });

  it("auth:client refuses a bad client_id with exit code 2", () => {
    const err: string[] = [];
    expect(newClientCommand(["bad id"], () => undefined, (l) => err.push(l))).toBe(2);
    expect(newClientCommand([], () => undefined, (l) => err.push(l))).toBe(2);
    expect(err[0]).toMatch(/^Usage: npm run auth:client/);
  });

  it("auth:jwt-secret prints one key", () => {
    const out: string[] = [];
    expect(newJwtSecretCommand([], (l) => out.push(l))).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBeGreaterThanOrEqual(32);
    expect(newJwtSecretCommand(["x"], () => undefined, () => undefined)).toBe(2);
  });
});
