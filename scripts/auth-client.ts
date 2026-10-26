/**
 * Makes a new OAuth2 client for the dealer status API.
 * Usage: npm run auth:client -- <client_id>
 * Prints the client_secret ONE time. Give it to the client system over a secure channel. Do not store it here.
 * Merge the printed {"<client_id>": "<sha256>"} entry into AUTH_CLIENTS. The server stores only the hash.
 */
import { newClientCommand } from "@/lib/auth/cli";

process.exitCode = newClientCommand(process.argv.slice(2));
