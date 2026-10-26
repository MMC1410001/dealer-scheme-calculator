import "dotenv/config";
/**
 * Print INFORMATION_SCHEMA.COLUMNS for the BigQuery tables the sync uses, so that the column mapping
 * in docs/bigquery-schema.md can be checked again. Metadata query only (no table scan).
 *
 * Usage: npm run bq:inspect [-- table1 table2 ...]
 */
import { formatBytes, getBqConfig, runQuery } from "@/sync/bigquery-client";
import { buildInspectSchemaQuery } from "@/sync/queries";

const DEFAULT_TABLES = ["zsd_sales", "zsd_billing", "parent_child", "customer_attributes", "test_product", "Trip_Scheme_SKUs"];

interface ColumnRow {
  table_name: string;
  ordinal_position: number;
  column_name: string;
  data_type: string;
  is_partitioning_column: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const tables = args.length ? args : DEFAULT_TABLES;
  const cfg = getBqConfig();
  const res = await runQuery<ColumnRow>(buildInspectSchemaQuery({ projectId: cfg.projectId, dataset: cfg.dataset }, tables), cfg);
  const byTable = new Map<string, ColumnRow[]>();
  for (const r of res.rows) byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r]);
  for (const name of tables) {
    const cols = byTable.get(name);
    console.log(`\n## ${cfg.projectId}.${cfg.dataset}.${name}`);
    if (!cols) {
      console.log("(table not found)");
      continue;
    }
    console.log(
      cols.map((c) => `${c.column_name}:${c.data_type}${c.is_partitioning_column === "YES" ? " (partition)" : ""}`).join(", "),
    );
  }
  console.log(`\nScanned ${formatBytes(res.bytesProcessed)}.`);
}

main().catch((err: unknown) => {
  console.error("Schema inspection failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
