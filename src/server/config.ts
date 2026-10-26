/**
 * Settings of the dealer status API, from environment variables. Plain TypeScript, no Next.js dependency.
 *
 * APP_ENV (local | dev | uat | prod) is explicit. NODE_ENV is not used, because `next start` always sets
 * NODE_ENV=production, also on a developer machine.
 *
 * Startup rules (src/instrumentation.ts calls startupDecision):
 * 1. APP_ENV is not set and there are no auth settings: refuse to start.
 * 2. APP_ENV is not "local", or an auth setting is given: the auth settings must be complete and strong,
 *    otherwise refuse to start.
 * 3. APP_ENV=local and no auth settings: auth is OFF (a warning is written).
 * The route handlers use the same decision. When it is "refuse", they answer 503 API_DISABLED.
 */
import {
  LOCAL_EXAMPLE_JWT_MARKER,
  LOCAL_EXAMPLE_SECRET_HASH,
  clientProblems,
  parseAuthClients,
} from "@/lib/auth/clients";
import { parseRedisUrl, redisTransportWarning } from "@/server/redis-url";
import { formatDailyTime, parseDailyTime, type DailyTime } from "@/server/sync-schedule";

export type Env = Record<string, string | undefined>;

export const MIN_JWT_SECRET_LENGTH = 32;
export const MIN_TTL_SECONDS = 60;
export const MAX_TTL_SECONDS = 86_400;
/** Time of the daily BigQuery sync (India time) when SYNC_DAILY_AT is empty and APP_ENV is not "local". */
export const DEFAULT_SYNC_DAILY_AT = "08:00";

/** Dealer status requests a minute for each client_id (decision Q5, Mayur, 18-10-2026: 1,00,000, not 600). */
export const DEFAULT_API_RATE_LIMIT_PER_MINUTE = 100_000;

export interface ApiConfig {
  /** APP_ENV as set. Null when it is not set (or blank). */
  appEnv: string | null;
  authClients: Map<string, string>;
  authClientsError: string | null;
  /** AUTH_WRITE_CLIENTS: client ids that may get the choices:write scope (POST /api/v1/dealer-reward-choice). */
  authWriteClients: Set<string>;
  jwtSecret: string | null;
  jwtPreviousSecret: string | null;
  jwtTtlSeconds: number;
  rateLimitEnabled: boolean;
  rateLimitPerSecond: number;
  tokenRateLimitPerMinute: number;
  apiRateLimitPerMinute: number;
  trustedProxyHops: number;
  redisUrl: string | null;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  docsEnabled: boolean;
  dbPoolMax: number;
  dbPoolTimeoutMs: number;
  /** Daily BigQuery sync time (India time), or null when the schedule is off (src/server/sync-schedule.ts). */
  syncDailyAt: DailyTime | null;
  /** DB_AUTO_SETUP: migrate, seed and engine run at server start when needed (src/server/db-setup.ts). Default on. */
  dbAutoSetup: boolean;
  /** Problems with values that are not auth settings (for example a limit that is not a number). */
  settingProblems: string[];
}

function blankToNull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

function readInt(env: Env, name: string, def: number, min: number, max: number, problems: string[]): number {
  const raw = (env[name] ?? "").trim();
  if (!raw) return def;
  const n = Number(raw);
  if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(n) || n < min || n > max) {
    problems.push(`${name} must be an integer ${min}-${max}`);
    return def;
  }
  return n;
}

function readBool(env: Env, name: string, def: boolean, problems: string[]): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (!raw) return def;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  problems.push(`${name} must be true or false`);
  return def;
}

/**
 * SYNC_DAILY_AT: "HH:MM" (24-hour, India time) or "off". Empty: 08:00, but off with APP_ENV=local, so that a
 * developer machine does not query BigQuery each day by itself.
 */
