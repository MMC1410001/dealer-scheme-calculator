/**
 * REDIS_URL checks without a Redis dependency (src/server/config.ts uses them at startup; src/server/redis.ts uses
 * them for the client). Plain TypeScript, no Next.js and no ioredis import.
 *
 * Accepted forms (decision Q7, 18-10-2026: the client's DevOps team provides Redis; TLS is not decided yet):
 * - redis://[[user]:password@]host[:port][/db]   plain TCP (local container, or a private network only)
 * - rediss://[[user]:password@]host[:port][/db]  TLS (recommended when Redis is not on a private network)
 * Special characters in the user name or the password must be percent-encoded (for example "@" as %40).
 */
const URL_SCHEME = /^(rediss?):\/\//i;

/** The parts of REDIS_URL that matter for the connection. No password, only whether one is set. */
export interface RedisUrlInfo {
  tls: boolean;
  host: string;
  port: number;
  db: number;
  username: string | null;
  hasPassword: boolean;
}

/** REDIS_URL with the scheme in lower case (ioredis turns TLS on only for a lower-case "rediss://"). */
export function normalizeRedisUrl(url: string): string {
  return url.trim().replace(URL_SCHEME, (m) => m.toLowerCase());
}

/**
 * Checks REDIS_URL. Returns the connection parts, or an error text that never contains the URL or the password.
 * Accepts redis:// and rediss:// with an optional user name, password, port (default 6379), db number (Redis
 * refuses a db that does not exist) and ioredis query options (for example ?family=6).
 */
export function parseRedisUrl(url: string): { ok: true; info: RedisUrlInfo } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "REDIS_URL must be a redis:// or rediss:// URL (redis[s]://[[user]:password@]host[:port][/db])" };
  const norm = normalizeRedisUrl(url);
  const m = URL_SCHEME.exec(norm);
  if (!m || /\s/.test(norm)) return bad;
  let u: URL;
  try {
    u = new URL(norm);
  } catch {
    return bad;
  }
  // A "#" in an unencoded password makes the rest a fragment: refuse it instead of a wrong password.
  if (!u.hostname || u.hash) return bad;
  const dbText = u.pathname.replace(/^\//, "");
  if (dbText !== "" && !/^\d{1,5}$/.test(dbText)) return bad;
  let username: string | null = null;
  try {
    username = u.username ? decodeURIComponent(u.username) : null;
    if (u.password) decodeURIComponent(u.password);
  } catch {
    return bad;
  }
  return {
    ok: true,
    info: {
      tls: m[1] === "rediss",
      host: u.hostname.replace(/^\[|\]$/g, ""),
      port: u.port ? Number(u.port) : 6379,
      db: dbText ? Number(dbText) : 0,
      username,
      hasPassword: u.password !== "",
    },
  };
}

/** REDIS_URL for a log or a message: the password (and the user name) replaced by "***". */
export function redactRedisUrl(url: string): string {
  return normalizeRedisUrl(url).replace(/^(rediss?:\/\/)[^@/\s]*@/i, "$1***@");
}

/** Short text of the Redis transport for the startup log: TLS or not, password or not. Never the URL. */
export function redisTransportText(url: string): string {
  const r = parseRedisUrl(url);
  if (!r.ok) return "REDIS_URL not valid";
  return `${r.info.tls ? "TLS (rediss://)" : "no TLS (redis://)"}, ${r.info.hasPassword ? "password set" : "no password"}`;
}

/**
 * The startup warning outside APP_ENV=local when REDIS_URL has no TLS or no password, else null.
 * Recommendation (Q7): rediss:// and a password when Redis is not on a private network.
 */
export function redisTransportWarning(url: string, appEnv: string): string | null {
  const r = parseRedisUrl(url);
  if (!r.ok || (r.info.tls && r.info.hasPassword)) return null;
  const missing = [r.info.tls ? null : "no TLS (redis://)", r.info.hasPassword ? null : "no password"].filter(Boolean).join(" and ");
  return (
    `REDIS_URL with APP_ENV=${appEnv} has ${missing}. Use this only when Redis is on a private network that only the ` +
    "app servers can reach. Otherwise use rediss:// and a password (Redis holds the rate-limit counts and cached dealer results)."
  );
}
