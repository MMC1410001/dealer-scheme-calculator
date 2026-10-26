/**
 * BigQuery client for the sync job (server side only).
 *
 * - Configuration from the environment: BIGQUERY_PROJECT_ID, BIGQUERY_DATASET, BIGQUERY_LOCATION,
 *   GOOGLE_APPLICATION_CREDENTIALS (optional; empty = Application Default Credentials),
 *   BIGQUERY_CREDENTIALS_JSON (optional; the service account key itself, base64 or JSON; wins over the key file),
 *   BIGQUERY_MAX_BYTES_BILLED (cost guard for routine queries, default 1 GB),
 *   BIGQUERY_MAX_BYTES_BILLED_BASE (cost guard for the base-period queries that read the NULL partition, default 5 GB).
 * - Every query uses named query parameters (QuerySpec.params). Values are never concatenated into SQL.
 * - The project and dataset names are identifiers. They are validated before they go into SQL.
 *
 * Never log credentials. This module logs nothing.
 */
import { BigQuery, type Query } from "@google-cloud/bigquery";

/** Parameter type map accepted by the client (Query["types"]). */
export type QueryParamTypes = NonNullable<Query["types"]>;

export interface BqConfig {
  projectId: string;
  dataset: string;
  location: string;
  /** Bytes. Sent as maximumBytesBilled on every routine query; the sync also aborts when a dry run is above it. */
  maxBytesBilled: number;
  /** Bytes. Same guard for the base-period (BASE mode) queries only. */
  maxBytesBilledBase: number;
  keyFilename?: string;
  /** From BIGQUERY_CREDENTIALS_JSON. Wins over keyFilename. */
  credentials?: ServiceAccountKey;
}

/** The fields of a service account key file that the client needs. */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

/** A parameterised query. `types` gives the BigQuery type of each parameter (needed for empty arrays and DATE). */
export interface QuerySpec {
  name: string;
  sql: string;
  params: Record<string, unknown>;
  types: QueryParamTypes;
}

const IDENT = /^[A-Za-z0-9_-]+$/;
/** Routine sync: about 75 MB per metric query (dry runs, 16-10-2026). */
const DEFAULT_MAX_BYTES = 1_000_000_000;
/** Base-period sync: about 2.2 GB per metric query (NULL partition). */
const DEFAULT_MAX_BYTES_BASE = 5_000_000_000;

function bytesFromEnv(name: string, raw: string | undefined, fallback: number): number {
  const v = raw?.trim();
  const n = v ? Number(v) : fallback;
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number of bytes: ${v}`);
  return Math.floor(n);
}

/**
 * BIGQUERY_CREDENTIALS_JSON: the service account key file as base64 on one line (`base64 -w0 key.json`;
 * macOS `base64 -i key.json`), or its JSON on one line. Empty = undefined. The error never contains the value.
 */
export function parseServiceAccountKey(raw: string | undefined): ServiceAccountKey | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  let key: unknown;
  try {
    key = JSON.parse(v.startsWith("{") ? v : Buffer.from(v, "base64").toString("utf8"));
  } catch {
    throw new Error("BIGQUERY_CREDENTIALS_JSON is neither base64 of the key file nor its JSON");
  }
  const k = key as Partial<ServiceAccountKey> | null;
  if (typeof k?.client_email !== "string" || typeof k.private_key !== "string") {
    throw new Error("BIGQUERY_CREDENTIALS_JSON is not a service account key (client_email, private_key missing)");
  }
  return { client_email: k.client_email, private_key: k.private_key };
}

export function getBqConfig(env: NodeJS.ProcessEnv = process.env): BqConfig {
  const projectId = env.BIGQUERY_PROJECT_ID?.trim() || "example-project";
  const dataset = env.BIGQUERY_DATASET?.trim() || "Testdb";
  const location = env.BIGQUERY_LOCATION?.trim() || "asia-south1";
  if (!IDENT.test(projectId)) throw new Error(`BIGQUERY_PROJECT_ID is not a valid identifier: ${projectId}`);
  if (!IDENT.test(dataset)) throw new Error(`BIGQUERY_DATASET is not a valid identifier: ${dataset}`);
  const maxBytesBilled = bytesFromEnv("BIGQUERY_MAX_BYTES_BILLED", env.BIGQUERY_MAX_BYTES_BILLED, DEFAULT_MAX_BYTES);
  const maxBytesBilledBase = bytesFromEnv("BIGQUERY_MAX_BYTES_BILLED_BASE", env.BIGQUERY_MAX_BYTES_BILLED_BASE, DEFAULT_MAX_BYTES_BASE);
  const keyFilename = env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || undefined;
  const credentials = parseServiceAccountKey(env.BIGQUERY_CREDENTIALS_JSON);
  return { projectId, dataset, location, maxBytesBilled, maxBytesBilledBase, keyFilename, credentials };
}

let client: BigQuery | undefined;

export function getBigQuery(cfg: BqConfig = getBqConfig()): BigQuery {
  if (!client) {
    client = new BigQuery({
      projectId: cfg.projectId,
      location: cfg.location,
      ...(cfg.credentials ? { credentials: cfg.credentials } : cfg.keyFilename ? { keyFilename: cfg.keyFilename } : {}),
    });
  }
  return client;
}

/**
 * Convert ISO date strings of DATE parameters to BigQueryDate.
 * The client sends a plain string with type DATE as NULL (checked with @google-cloud/bigquery 9.3.0).
 */
export function prepareParams(spec: Pick<QuerySpec, "params" | "types">): Record<string, unknown> {
  const types = spec.types as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.params)) {
    out[k] = types[k] === "DATE" && typeof v === "string" ? BigQuery.date(v) : v;
  }
  return out;
}

function toJobRequest(spec: QuerySpec, cfg: BqConfig, dryRun: boolean): Query {
  return {
    query: spec.sql,
    params: prepareParams(spec),
    types: spec.types,
    location: cfg.location,
    useLegacySql: false,
    maximumBytesBilled: String(cfg.maxBytesBilled),
    dryRun,
    labels: { app: "scheme-calculator", query: spec.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 63) },
  };
}

/** Dry run: validates the SQL and returns the bytes the query would scan. Costs nothing. */
export async function dryRun(spec: QuerySpec, cfg: BqConfig = getBqConfig()): Promise<{ bytes: number }> {
  const [job] = await getBigQuery(cfg).createQueryJob(toJobRequest(spec, cfg, true));
  const bytes = Number(job.metadata?.statistics?.totalBytesProcessed ?? 0);
  return { bytes };
}

export interface QueryRunResult<T> {
  rows: T[];
  bytesProcessed: number;
  bytesBilled: number;
  jobId: string | undefined;
}

/** Run a query and return all rows. maximumBytesBilled stops the job when the scan is too large. */
export async function runQuery<T>(spec: QuerySpec, cfg: BqConfig = getBqConfig()): Promise<QueryRunResult<T>> {
  const bq = getBigQuery(cfg);
  const [job] = await bq.createQueryJob(toJobRequest(spec, cfg, false));
  const [rows] = await job.getQueryResults({ autoPaginate: true });
  const [meta] = await job.getMetadata();
  const stats = meta?.statistics?.query ?? {};
  return {
    rows: rows as T[],
    bytesProcessed: Number(meta?.statistics?.totalBytesProcessed ?? stats.totalBytesProcessed ?? 0),
    bytesBilled: Number(stats.totalBytesBilled ?? 0),
    jobId: job.id,
  };
}

/** Human-readable byte size (for logs). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}
