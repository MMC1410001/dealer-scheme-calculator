/**
 * Makes a new JWT_SECRET (HS256 signing key for the API access tokens, 64 characters).
 * Usage: npm run auth:jwt-secret
 * Rotation: move the old value to JWT_PREVIOUS_SECRET, set the new JWT_SECRET, and remove JWT_PREVIOUS_SECRET
 * after JWT_TTL_SECONDS.
 */
import { newJwtSecretCommand } from "@/lib/auth/cli";

process.exitCode = newJwtSecretCommand(process.argv.slice(2));
