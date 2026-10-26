/**
 * Startup checks of the server (Node.js runtime). src/instrumentation.ts calls runStartupChecks once,
 * before the server takes requests. See the startup rules in src/server/config.ts.
 * A refusal writes the reason to stderr and stops the process with exit code 1.
 */
import { cacheStatusText, currentConfig, syncScheduleText } from "@/server/config";
import { warmUpRedis, type RedisPurpose } from "@/server/redis";
import { redisTransportText } from "@/server/redis-url";

export function runStartupChecks(exit: (code: number) => never = process.exit): void {
  const { cfg, decision } = currentConfig();
  if (decision.action === "refuse") {
    console.error(`[startup] Refused to start: ${decision.message}`);
    exit(1);
    return;
  }
  for (const w of decision.warnings) console.warn(`[startup] ${w}`);
  console.log(
    `[startup] APP_ENV=${cfg.appEnv ?? "(not set)"}; auth ${decision.auth}; ` +
      `rate limits ${cfg.rateLimitEnabled ? `on (${cfg.rateLimitPerSecond}/s per IP, token ${cfg.tokenRateLimitPerMinute}/min per IP, ${cfg.apiRateLimitPerMinute}/min per client)` : "off"}; ` +
      `rate-limit store ${cfg.redisUrl ? `Redis, ${redisTransportText(cfg.redisUrl)} (memory fallback)` : "memory"}; ${cacheStatusText(cfg)}; docs ${cfg.docsEnabled ? "on" : "off"}; ${syncScheduleText(cfg)}; ` +
      `db auto setup ${cfg.dbAutoSetup ? "on" : "off"}`,
  );
}

/**
 * Applies the migrations in drizzle/ before the server takes requests (DB_AUTO_SETUP, src/server/db-setup.ts).
 * A failure writes the reason to stderr and stops the process with exit code 1: the server must not run on a
 * schema that does not match the code.
 */
export async function migrateDatabaseAtStartup(exit: (code: number) => never = process.exit): Promise<void> {
  const { cfg, decision } = currentConfig();
  if (decision.action === "refuse" || !cfg.dbAutoSetup) return;
  const { migrateDatabase, migrationErrorText } = await import("@/server/db-setup");
  try {
    const { getPool } = await import("@/db/client");
    const started = Date.now();
    const applied = await migrateDatabase(getPool());
    console.log(`[db-setup] Migrations applied: ${applied} (${Date.now() - started} ms).`);
  } catch (err) {
    console.error(`[startup] Refused to start: database migration failed: ${migrationErrorText(err)}`);
    exit(1);
  }
}

/**
 * Seeds the scheme configuration and runs the engine when needed (DB_AUTO_SETUP, src/server/db-setup.ts).
 * Resolves after the first attempt. Never throws: a failure is logged and the server keeps running.
 */
export async function runDbSetupAtStartup(): Promise<void> {
  const { cfg, decision } = currentConfig();
  if (decision.action === "refuse" || !cfg.dbAutoSetup) return;
  try {
    const { startDbSetup } = await import("@/server/db-setup");
    await startDbSetup();
  } catch (err) {
    console.error(`[startup] Database setup not started: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Opens the Redis connections of the rate limits and the response cache before the first request (QA-4).
 * Waits at most about 1 s. Never throws: when Redis is not ready, the requests fall back as usual.
 */
export async function warmUpRedisAtStartup(): Promise<void> {
  const { cfg, decision } = currentConfig();
  if (decision.action === "refuse" || !cfg.redisUrl) return;
  const purposes: RedisPurpose[] = [];
  if (cfg.rateLimitEnabled) purposes.push("rate");
  if (cfg.cacheEnabled) purposes.push("cache");
  if (purposes.length === 0) return;
  const ready = await warmUpRedis(cfg.redisUrl, purposes);
  if (ready.length === purposes.length) console.log(`[startup] Redis connected (${purposes.join(", ")}).`);
  else console.warn(`[startup] Redis is not ready (${purposes.filter((p) => !ready.includes(p)).join(", ")}). The API falls back until it is.`);
}

/** Starts the daily BigQuery sync (SYNC_DAILY_AT). Never throws: a failure is logged and the server keeps running. */
export async function startDailySync(): Promise<void> {
  const { cfg, decision } = currentConfig();
  if (decision.action === "refuse" || !cfg.syncDailyAt) return;
  try {
    const { startDailySyncFromConfig } = await import("@/server/sync-schedule");
    await startDailySyncFromConfig(cfg.syncDailyAt);
  } catch (err) {
    console.error(`[startup] Daily sync not started: ${err instanceof Error ? err.message : String(err)}`);
  }
}
