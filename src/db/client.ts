import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readDbPoolSettings } from "@/server/config";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __schemeDbPool?: Pool };

/**
 * One pool per process (survives Next.js hot reload in development).
 * DATABASE_POOL_MAX (1..1000, default 10) and DATABASE_POOL_TIMEOUT_MS (100..60000, default 5000) are read by
 * readDbPoolSettings in src/server/config.ts. An invalid value stops the server at startup, and here it throws.
 * A request that waits longer than DATABASE_POOL_TIMEOUT_MS for a connection fails. The API answers it with
 * 503 SERVICE_BUSY and Retry-After: 2 (isDatabaseBusy in src/server/api/dealer-status.ts), not with a hang.
 */
export function getPool(): Pool {
  if (!globalForDb.__schemeDbPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
    const pool = readDbPoolSettings();
    if (pool.problems.length > 0) throw new Error(`Database pool settings invalid: ${pool.problems.join("; ")}`);
    globalForDb.__schemeDbPool = new Pool({
      connectionString: url,
      max: pool.max,
      connectionTimeoutMillis: pool.timeoutMs,
    });
  }
  return globalForDb.__schemeDbPool;
}

export function getDb(): Db {
  return drizzle(getPool(), { schema });
}

export { schema };
