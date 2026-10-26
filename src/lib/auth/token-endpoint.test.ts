/** Token endpoint (same cases as the reference API tests/test_auth.py, token endpoint part). */
import { describe, expect, it } from "vitest";
import { decodeJwt } from "jose";
import { hashSecret } from "./clients";
import { AUDIENCE, ISSUER, SCOPE, WRITE_SCOPE, verifyBearer } from "./jwt";
import { handleTokenRequest, type TokenDeps, type TokenRequestInput } from "./token-endpoint";

const SECRET = "partner-client-secret-for-tests";
const KEY = "k".repeat(40);
const CLIENTS = new Map([["partner", hashSecret(SECRET)]]);
const DEPS: TokenDeps = { enabled: true, clients: CLIENTS, jwtSecret: KEY, ttlSeconds: 3600 };

const FORM = "application/x-www-form-urlencoded";
const enc = new TextEncoder();

function req(body: string | Uint8Array, contentType: string | null = FORM, authorization: string | null = null): TokenRequestInput {
  const bytes = typeof body === "string" ? enc.encode(body) : body;
  return { authorization, contentType, readBody: () => Promise.resolve({ ok: true, bytes }) };
}

function form(params: Record<string, string>): string {
  return new URLSearchParams({ grant_type: "client_credentials", ...params }).toString();
}

function basic(id: string, secret: string): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

describe("token endpoint: success", () => {
  it("form request returns a Bearer token for one hour, with no-store and Pragma", async () => {
    const r = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET })), DEPS);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: SCOPE });
    expect(r.headers).toEqual({ "Cache-Control": "no-store", Pragma: "no-cache" });
    const c = decodeJwt(String(r.body.access_token));
    expect(c).toMatchObject({ sub: "partner", iss: ISSUER, aud: AUDIENCE });
    expect(c.exp! - c.iat!).toBe(3600);
    const check = await verifyBearer(`Bearer ${String(r.body.access_token)}`, { secret: KEY, previousSecret: null, ttlSeconds: 3600, clients: CLIENTS });
    expect(check).toEqual({ ok: true, clientId: "partner" });
    expect(r.log).toEqual({ evt: "token_issued", clientId: "partner", error: null });
  });

  it("accepts a JSON body and Basic auth", async () => {
    const byJson = await handleTokenRequest(
      req(JSON.stringify({ grant_type: "client_credentials", client_id: "partner", client_secret: SECRET }), "application/json; charset=utf-8"),
      DEPS,
    );
    const byBasic = await handleTokenRequest(req(form({ scope: SCOPE }), FORM, basic("partner", SECRET)), DEPS);
    expect([byJson.status, byBasic.status]).toEqual([200, 200]);
  });

  it("decodes form-encoded Basic credentials (RFC 6749 2.3.1)", async () => {
    const clients = new Map([["a b", hashSecret("s+%/x")]]);
    const r = await handleTokenRequest(req(form({}), FORM, basic("a+b", "s%2B%25%2Fx")), { ...DEPS, clients });
    expect(r.status).toBe(200);
  });

  it.each(["", " ", SCOPE])("accepts a blank or the default scope (%j)", async (scope) => {
    const r = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET, scope })), DEPS);
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe(SCOPE);
  });
});

describe("token endpoint: 401 invalid_client", () => {
  it.each([
    [{ client_id: "partner", client_secret: "wrong" }],
    [{ client_id: "nobody", client_secret: SECRET }],
    [{ client_id: "partner" }],
    [{}],
  ])("bad client credentials %j", async (creds) => {
    const r = await handleTokenRequest(req(form(creds)), DEPS);
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: "invalid_client", error_description: "Client authentication failed" });
    // Credentials in the body: no Basic challenge (RFC 6749 section 5.2), so a browser opens no sign-in dialog.
    expect(r.headers["WWW-Authenticate"]).toBeUndefined();
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(r.log.evt).toBe("token_refused");
  });

  it.each([basic("partner", "wrong"), "Basic !!!", "Basic ", "Bearer abc", `Basic ${Buffer.from("no-colon").toString("base64")}`, "Basic kéy", `Basic ${Buffer.from([0xff, 0x3a, 0x41]).toString("base64")}`])(
    "wrong or malformed Basic auth %j",
    async (auth) => {
      const r = await handleTokenRequest(req(form({}), FORM, auth), DEPS);
      expect(r.status).toBe(401);
      expect(r.body.error).toBe("invalid_client");
      // The caller used the Authorization header: the 401 has the Basic challenge.
      expect(r.headers["WWW-Authenticate"]).toBe('Basic realm="scheme-calculator"');
    },
  );

  it("refuses every client when auth is off", async () => {
    const r = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET })), { ...DEPS, enabled: false });
    expect(r.status).toBe(401);
  });
});