function readSyncDailyAt(env: Env, appEnv: string | null, problems: string[]): DailyTime | null {
  const raw = (env.SYNC_DAILY_AT ?? "").trim();
  if (!raw) return appEnv === "local" ? null : parseDailyTime(DEFAULT_SYNC_DAILY_AT);
  if (["off", "false", "0", "no"].includes(raw.toLowerCase())) return null;
  const t = parseDailyTime(raw);
  if (!t) problems.push("SYNC_DAILY_AT must be a time HH:MM (00:00-23:59) or off");
  return t;
}

export interface DbPoolSettings {
  /** DATABASE_POOL_MAX: maximum database connections for each process (1-1000, default 10). */
  max: number;
  /** DATABASE_POOL_TIMEOUT_MS: maximum wait for a free connection (100-60000, default 5000). */
  timeoutMs: number;
  problems: string[];
}

/** Database pool settings. Used by readConfig (startup refusal) and by src/db/client.ts. */
export function readDbPoolSettings(env: Env = process.env): DbPoolSettings {
  const problems: string[] = [];
  const max = readInt(env, "DATABASE_POOL_MAX", 10, 1, 1000, problems);
  const timeoutMs = readInt(env, "DATABASE_POOL_TIMEOUT_MS", 5000, 100, 60_000, problems);
  return { max, timeoutMs, problems };
}

export function readConfig(env: Env = process.env): ApiConfig {
  const problems: string[] = [];
  const appEnv = blankToNull(env.APP_ENV);
  const parsed = parseAuthClients(env.AUTH_CLIENTS);
  // JWT_TTL_SECONDS is checked by configProblems (same message as the reference API).
  const ttlRaw = (env.JWT_TTL_SECONDS ?? "").trim();
  const ttl = ttlRaw ? (/^\d+$/.test(ttlRaw) ? Number(ttlRaw) : Number.NaN) : 3600;
  const pool = readDbPoolSettings(env);
  const redisUrl = blankToNull(env.REDIS_URL);
  if (redisUrl !== null) {
    // redis:// or rediss:// (TLS), with an optional password (Q7). The message never contains the URL.
    const r = parseRedisUrl(redisUrl);
    if (!r.ok) problems.push(r.error);
  }
  return {
    appEnv,
    authClients: parsed.clients,
    authClientsError: parsed.error,
    authWriteClients: new Set((env.AUTH_WRITE_CLIENTS ?? "").split(/[,\s]+/).filter(Boolean)),
    jwtSecret: blankToNull(env.JWT_SECRET),
    jwtPreviousSecret: blankToNull(env.JWT_PREVIOUS_SECRET),
    jwtTtlSeconds: ttl,
    rateLimitEnabled: readBool(env, "RATE_LIMIT_ENABLED", true, problems),
    rateLimitPerSecond: readInt(env, "RATE_LIMIT_PER_SECOND", 2500, 1, 10_000_000, problems),
    tokenRateLimitPerMinute: readInt(env, "TOKEN_RATE_LIMIT_PER_MINUTE", 30, 1, 100_000, problems),
    // Default 1,00,000 a minute for each client (decision Q5, Mayur, 18-10-2026).
    apiRateLimitPerMinute: readInt(env, "API_RATE_LIMIT_PER_MINUTE", DEFAULT_API_RATE_LIMIT_PER_MINUTE, 1, 10_000_000, problems),
    trustedProxyHops: readInt(env, "TRUSTED_PROXY_HOPS", 0, 0, 10, problems),
    redisUrl,
    cacheEnabled: readBool(env, "CACHE_ENABLED", false, problems),
    cacheTtlSeconds: readInt(env, "CACHE_TTL_SECONDS", 900, 1, 86_400, problems),
    docsEnabled: readBool(env, "DOCS_ENABLED", appEnv === "local", problems),
    dbPoolMax: pool.max,
    dbPoolTimeoutMs: pool.timeoutMs,
    syncDailyAt: readSyncDailyAt(env, appEnv, problems),
    dbAutoSetup: readBool(env, "DB_AUTO_SETUP", true, problems),
    settingProblems: [...problems, ...pool.problems],
  };
}

