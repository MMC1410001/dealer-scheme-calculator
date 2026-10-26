/** Settings and startup rules (same cases as the reference API tests/test_config.py and test_auth.py config cases). */
import { describe, expect, it, vi } from "vitest";
import { hashSecret } from "@/lib/auth/clients";
import {
  DEFAULT_API_RATE_LIMIT_PER_MINUTE,
  cacheStatusText,
  configProblems,
  currentConfig,
  readConfig,
  readDbPoolSettings,
  startupDecision,
  type Env,
} from "./config";
import { runStartupChecks } from "./startup";

const GOOD_AUTH: Env = { AUTH_CLIENTS: JSON.stringify({ partner: "a".repeat(64) }), JWT_SECRET: "s".repeat(32) };
const EXAMPLE_AUTH: Env = {
  AUTH_CLIENTS: '{"local-client": "0b1f90b824765bd860b58a3ebc0396a4f6f4c4ad8f1eed10135c0cb6cf3bd171"}',
  JWT_SECRET: "local-only-jwt-signing-key-not-for-servers-0001",
};

function decide(env: Env) {
  return startupDecision(readConfig(env));
}

describe("readConfig", () => {
  it("has the documented defaults", () => {
    const c = readConfig({});
    expect(c).toMatchObject({
      appEnv: null,
      jwtTtlSeconds: 3600,
      rateLimitEnabled: true,
      rateLimitPerSecond: 2500,
      tokenRateLimitPerMinute: 30,
      apiRateLimitPerMinute: 100_000, // 1,00,000 a minute for each client (decision Q5, 18-10-2026)
      trustedProxyHops: 0,
      redisUrl: null,
      cacheEnabled: false,
      cacheTtlSeconds: 900,
      docsEnabled: false,
      settingProblems: [],
    });
    expect(readConfig({ APP_ENV: "local" }).docsEnabled).toBe(true);
    expect(readConfig({ APP_ENV: "local", DOCS_ENABLED: "false" }).docsEnabled).toBe(false);
    expect(readConfig({ APP_ENV: "prod", DOCS_ENABLED: "true" }).docsEnabled).toBe(true);
  });

  it("reads SYNC_DAILY_AT: 08:00 IST by default on servers, off on a developer machine", () => {
    expect(readConfig({}).syncDailyAt).toEqual({ hour: 8, minute: 0 });
    expect(readConfig({ APP_ENV: "dev" }).syncDailyAt).toEqual({ hour: 8, minute: 0 });
    expect(readConfig({ APP_ENV: "local" }).syncDailyAt).toBeNull();
    expect(readConfig({ APP_ENV: "local", SYNC_DAILY_AT: "06:30" }).syncDailyAt).toEqual({ hour: 6, minute: 30 });
    expect(readConfig({ APP_ENV: "prod", SYNC_DAILY_AT: "off" }).syncDailyAt).toBeNull();
    const bad = readConfig({ APP_ENV: "prod", SYNC_DAILY_AT: "8am", ...GOOD_AUTH });
    expect(bad.settingProblems).toContain("SYNC_DAILY_AT must be a time HH:MM (00:00-23:59) or off");
    expect(startupDecision(bad).action).toBe("refuse");
  });

  it("empty auth values mean unset", () => {
    for (const env of [{ AUTH_CLIENTS: "" }, { AUTH_CLIENTS: " " }, { JWT_SECRET: "" }, { JWT_PREVIOUS_SECRET: "" }]) {
      const c = readConfig(env);
      expect(c.authClients.size).toBe(0);
      expect(c.jwtSecret).toBeNull();
      expect(c.jwtPreviousSecret).toBeNull();
    }
  });

  it("reads and checks the database pool settings (invalid values stop the server)", () => {
    expect(readDbPoolSettings({})).toEqual({ max: 10, timeoutMs: 5000, problems: [] });
    expect(readDbPoolSettings({ DATABASE_POOL_MAX: "25", DATABASE_POOL_TIMEOUT_MS: "100" })).toEqual({ max: 25, timeoutMs: 100, problems: [] });
    for (const [name, value] of [["DATABASE_POOL_TIMEOUT_MS", "abc"], ["DATABASE_POOL_TIMEOUT_MS", "99"], ["DATABASE_POOL_MAX", "abc"], ["DATABASE_POOL_MAX", "0"]]) {
      const d = decide({ APP_ENV: "local", [name]: value });
      expect(d.action).toBe("refuse");
      if (d.action === "refuse") expect(d.message).toContain(`${name} must be an integer`);
    }
  });

  it("Q5: the per-client limit is 1,00,000 a minute by default, and the setting still overrides it", () => {
    expect(DEFAULT_API_RATE_LIMIT_PER_MINUTE).toBe(100_000);
    expect(readConfig({ APP_ENV: "prod" }).apiRateLimitPerMinute).toBe(100_000);
    expect(readConfig({ API_RATE_LIMIT_PER_MINUTE: "" }).apiRateLimitPerMinute).toBe(100_000);
    expect(readConfig({ API_RATE_LIMIT_PER_MINUTE: "5" }).apiRateLimitPerMinute).toBe(5); // DSS_TC_75_SEC server
    expect(readConfig({ API_RATE_LIMIT_PER_MINUTE: "600" }).apiRateLimitPerMinute).toBe(600);
  });

  it("allows API_RATE_LIMIT_PER_MINUTE up to 10,000,000 (k6 runs) and reports values that are not valid", () => {
    expect(readConfig({ API_RATE_LIMIT_PER_MINUTE: "10000000" }).apiRateLimitPerMinute).toBe(10_000_000);
    const bad = readConfig({ API_RATE_LIMIT_PER_MINUTE: "0", RATE_LIMIT_PER_SECOND: "1.5", CACHE_ENABLED: "maybe", TRUSTED_PROXY_HOPS: "-1" });
    expect([...bad.settingProblems].sort()).toEqual(
      [
        "API_RATE_LIMIT_PER_MINUTE must be an integer 1-10000000",
        "CACHE_ENABLED must be true or false",
        "RATE_LIMIT_PER_SECOND must be an integer 1-10000000",
        "TRUSTED_PROXY_HOPS must be an integer 0-10",
      ].sort(),
    );
    expect(bad.settingProblems).toHaveLength(4);
    expect(decide({ ...GOOD_AUTH, APP_ENV: "local", RATE_LIMIT_PER_SECOND: "x" }).action).toBe("refuse");
  });
});