describe("token endpoint: 400", () => {
  const cases: Array<[string, TokenRequestInput, string]> = [
    ["no grant_type", req(new URLSearchParams({ client_id: "partner", client_secret: SECRET }).toString()), "invalid_request"],
    ["password grant", req(form({ grant_type: "password", client_id: "partner", client_secret: SECRET })), "unsupported_grant_type"],
    ["other scope", req(form({ client_id: "partner", client_secret: SECRET, scope: "schemes:write" })), "invalid_scope"],
    ["JSON array", req('["grant_type"]', "application/json"), "invalid_request"],
    ["JSON number value", req('{"grant_type":"client_credentials","client_id":1}', "application/json"), "invalid_request"],
    ["JSON nested object", req('{"grant_type":{"a":"b"}}', "application/json"), "invalid_request"],
    ["broken JSON", req("{not json", "application/json"), "invalid_request"],
    ["text/plain", req("grant_type=client_credentials", "text/plain"), "invalid_request"],
    ["no Content-Type", req("grant_type=client_credentials", null), "invalid_request"],
    ["repeated form parameter", req("grant_type=client_credentials&grant_type=client_credentials&client_id=partner&client_secret=x"), "invalid_request"],
    ["bad percent-encoding", req("grant_type=client_credentials&client_id=%E0%A4"), "invalid_request"],
    ["body not UTF-8", req(new Uint8Array([0x67, 0x3d, 0xff])), "invalid_request"],
  ];
  it.each(cases)("%s", async (_n, input, error) => {
    const r = await handleTokenRequest(input, DEPS);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(error);
    expect(r.headers.Pragma).toBe("no-cache");
  });

  it.each([
    `{"grant_type": "client_credentials", "client_id": "partner", "client_secret": "bad", "client_secret": "${SECRET}"}`,
    `{"grant_type": "client_credentials", "client_id": "x", "client_id": "partner", "client_secret": "${SECRET}"}`,
    `{"grant_type": "password", "grant_type": "client_credentials", "client_id": "partner", "client_secret": "${SECRET}"}`,
    `{"grant_type": "client_credentials", "client_id": "partner", "client_secret": "${SECRET}", "x": {"a": "1", "a": "2"}}`,
  ])("a JSON parameter sent twice gets 400, like a form one: %s", async (raw) => {
    const r = await handleTokenRequest(req(raw, "application/json"), DEPS);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "invalid_request", error_description: "A parameter was sent more than once" });
  });

  it("a lone surrogate (\\ud800) in JSON gets 400, not 500", async () => {
    const raw = '{"grant_type": "client_credentials", "client_id": "partner", "client_secret": "\\ud800"}';
    const r = await handleTokenRequest(req(raw, "application/json"), DEPS);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "invalid_request", error_description: "Parameters must be valid UTF-8" });
  });

  it("credentials in Basic auth and in the body together are refused", async () => {
    const r = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET }), FORM, basic("partner", SECRET)), DEPS);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_request");
  });

  it("a body over the limit gets 413", async () => {
    const r = await handleTokenRequest(
      { authorization: null, contentType: FORM, readBody: () => Promise.resolve({ ok: false, reason: "TOO_LARGE" }) },
      DEPS,
    );
    expect(r.status).toBe(413);
    expect(r.body.error).toBe("invalid_request");
  });

  it("never puts the secret in the log context", async () => {
    const r = await handleTokenRequest(req(form({ client_id: "partner", client_secret: "wrong-secret-value" })), DEPS);
    expect(JSON.stringify(r.log)).not.toContain("wrong-secret-value");
    expect(r.log.clientId).toBe("partner");
  });
});

describe("token endpoint: write scope (AUTH_WRITE_CLIENTS)", () => {
  const WRITE_DEPS: TokenDeps = { ...DEPS, writeClients: new Set(["partner"]) };
  const scopeOf = (t: unknown) => decodeJwt(String(t)).scope;

  it("gives a write client both scopes by default, or only the requested ones", async () => {
    const all = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET })), WRITE_DEPS);
    expect(all.body.scope).toBe(`${SCOPE} ${WRITE_SCOPE}`);
    expect(scopeOf(all.body.access_token)).toBe(`${SCOPE} ${WRITE_SCOPE}`);
    const one = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET, scope: WRITE_SCOPE })), WRITE_DEPS);
    expect(one.body.scope).toBe(WRITE_SCOPE);
  });

  it("refuses choices:write for a client that is not in AUTH_WRITE_CLIENTS", async () => {
    const r = await handleTokenRequest(req(form({ client_id: "partner", client_secret: SECRET, scope: `${SCOPE} ${WRITE_SCOPE}` })), DEPS);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: "invalid_scope", error_description: `This client may use only ${SCOPE}` });
  });
});
