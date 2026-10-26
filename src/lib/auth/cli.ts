/**
 * Command-line helpers for the API auth settings (scripts/auth-client.ts and scripts/auth-jwt-secret.ts).
 * - newClientCommand: a new client_id + client_secret, and the AUTH_CLIENTS entry (hash only) for the server.
 * - newJwtSecretCommand: a new JWT_SECRET (64 characters).
 * - newAdminUserCommand: a new admin-area user with a random password, and the ADMIN_USERS entry (hash only).
 * They return the exit code and write with the given functions, so that tests can read the output.
 */
import { ADMIN_ROLES, ADMIN_USERNAME_PATTERN, hashAdminPassword, newAdminPassword, type AdminRole } from "@/lib/auth/admin-users";
import { CLIENT_ID_PATTERN, hashSecret, newClientSecret, newJwtSecret } from "@/lib/auth/clients";

type Write = (line: string) => void;

export function newClientCommand(args: string[], out: Write = console.log, err: Write = console.error): number {
  const [clientId, ...rest] = args;
  if (!clientId || rest.length > 0 || !CLIENT_ID_PATTERN.test(clientId)) {
    err("Usage: npm run auth:client -- <client_id>   (1-64 of A-Z a-z 0-9 . _ -)");
    return 2;
  }
  const secret = newClientSecret();
  out(`client_id:     ${clientId}`);
  out(`client_secret: ${secret}   <- give to the caller over a secure channel; it is shown only now`);
  out("AUTH_CLIENTS entry (server side; merge with the existing clients):");
  out(`  ${JSON.stringify({ [clientId]: hashSecret(secret) })}`);
  return 0;
}

export function newJwtSecretCommand(args: string[], out: Write = console.log, err: Write = console.error): number {
  if (args.length > 0) {
    err("Usage: npm run auth:jwt-secret");
    return 2;
  }
  out(newJwtSecret());
  return 0;
}

export async function newAdminUserCommand(args: string[], out: Write = console.log, err: Write = console.error): Promise<number> {
  const [username, roleArg = "CHOICES", ...rest] = args;
  const role = roleArg.toUpperCase() as AdminRole;
  if (!username || rest.length > 0 || !ADMIN_USERNAME_PATTERN.test(username) || !ADMIN_ROLES.includes(role)) {
    err("Usage: npm run admin:user -- <username> [ADMIN|CHOICES]   (username: 1-64 of A-Z a-z 0-9 . _ @ -; default role CHOICES)");
    return 2;
  }
  const password = newAdminPassword();
  out(`username: ${username}`);
  out(`role:     ${role}`);
  out(`password: ${password}   <- give to the user over a secure channel; it is shown only now`);
  out("ADMIN_USERS entry (server side; merge with the existing users):");
  out(`  ${JSON.stringify({ [username]: { role, password: await hashAdminPassword(password) } })}`);
  return 0;
}
