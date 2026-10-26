import "dotenv/config";
/**
 * Apply the Drizzle SQL migrations in drizzle/ to DATABASE_URL. The server does the same at startup
 * (DB_AUTO_SETUP, src/server/db-setup.ts); both take the same migration lock.
 * Usage: npm run db:migrate
 */
import { getPool } from "@/db/client";
import { migrateDatabase, migrationErrorText } from "@/server/db-setup";

async function main(): Promise<void> {
  const started = Date.now();
  const applied = await migrateDatabase(getPool());
  console.log(`Migrations applied: ${applied} (${Date.now() - started} ms).`);
}

main()
  .catch((err: unknown) => {
    console.error("Migration failed:", migrationErrorText(err));
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