/** True when the API checks tokens: at least one client and a signing key. */
export function authEnabled(cfg: ApiConfig): boolean {
  return cfg.authClients.size > 0 && cfg.jwtSecret !== null;
}

/** Any auth setting given (decides between rule 2 and rule 3). Same test as the reference API. */
export function hasAuthSettings(cfg: ApiConfig): boolean {
  return cfg.authClients.size > 0 || cfg.jwtSecret !== null || cfg.authClientsError !== null;
}

/** What is wrong with the auth settings for this APP_ENV. Empty when they are usable. */
export function configProblems(cfg: ApiConfig, appEnv: string = "local"): string[] {
  const problems: string[] = [];
  if (appEnv !== "local") {
    if ([...cfg.authClients.values()].includes(LOCAL_EXAMPLE_SECRET_HASH)) {
      problems.push("AUTH_CLIENTS contains the local example client from .env.example");
    }
    if (cfg.jwtSecret && cfg.jwtSecret.includes(LOCAL_EXAMPLE_JWT_MARKER)) {
      problems.push("JWT_SECRET is the local example key from .env.example");
    }
    if (cfg.jwtPreviousSecret && cfg.jwtPreviousSecret.includes(LOCAL_EXAMPLE_JWT_MARKER)) {
      problems.push("JWT_PREVIOUS_SECRET is the local example key from .env.example");
    }
  }
  if (cfg.authClientsError) problems.push(cfg.authClientsError);
  else if (cfg.authClients.size === 0) problems.push("AUTH_CLIENTS is empty");
  problems.push(...clientProblems(cfg.authClients));
  for (const id of cfg.authWriteClients) {
    if (!cfg.authClients.has(id)) problems.push(`AUTH_WRITE_CLIENTS: client_id ${JSON.stringify(id.slice(0, 64))} is not in AUTH_CLIENTS`);
  }
  if (cfg.jwtSecret === null) problems.push("JWT_SECRET is not set");
  else if (cfg.jwtSecret.length < MIN_JWT_SECRET_LENGTH) problems.push(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  if (cfg.jwtPreviousSecret !== null && cfg.jwtPreviousSecret.length < MIN_JWT_SECRET_LENGTH) {
    problems.push(`JWT_PREVIOUS_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  if (!(Number.isInteger(cfg.jwtTtlSeconds) && cfg.jwtTtlSeconds >= MIN_TTL_SECONDS && cfg.jwtTtlSeconds <= MAX_TTL_SECONDS)) {
    problems.push(`JWT_TTL_SECONDS must be ${MIN_TTL_SECONDS}-${MAX_TTL_SECONDS}`);
  }
  return problems;
}

export type StartupDecision =
  | { action: "refuse"; message: string }
  | { action: "start"; auth: "on" | "off"; warnings: string[] };

/** The startup rules (see the top of this file). Pure: the caller exits or warns. */
export function startupDecision(cfg: ApiConfig): StartupDecision {
  const shownEnv = cfg.appEnv ?? "(not set)";
  if (cfg.settingProblems.length > 0) {
    return { action: "refuse", message: `Settings invalid for APP_ENV=${shownEnv}: ${cfg.settingProblems.join("; ")}` };
  }
  if (cfg.appEnv === null && !hasAuthSettings(cfg)) {
    return {
      action: "refuse",
      message:
        "APP_ENV is not set and there are no auth settings: set AUTH_CLIENTS and JWT_SECRET, " +
        "or APP_ENV=local to run without auth on your machine",
    };
  }
  const warnings: string[] = [];
  const isLocal = cfg.appEnv === "local";
  if (!isLocal && cfg.trustedProxyHops === 0) {
    warnings.push(
      `TRUSTED_PROXY_HOPS=0 with APP_ENV=${shownEnv}: X-Forwarded-For is not trusted, so all callers share one ` +
        "per-IP rate-limit bucket. Set the number of reverse proxies in front of the app.",
    );
  }
  if (!isLocal && cfg.trustedProxyHops >= 1) {
    warnings.push(
      `TRUSTED_PROXY_HOPS=${cfg.trustedProxyHops}: the app port must accept connections only from the trusted proxies ` +
        "(firewall or private network). A caller that reaches the app directly can set X-Forwarded-For and pick its own " +
        "rate-limit bucket.",
    );
  }
  if (!isLocal && cfg.redisUrl) {
    const w = redisTransportWarning(cfg.redisUrl, shownEnv);
    if (w) warnings.push(w);
  }
  if (!isLocal && !cfg.syncDailyAt) {
    warnings.push(
      `SYNC_DAILY_AT=off with APP_ENV=${shownEnv}: the daily BigQuery sync does not run, so the dealer results ` +
        "get old. Set SYNC_DAILY_AT=HH:MM (India time) or leave it empty for 08:00, then recreate the container.",
    );
  }
  if (!isLocal || hasAuthSettings(cfg)) {
    const problems = configProblems(cfg, cfg.appEnv ?? "(not set)");
    if (problems.length > 0) {
      return {
        action: "refuse",
        message:
          `Auth settings invalid for APP_ENV=${shownEnv}: ${problems.join("; ")}` +
          (cfg.appEnv === null ? " (set APP_ENV=local to use the .env.example values on your machine)" : ""),
      };
    }
    return { action: "start", auth: "on", warnings };
  }
  warnings.push("Auth is OFF (APP_ENV=local with no AUTH_CLIENTS/JWT_SECRET)");
  return { action: "start", auth: "off", warnings };
}

/** Cache text of the response cache state, for the startup log. */
export function syncScheduleText(cfg: ApiConfig): string {
  return cfg.syncDailyAt ? `daily sync ${formatDailyTime(cfg.syncDailyAt)} IST` : "daily sync off";
}

export function cacheStatusText(cfg: ApiConfig): string {
  if (cfg.cacheEnabled && cfg.redisUrl) return `Response cache on (TTL ${cfg.cacheTtlSeconds} s)`;
  return `Response cache off (${cfg.cacheEnabled ? "REDIS_URL not set" : "CACHE_ENABLED is false"})`;
}

const CONFIG_ENV_NAMES = [
  "APP_ENV",
  "AUTH_CLIENTS",
  "AUTH_WRITE_CLIENTS",
  "JWT_SECRET",
  "JWT_PREVIOUS_SECRET",
  "JWT_TTL_SECONDS",
  "RATE_LIMIT_ENABLED",
  "RATE_LIMIT_PER_SECOND",
  "TOKEN_RATE_LIMIT_PER_MINUTE",
  "API_RATE_LIMIT_PER_MINUTE",
  "TRUSTED_PROXY_HOPS",
  "REDIS_URL",
  "CACHE_ENABLED",
  "CACHE_TTL_SECONDS",
  "DOCS_ENABLED",
  "DATABASE_POOL_MAX",
  "DATABASE_POOL_TIMEOUT_MS",
  "SYNC_DAILY_AT",
  "DB_AUTO_SETUP",
] as const;

interface ConfigHolder {
  key: string;
  cfg: ApiConfig;
  decision: StartupDecision;
}
const holder = globalThis as unknown as { __schemeApiConfig?: ConfigHolder };

/**
 * The current settings and startup decision. Parsed again only when one of the variables changes
 * (tests change process.env). Kept on globalThis, so that all route bundles share one copy.
 */
export function currentConfig(env: Env = process.env): { cfg: ApiConfig; decision: StartupDecision } {
  const key = CONFIG_ENV_NAMES.map((n) => env[n] ?? "\u0000").join("\u0001");
  const h = holder.__schemeApiConfig;
  if (h && h.key === key) return h;
  const cfg = readConfig(env);
  const next: ConfigHolder = { key, cfg, decision: startupDecision(cfg) };
  holder.__schemeApiConfig = next;
  return next;
}
