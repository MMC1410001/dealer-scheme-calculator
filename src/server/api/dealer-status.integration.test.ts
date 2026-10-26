/**
 * Integration test against the local PostgreSQL (DATABASE_URL from .env) with the demo dealers (npm run data:demo).
 * Skipped when the database cannot be reached or the demo dealers are not loaded.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getDealerStatus, listActiveSchemeTags } from "@/server/repo";
import { getPool } from "@/db/client";
import type { DealerStatus } from "@/engine/types";
import { handleStatusRequest, type ApiErrorBody, type StatusRequestDeps } from "./dealer-status";

async function demoDataReady(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000, max: 1 });
  try {
    const r = await pool.query(
      "SELECT (SELECT COUNT(*) FROM dealer WHERE code IN ('DEMO0001','DEMO-C1'))::int AS n, (SELECT COUNT(*) FROM scheme WHERE active)::int AS s",
    );
    return r.rows[0].n === 2 && r.rows[0].s >= 3;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const ready = await demoDataReady();
function deps(): StatusRequestDeps {
  return {
    authenticate: () => Promise.resolve({ ok: true, clientId: "it" }),
    limiter: null,
    listActiveTags: listActiveSchemeTags,
    getDealerStatus: (c: string, t: string[]) => getDealerStatus(c, t),
  };
}

function call(body: unknown) {
  return handleStatusRequest(
    {
      authorization: null,
      contentType: "application/json",
      readBody: () => Promise.resolve({ ok: true, text: JSON.stringify(body) }),
    },
    deps(),
  );
}

describe.skipIf(!ready)("dealer status API against the local database", () => {
  afterAll(async () => {
    await getPool().end();
  });

  it("returns the stored status of DEMO0001 in the order of the request tags", async () => {
    const tags = await listActiveSchemeTags();
    expect(tags.length).toBeGreaterThanOrEqual(3);
    const reversed = [...tags].reverse();
    const r = await call({ dealer_code: "DEMO0001", scheme_tags: reversed });
    expect(r.status).toBe(200);
    const body = r.body as DealerStatus;
    expect(body.dealer_code).toBe("DEMO0001");
    expect(body.schemes.map((s) => s.scheme_tag)).toEqual(reversed);
    // The same object as the iframe reads.
    const direct = await getDealerStatus("DEMO0001", reversed);
    expect(body).toEqual(direct);
  });

  it("resolves the child DEMO-C1 to its parent", async () => {
    const tags = await listActiveSchemeTags();
    const r = await call({ dealer_code: "DEMO-C1", scheme_tags: [tags[0]] });
    expect(r.status).toBe(200);
    expect((r.body as DealerStatus).dealer_code).not.toBe("DEMO-C1");
  });

  it("returns 400 for an unknown tag and 404 for an unknown dealer", async () => {
    const tags = await listActiveSchemeTags();
    const u = await call({ dealer_code: "DEMO0001", scheme_tags: [tags[0], "NOPE9"] });
    expect(u.status).toBe(400);
    expect((u.body as ApiErrorBody).error.message).toBe("Scheme tag NOPE9 does not exist.");
    const d = await call({ dealer_code: "NOPE99999", scheme_tags: [tags[0]] });
    expect(d.status).toBe(404);
    expect((d.body as ApiErrorBody).error.message).toBe("Dealer NOPE99999 does not exist.");
  });
});