describe("configProblems", () => {
  it("is empty for good settings and names each problem", () => {
    expect(configProblems(readConfig(GOOD_AUTH))).toEqual([]);
    expect(configProblems(readConfig({}))).toEqual(["AUTH_CLIENTS is empty", "JWT_SECRET is not set"]);
    const weak = readConfig({ AUTH_CLIENTS: JSON.stringify({ "bad id!": hashSecret("x") }), JWT_SECRET: "s".repeat(32), JWT_TTL_SECONDS: "10" });
    expect(configProblems(weak)).toHaveLength(2);
    expect(configProblems(readConfig({ ...GOOD_AUTH, JWT_TTL_SECONDS: "86401" }))).toEqual(["JWT_TTL_SECONDS must be 60-86400"]);
    expect(configProblems(readConfig({ ...GOOD_AUTH, JWT_TTL_SECONDS: "abc" }))).toEqual(["JWT_TTL_SECONDS must be 60-86400"]);
    expect(configProblems(readConfig({ ...GOOD_AUTH, JWT_PREVIOUS_SECRET: "short" }))).toEqual(["JWT_PREVIOUS_SECRET must be at least 32 characters"]);
  });

  it("needs every AUTH_WRITE_CLIENTS id in AUTH_CLIENTS", () => {
    const cfg = readConfig({ ...GOOD_AUTH, AUTH_WRITE_CLIENTS: "partner, other" });
    expect([...cfg.authWriteClients]).toEqual(["partner", "other"]);
    expect(configProblems(cfg)).toEqual(['AUTH_WRITE_CLIENTS: client_id "other" is not in AUTH_CLIENTS']);
    expect(configProblems(readConfig({ ...GOOD_AUTH, AUTH_WRITE_CLIENTS: "partner" }))).toEqual([]);
  });

  it("refuses the published example values outside local only", () => {
    expect(configProblems(readConfig(EXAMPLE_AUTH), "local")).toEqual([]);
    expect(configProblems(readConfig(EXAMPLE_AUTH), "prod")).toEqual([
      "AUTH_CLIENTS contains the local example client from .env.example",
      "JWT_SECRET is the local example key from .env.example",
    ]);
  });

  it("refuses the example key in the previous-key slot outside local (rotation from the example key)", () => {
    const env = { ...GOOD_AUTH, JWT_PREVIOUS_SECRET: "local-only-jwt-signing-key-not-for-servers-0001" };
    expect(configProblems(readConfig(env), "local")).toEqual([]);
    expect(configProblems(readConfig(env), "prod")).toEqual(["JWT_PREVIOUS_SECRET is the local example key from .env.example"]);
    const d = decide({ APP_ENV: "prod", TRUSTED_PROXY_HOPS: "1", ...env });
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") expect(d.message).toContain("JWT_PREVIOUS_SECRET is the local example key");
  });
});

