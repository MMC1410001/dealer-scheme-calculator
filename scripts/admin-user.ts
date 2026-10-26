/**
 * Makes a new user for the admin area (Reward choices and Dealers; ADMIN also has the report and the sync runs).
 * Usage: npm run admin:user -- <username> [ADMIN|CHOICES]   (default role: CHOICES)
 * Prints a random password ONE time. Give it to the user over a secure channel. Do not store it here.
 * Merge the printed {"<username>": {"role": ..., "password": "<hash>"}} entry into ADMIN_USERS. The server stores only the hash.
 */
import { newAdminUserCommand } from "@/lib/auth/cli";

newAdminUserCommand(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
