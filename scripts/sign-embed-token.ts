/**
 * Signs an iframe token for a dealer (testing and host-side reference).
 * Usage: npm run token:sign -- <dealer_code> [ttlSeconds]
 * Default TTL: 3600 seconds. Maximum: 86400 seconds (24 hours).
 */
import "dotenv/config";
import { EMBED_TOKEN_MAX_TTL_SECONDS, signEmbedToken } from "@/lib/auth/embed-token";

function main(): void {
  const [dealerCode, ttlArg] = process.argv.slice(2);
  if (!dealerCode) {
    console.error("Usage: npm run token:sign -- <dealer_code> [ttlSeconds]");
    process.exit(1);
  }
  const ttlSeconds = ttlArg ? Number(ttlArg) : 3600;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > EMBED_TOKEN_MAX_TTL_SECONDS) {
    console.error(`ttlSeconds must be an integer from 1 to ${EMBED_TOKEN_MAX_TTL_SECONDS}.`);
    process.exit(1);
  }
  const token = signEmbedToken({ dealerCode, ttlSeconds });
  const base = `http://localhost:${process.env.PORT ?? "3000"}`;
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  console.log(`Token (expires ${expires}):`);
  console.log(token);
  console.log("");
  console.log("URL:");
  console.log(`${base}/embed?token=${encodeURIComponent(token)}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