describe("startupDecision (startup rules)", () => {
  it.each<[Env, string]>([
    [{}, "AUTH_CLIENTS is empty"],
    [{ AUTH_CLIENTS: GOOD_AUTH.AUTH_CLIENTS }, "JWT_SECRET is not set"],
    [{ ...GOOD_AUTH, JWT_SECRET: "short" }, "JWT_SECRET must be at least 32 characters"],
    [{ ...GOOD_AUTH, AUTH_CLIENTS: '{"partner": "plain-secret"}' }, "must be the SHA-256 hex of its secret"],
    [{ ...GOOD_AUTH, JWT_SECRET: "local-only-jwt-signing-key-not-for-servers-0001" }, "local example key"],
    [{ ...GOOD_AUTH, AUTH_CLIENTS: EXAMPLE_AUTH.AUTH_CLIENTS }, "local example client"],
    [{ ...GOOD_AUTH, AUTH_CLIENTS: "{not json" }, "AUTH_CLIENTS must be a JSON object"],
  ])("refuses to start outside local without strong auth: %j", (env, problem) => {
    const d = decide({ APP_ENV: "prod", ...env });
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") {
      expect(d.message).toContain(problem);
      expect(d.message).toContain("Auth settings invalid for APP_ENV=prod");
    }
  });

  it("starts with auth settings, or locally without any", () => {
    expect(decide({ APP_ENV: "prod", ...GOOD_AUTH, TRUSTED_PROXY_HOPS: "1" })).toMatchObject({ action: "start", auth: "on" });
    expect(decide({ APP_ENV: "prod", ...GOOD_AUTH, JWT_PREVIOUS_SECRET: "" }).action).toBe("start");
    expect(decide({ APP_ENV: "local" })).toEqual({ action: "start", auth: "off", warnings: ["Auth is OFF (APP_ENV=local with no AUTH_CLIENTS/JWT_SECRET)"] });
    expect(decide({ APP_ENV: "local", JWT_SECRET: "short" }).action).toBe("refuse"); // local, but half configured
    expect(decide({ ...GOOD_AUTH }).action).toBe("start"); // APP_ENV unset, auth on
    expect(decide({ APP_ENV: "local", ...EXAMPLE_AUTH })).toMatchObject({ action: "start", auth: "on" });
  });

  it.each<[Env, string]>([
    [EXAMPLE_AUTH, "local example client"],
    [{ ...EXAMPLE_AUTH, AUTH_CLIENTS: GOOD_AUTH.AUTH_CLIENTS }, "local example key"],
    [{ ...EXAMPLE_AUTH, JWT_SECRET: GOOD_AUTH.JWT_SECRET }, "local example client"],
  ])("example credentials need APP_ENV=local set explicitly: %j", (env, problem) => {
    const d = decide(env);
    expect(d.action).toBe("refuse");
    if (d.action === "refuse") {
      expect(d.message).toContain(problem);
      expect(d.message).toContain("APP_ENV=(not set)");
      expect(d.message).toContain("set APP_ENV=local");
    }
  });

  it("refuses to run open when APP_ENV is not set", () => {
    const d = decide({});
    expect(d).toMatchObject({ action: "refuse" });
    if (d.action === "refuse") expect(d.message).toContain("APP_ENV is not set and there are no auth settings");
  });

  it("warns outside local when TRUSTED_PROXY_HOPS is 0", () => {
    const d = decide({ APP_ENV: "uat", ...GOOD_AUTH });
    expect(d.action).toBe("start");
    if (d.action === "start") expect(d.warnings[0]).toMatch(/^TRUSTED_PROXY_HOPS=0 with APP_ENV=uat/);
  });

  it("warns outside local when TRUSTED_PROXY_HOPS >= 1 that the app port must be reachable only through the proxies", () => {
    const d = decide({ APP_ENV: "prod", ...GOOD_AUTH, TRUSTED_PROXY_HOPS: "2" });
    expect(d).toMatchObject({ action: "start", auth: "on" });
    if (d.action === "start") {
      expect(d.warnings).toHaveLength(1);
      expect(d.warnings[0]).toMatch(/^TRUSTED_PROXY_HOPS=2: the app port must accept connections only from the trusted proxies/);
    }
    const local = decide({ APP_ENV: "local", ...GOOD_AUTH, TRUSTED_PROXY_HOPS: "1" });
    if (local.action === "start") expect(local.warnings).toEqual([]);
  });

  it("warns outside local when the daily sync is off", () => {
    const d = decide({ APP_ENV: "dev", ...GOOD_AUTH, TRUSTED_PROXY_HOPS: "1", SYNC_DAILY_AT: "off" });
    expect(d).toMatchObject({ action: "start", auth: "on" });
    if (d.action === "start") expect(d.warnings.filter((w) => w.startsWith("SYNC_DAILY_AT=off with APP_ENV=dev"))).toHaveLength(1);
    const local = decide({ APP_ENV: "local", ...GOOD_AUTH, SYNC_DAILY_AT: "off" });
    if (local.action === "start") expect(local.warnings).toEqual([]);
  });
});

