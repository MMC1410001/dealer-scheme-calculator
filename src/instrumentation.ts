/**
 * Next.js instrumentation: register() runs once when a server instance starts, before it takes requests
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 * Here it applies the API startup rules (src/server/config.ts): the server refuses to start with unsafe
 * auth settings. Not during `next build` (NEXT_PHASE=phase-production-build).
 * It also installs the method guard (src/server/method-guard.ts: TRACE and other methods that Next.js rejects
 * before the route get a JSON answer), applies the database migrations (a failure stops the server) and opens the
 * Redis connections before the first request (QA-1, QA-4).
 * In the background, it seeds the scheme configuration and runs the engine when needed (DB_AUTO_SETUP,
 * src/server/db-setup.ts). After that first attempt, it starts the daily BigQuery sync (SYNC_DAILY_AT,
 * src/server/sync-schedule.ts), so that a catch-up sync reads the new configuration.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { migrateDatabaseAtStartup, runDbSetupAtStartup, runStartupChecks, startDailySync, warmUpRedisAtStartup } =
    await import("./server/startup");
  runStartupChecks();
  const { installMethodGuard } = await import("./server/method-guard");
  installMethodGuard();
  await migrateDatabaseAtStartup();
  await warmUpRedisAtStartup();
  void runDbSetupAtStartup().finally(() => startDailySync());
}
