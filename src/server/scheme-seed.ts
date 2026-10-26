/**
 * Seed the scheme configuration (phase 1: the 3 circulars hard-coded in src/config).
 * Writes: scheme, scheme_slab, scheme_scope_rule, sp_product_category, and the configuration hash in app_state.
 * Idempotent: for each scheme, delete its child rows and insert them again, in one transaction.
 *
 * Users: `npm run db:seed` (scripts/db-seed.ts) and the automatic setup at server start (src/server/db-setup.ts),
 * which seeds only when the hash of the rows differs from the stored hash.
 * The caller holds the sync lock: a sync running at the same time would read a half-changed configuration.
 * Do not import "server-only" here: the tsx script imports this module.
 */
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { appState, spProductCategory, scheme, schemeScopeRule, schemeSlab } from "@/db/schema";
import { SP_PRODUCTS } from "@/config/star-points-products";
import { CHANNELS, FB_EXCLUSIONS, SP_TOOLS_PRODUCT_CODES, SCHEME_CHANNELS, SCHEMES } from "@/config/schemes";
import { bumpDataVersion } from "@/server/cache";
import {
  buildGtProductRows,
  buildSchemeRow,
  buildScopeRules,
  buildSlabRows,
  type GtProductRow,
  type ScopeRuleRow,
} from "@/server/scheme-loader";

/** app_state key of the hash of the seeded rows. */
export const SCHEME_CONFIG_HASH_KEY = "scheme_config_hash";

const CHUNK = 500;

export interface SeedScheme {
  scheme: ReturnType<typeof buildSchemeRow>;
  slabs: ReturnType<typeof buildSlabRows>;
  rules: ScopeRuleRow[];
  spProducts: GtProductRow[];
}

export interface SeedPlan {
  schemes: SeedScheme[];
  /** sha256 of the rows. A change in src/config that changes a row changes the hash. */
  hash: string;
}

/** The rows that the seed writes, from src/config, and their hash. */
export function buildSeedPlan(): SeedPlan {
  if (SCHEMES.some((s) => s.type === "STAR_POINTS") && SP_PRODUCTS.length === 0) {
    throw new Error("SP_PRODUCTS is empty (src/config/star-points-products.ts, Star Points Table III).");
  }
  const schemes = SCHEMES.map((cfg) => ({
    scheme: buildSchemeRow(cfg),
    slabs: buildSlabRows(cfg),
    rules: buildScopeRules(cfg, {
      schemeChannels: SCHEME_CHANNELS,
      fbExclusions: FB_EXCLUSIONS,
      institutionalChannel: CHANNELS.INSTITUTIONAL,
    }),
    spProducts: cfg.type === "STAR_POINTS" ? buildGtProductRows(cfg.tag, SP_PRODUCTS, SP_TOOLS_PRODUCT_CODES) : [],
  }));
  const hash = createHash("sha256").update(JSON.stringify(schemes)).digest("hex");
  return { schemes, hash };
}

/** Writes the plan in one transaction. Returns one summary line per scheme. */
export async function seedSchemes(db: Db, plan: SeedPlan = buildSeedPlan()): Promise<string[]> {
  const lines: string[] = [];
  await db.transaction(async (tx) => {
    for (const s of plan.schemes) {
      const tag = s.scheme.tag;
      await tx
        .insert(scheme)
        .values(s.scheme)
        .onConflictDoUpdate({ target: scheme.tag, set: { ...s.scheme, updatedAt: sql`now()` } });

      await tx.delete(schemeSlab).where(eq(schemeSlab.schemeTag, tag));
      await tx.delete(schemeScopeRule).where(eq(schemeScopeRule.schemeTag, tag));
      await tx.delete(spProductCategory).where(eq(spProductCategory.schemeTag, tag));

      if (s.slabs.length) await tx.insert(schemeSlab).values(s.slabs);
      if (s.rules.length) await tx.insert(schemeScopeRule).values(s.rules);
      for (let i = 0; i < s.spProducts.length; i += CHUNK) {
        await tx.insert(spProductCategory).values(s.spProducts.slice(i, i + CHUNK));
      }

      lines.push(
        `${tag.padEnd(5)} ${s.scheme.type.padEnd(14)} slabs=${s.slabs.length} scope_rules=${s.rules.length}` +
          (s.scheme.type === "STAR_POINTS" ? ` sp_products=${s.spProducts.length}` : ""),
      );
    }
    await tx
      .insert(appState)
      .values({ key: SCHEME_CONFIG_HASH_KEY, value: plan.hash })
      .onConflictDoUpdate({ target: appState.key, set: { value: plan.hash, updatedAt: sql`now()` } });
  });
  // The active scheme tags can change: cached API answers (also UNKNOWN_SCHEME_TAG) must not be served again.
  await bumpDataVersion();
  return lines;
}
