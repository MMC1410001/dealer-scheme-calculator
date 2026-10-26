/**
 * Run an npm script with the settings of another environment. .env (local) is not changed.
 *
 * Usage: npm run env -- <dev|uat|prod> <npm script> [args...]
 *   npm run env -- dev db:migrate
 *   npm run env -- dev sync:bigquery -- --dry-run --no-sql
 *   npm run env -- uat dev            (Next.js dev server with the UAT settings)
 *
 * Files (repository root, git-ignored): .env (local), .env.dev, .env.uat, .env.prod.
 * The values of the chosen file go into the process environment, so they win over .env for the scripts
 * (DOTENV_CONFIG_PATH points dotenv at the chosen file) and for Next.js (process values win over .env files).
 * A value that starts with TODO_ is not filled in yet: the script lists it before it starts.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";

const ENVS = ["dev", "uat", "prod"] as const;
type EnvName = (typeof ENVS)[number];

function main(): number {
  const [name, script, ...rest] = process.argv.slice(2);
  if (!ENVS.includes(name as EnvName) || !script) {
    console.error(`Usage: npm run env -- <${ENVS.join("|")}> <npm script> [args...]   (local = plain npm run, uses .env)`);
    return 2;
  }
  const file = `.env.${name}`;
  if (!fs.existsSync(file)) {
    console.error(`${file} does not exist.`);
    return 1;
  }
  const values = parse(fs.readFileSync(file));
  const todo = Object.entries(values)
    .filter(([, v]) => v.includes("TODO_"))
    .map(([k]) => k);
  if (todo.length > 0) console.warn(`[${file}] not filled in yet: ${todo.join(", ")}`);
  console.log(`[${file}] APP_ENV=${values.APP_ENV ?? "(not set)"} → npm run ${[script, ...rest].join(" ")}`);

  const res = spawnSync("npm", ["run", script, ...rest], {
    stdio: "inherit",
    env: { ...process.env, ...values, DOTENV_CONFIG_PATH: file },
  });
  return res.status ?? 1;
}

process.exitCode = main();
