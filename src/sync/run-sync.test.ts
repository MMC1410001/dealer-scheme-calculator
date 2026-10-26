import { describe, expect, it } from "vitest";
import { SCHEMES, SCHEME_TAGS } from "@/config/schemes";
import { getBqConfig, parseServiceAccountKey } from "./bigquery-client";
import { rangesFromScheme } from "./queries";
import { queryConfig, replaceMonthsFor, replaceScopesOf, type PlannedQuery } from "./run-sync";

const gt = SCHEMES.find((s) => s.tag === SCHEME_TAGS.starPoints)!;

describe("base / period split", () => {
  it("a routine (PERIOD) query replaces only months from the scheme start; BASE only the base months", () => {
    const r = rangesFromScheme(gt);
    expect(replaceMonthsFor(r, "PERIOD")).toEqual({ from: "2026-10", to: "9999-12" });
    expect(replaceMonthsFor(r, "BASE")).toEqual({ from: "2026-04", to: "2026-06" });
  });

  it("replace scopes: one per tag and metric query, none for the dealer master", () => {
    const spec = { name: "x", sql: "", params: {}, types: {} };
    const plan: PlannedQuery[] = [
      { kind: "DEALER_MASTER", mode: null, tags: [], replaceMonths: null, spec },
      { kind: "FESTIVE_BONANZA", mode: "PERIOD", tags: ["FB-PAN", "FB-TNHPJK"], replaceMonths: { from: "2026-10", to: "9999-12" }, spec },
    ];
    expect(replaceScopesOf(plan)).toEqual([
      { tag: "FB-PAN", fromMonth: "2026-10", toMonth: "9999-12" },
      { tag: "FB-TNHPJK", fromMonth: "2026-10", toMonth: "9999-12" },
    ]);
  });

  it("BASE queries use the base byte limit; routine queries the routine limit (defaults 5 GB / 1 GB)", () => {
    const cfg = getBqConfig({} as NodeJS.ProcessEnv);
    expect(cfg.maxBytesBilled).toBe(1_000_000_000);
    expect(cfg.maxBytesBilledBase).toBe(5_000_000_000);
    expect(queryConfig({ mode: "BASE" }, cfg).maxBytesBilled).toBe(5_000_000_000);
    expect(queryConfig({ mode: "PERIOD" }, cfg).maxBytesBilled).toBe(1_000_000_000);
    expect(queryConfig({ mode: null }, cfg).maxBytesBilled).toBe(1_000_000_000);
    expect(() => getBqConfig({ BIGQUERY_MAX_BYTES_BILLED_BASE: "-1" } as unknown as NodeJS.ProcessEnv)).toThrow(/BIGQUERY_MAX_BYTES_BILLED_BASE/);
  });
});

describe("BIGQUERY_CREDENTIALS_JSON", () => {
  const key = { type: "service_account", client_email: "sync@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nsecret\n" };
  const env = (v: string) => ({ BIGQUERY_CREDENTIALS_JSON: v }) as unknown as NodeJS.ProcessEnv;
  const want = { client_email: key.client_email, private_key: key.private_key };

  it("takes the key as base64 of the key file or as JSON; empty = no key", () => {
    expect(getBqConfig(env(Buffer.from(JSON.stringify(key, null, 2)).toString("base64"))).credentials).toEqual(want);
    expect(getBqConfig(env(JSON.stringify(key))).credentials).toEqual(want);
    expect(getBqConfig(env(" ")).credentials).toBeUndefined();
  });

  it("refuses a bad value without showing it", () => {
    for (const bad of ["not base64 or json", Buffer.from('{"type":"x"}').toString("base64"), '{"private_key":"secret"}']) {
      expect(() => parseServiceAccountKey(bad)).toThrow(/BIGQUERY_CREDENTIALS_JSON/);
      expect(() => parseServiceAccountKey(bad)).not.toThrow(/secret/);
    }
  });
});
