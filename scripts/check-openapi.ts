/**
 * Checks docs/openapi.json against the code (see src/server/api/openapi-check.ts).
 * Usage: npm run openapi:check. Exit code 1 when a problem is found.
 */
import path from "node:path";
import { checkOpenApi, loadSpec } from "@/server/api/openapi-check";

const root = process.cwd();
const problems = checkOpenApi(loadSpec(root), path.join(root, "src", "app", "api", "v1"));
if (problems.length > 0) {
  for (const p of problems) console.error(`- ${p}`);
  console.error(`OpenAPI check: ${problems.length} problem(s).`);
  process.exitCode = 1;
} else {
  console.log("OpenAPI check: no problems.");
}