describe("runStartupChecks", () => {
  it("writes the reason and exits with code 1 when refused; logs the state when it starts", () => {
    const saved = { ...process.env };
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const k of ["APP_ENV", "AUTH_CLIENTS", "JWT_SECRET", "JWT_PREVIOUS_SECRET", "REDIS_URL", "CACHE_ENABLED"]) delete process.env[k];
      const exit = vi.fn() as unknown as (code: number) => never;
      runStartupChecks(exit);
      expect(exit).toHaveBeenCalledWith(1);
      expect(String(err.mock.calls[0][0])).toContain("Refused to start: APP_ENV is not set");

      Object.assign(process.env, { APP_ENV: "local", ...GOOD_AUTH, REDIS_URL: "redis://localhost:1/0", CACHE_ENABLED: "true" });
      const exit2 = vi.fn() as unknown as (code: number) => never;
      runStartupChecks(exit2);
      expect(exit2).not.toHaveBeenCalled();
      expect(String(log.mock.calls[0][0])).toContain("auth on");
      expect(String(log.mock.calls[0][0])).toContain("Response cache on (TTL 900 s)");
    } finally {
      process.env = saved;
      err.mockRestore();
      log.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("REDIS_URL (Q7: redis:// and rediss:// with a password)", () => {
  const SECRET = "S3cr%40t-pass";

  it("accepts redis:// and rediss:// with a user name and a password", () => {
    for (const url of [
      "redis://localhost:6380/0",
      `redis://:${SECRET}@10.0.0.5:6379/2`,
      `rediss://:${SECRET}@redis.example.internal:6380/0`,
      `rediss://app-user:${SECRET}@redis.example.internal:6380`,
      `REDISS://app-user:${SECRET}@redis.example.internal`,
      "rediss://redis.example.internal?family=6",
    ]) {
      expect(readConfig({ REDIS_URL: url }).settingProblems, url).toEqual([]);
      expect(readConfig({ REDIS_URL: url }).redisUrl).toBe(url);
    }
  });

  it("refuses a URL that is not redis:// or rediss://, and never repeats the URL or the password", () => {
    for (const url of [
      `http://:${SECRET}@redis.example.internal:6380`,
      `redis-tls://:${SECRET}@host`,
      `rediss://:${SECRET}@`,
      `rediss://:${SECRET}@host:6380/zero`,
      "rediss://:p#ss@host:6380",
      "localhost:6380",
    ]) {
      const d = decide({ APP_ENV: "local", REDIS_URL: url });
      expect(d.action, url).toBe("refuse");
      if (d.action === "refuse") {
        expect(d.message).toContain("REDIS_URL must be a redis:// or rediss:// URL");
        expect(d.message).not.toContain(SECRET);
        expect(d.message).not.toContain("p#ss");
        expect(d.message).not.toContain("example.internal");
      }
    }
  });

  it("warns outside local when Redis has no TLS or no password (recommend rediss:// and a password), never with the URL", () => {
    const warningsFor = (url: string, appEnv = "prod"): string[] => {
      const d = decide({ APP_ENV: appEnv, ...GOOD_AUTH, TRUSTED_PROXY_HOPS: "1", REDIS_URL: url });
      expect(d.action).toBe("start");
      return d.action === "start" ? d.warnings.filter((w) => w.startsWith("REDIS_URL")) : [];
    };
    expect(warningsFor(`rediss://:${SECRET}@redis.example.internal:6380/0`)).toEqual([]);
    const plain = warningsFor(`redis://:${SECRET}@redis.example.internal:6379/0`);
    expect(plain).toHaveLength(1);
    expect(plain[0]).toMatch(/^REDIS_URL with APP_ENV=prod has no TLS \(redis:\/\/\)\. .*rediss:\/\/ and a password/);
    expect(warningsFor("rediss://redis.example.internal:6380")[0]).toMatch(/has no password\./);
    expect(warningsFor("redis://redis.example.internal:6379")[0]).toMatch(/has no TLS \(redis:\/\/\) and no password\./);
    for (const w of [...plain, ...warningsFor("redis://redis.example.internal:6379")]) {
      expect(w).not.toContain(SECRET);
      expect(w).not.toContain("example.internal");
    }
    expect(warningsFor("redis://localhost:6380/0", "local")).toEqual([]);
  });

  it("the startup log names the transport (TLS, password) but never the URL or the password", () => {
    const saved = { ...process.env };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      Object.assign(process.env, { APP_ENV: "local", ...GOOD_AUTH, REDIS_URL: `rediss://app-user:${SECRET}@redis.example.internal:6380/0` });
      runStartupChecks(vi.fn() as unknown as (code: number) => never);
      const line = String(log.mock.calls[0][0]);
      expect(line).toContain("rate-limit store Redis, TLS (rediss://), password set (memory fallback)");
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain("app-user");
      expect(line).not.toContain("example.internal");
    } finally {
      process.env = saved;
      log.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("cacheStatusText and currentConfig", () => {
  it("says why the cache is off", () => {
    expect(cacheStatusText(readConfig({ CACHE_ENABLED: "true", REDIS_URL: "redis://x" }))).toBe("Response cache on (TTL 900 s)");
    expect(cacheStatusText(readConfig({ CACHE_ENABLED: "true" }))).toBe("Response cache off (REDIS_URL not set)");
    expect(cacheStatusText(readConfig({ REDIS_URL: "redis://x" }))).toBe("Response cache off (CACHE_ENABLED is false)");
  });

  it("parses again only when a variable changes", () => {
    const a = currentConfig({ APP_ENV: "local" });
    expect(currentConfig({ APP_ENV: "local" })).toBe(a);
    expect(currentConfig({ APP_ENV: "local", CACHE_TTL_SECONDS: "60" }).cfg.cacheTtlSeconds).toBe(60);
  });
});
