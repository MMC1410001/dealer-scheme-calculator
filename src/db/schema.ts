/**
 * PostgreSQL schema (Drizzle ORM). Migrations: drizzle-kit (see CLAUDE.md section 13).
 *
 * The database stores only: scheme configuration, per-dealer totals from BigQuery, and calculated results.
 * Raw sales rows stay in BigQuery.
 */
import {
  pgTable,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  jsonb,
  serial,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/* ---------------- Scheme configuration (seeded from src/config; later written by the template upload) ---------------- */

export const scheme = pgTable("scheme", {
  tag: text("tag").primaryKey(),
  type: text("type").notNull(), // FESTIVE_BONANZA | STAR_POINTS
  name: text("name").notNull(),
  circularRef: text("circular_ref"),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  baseFromDate: date("base_from_date").notNull(),
  baseToDate: date("base_to_date").notNull(),
  odCheckDate: date("od_check_date").notNull(),
  finalOn: date("final_on").notNull(),
  exclusivityGroup: text("exclusivity_group").notNull(),
  /** Full SchemeConfig (engine/types.ts) as JSON: months, rules, flags, Star Points points config. */
  config: jsonb("config").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schemeSlab = pgTable(
  "scheme_slab",
  {
    schemeTag: text("scheme_tag").notNull().references(() => scheme.tag, { onDelete: "cascade" }),
    slabNo: integer("slab_no").notNull(),
    label: text("label").notNull(),
    periodGsrRequired: numeric("period_gsr_required", { precision: 16, scale: 2 }),
    minFirstMonthGsr: numeric("min_first_month_gsr", { precision: 16, scale: 2 }),
    growthPct: numeric("growth_pct", { precision: 6, scale: 2 }),
    pointsRequired: numeric("points_required", { precision: 16, scale: 2 }),
    giftDescription: text("gift_description").notNull(),
    giftValue: numeric("gift_value", { precision: 16, scale: 2 }),
    cnAlternative: numeric("cn_alternative", { precision: 16, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.schemeTag, t.slabNo] })],
);

/**
 * Scope rules in the template v3.0 shape (one value per cell, empty = all, AND within a row).
 * Extra columns product_category / product_group cover exclusions that the circulars name by category.
 * Template v3.0 has no category column (open item, docs/assumptions.md 2.12). Column list: docs/template-v3.md.
 */
export const schemeScopeRule = pgTable(
  "scheme_scope_rule",
  {
    id: serial("id").primaryKey(),
    schemeTag: text("scheme_tag").notNull().references(() => scheme.tag, { onDelete: "cascade" }),
    ruleType: text("rule_type").notNull(), // INCLUDE | EXCLUDE
    channel: text("channel"),
    zone: text("zone"),
    region: text("region"),
    area: text("area"),
    depot: text("depot"),
    productCode: text("product_code"),
    skuCode: text("sku_code"),
    productCategory: text("product_category"),
    productGroup: text("product_group"),
    // QUALIFICATION_AND_BENEFIT (default) or BENEFIT_ONLY ("Benefit only": the sales count for the slab, but the
    // matched rows get no benefit). Phase 1 uses only the default. See docs/template-v3.md.
    appliesTo: text("applies_to").notNull().default("QUALIFICATION_AND_BENEFIT"),
    remarks: text("remarks"),
  },
  (t) => [index("scheme_scope_rule_tag_idx").on(t.schemeTag)],
);

/** Star Points Table III: product → points category. */
export const spProductCategory = pgTable(
  "sp_product_category",
  {
    schemeTag: text("scheme_tag").notNull().references(() => scheme.tag, { onDelete: "cascade" }),
    productCode: text("product_code").notNull(),
    productName: text("product_name").notNull(),
    productCategory: text("product_category"),
    brand: text("brand"),
    starCategory: text("star_category").notNull(), // LUXURY | PREMIUM | ECONOMY | ENAMELS | OTHERS | TOOLS
    channel12Eligible: boolean("channel12_eligible").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.schemeTag, t.productCode] })],
);

/* ---------------- Masters and inputs (from BigQuery / backend) ---------------- */

export const dealer = pgTable("dealer", {
  code: text("code").primaryKey(),
  name: text("name"),
  zone: text("zone"),
  regionCode: text("region_code"),
  regionName: text("region_name"),
  territoryName: text("territory_name"),
  depotCode: text("depot_code"),
  /** Parent dealer code (Testdb.parent_child). Null when the dealer is a parent or has no parent. */
  parentCode: text("parent_code"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Dealer–scheme enrolment (Festive Bonanza or Star Points). No row = show all schemes in scope. */
export const dealerSchemeEnrolment = pgTable("dealer_scheme_enrolment", {
  dealerCode: text("dealer_code").primaryKey(),
  schemeTag: text("scheme_tag").notNull(),
  source: text("source"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Dealer's reward choice: one current row per dealer (parent code) and scheme. No row = not chosen.
 * Written by the admin area (one choice or a file upload) and the API. The iframe only shows it. A re-send of the same values writes nothing.
 */
export const dealerRewardChoice = pgTable(
  "dealer_reward_choice",
  {
    dealerCode: text("dealer_code").notNull(),
    schemeTag: text("scheme_tag").notNull(),
    choice: text("choice").notNull(), // GIFT | CN
    destination: text("destination"), // CRUISE | OVERSEAS (Star Points extra tickets); null = not chosen
    source: text("source"), // ADMIN | UPLOAD | API | DEMO
    chosenBy: text("chosen_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dealerCode, t.schemeTag] })],
);

/**
 * One row for each reward choice file upload (history on /admin/choices). The rows that the upload changed are in
 * dealer_reward_choice_log (upload_id). Kept as long as the log (cleanup: 3 months).
 */
export const rewardChoiceUpload = pgTable(
  "reward_choice_upload",
  {
    id: serial("id").primaryKey(),
    fileName: text("file_name").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    rowCount: integer("row_count").notNull().default(0),
    changed: integer("changed").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    refused: integer("refused").notNull().default(0),
  },
  (t) => [index("reward_choice_upload_at_idx").on(t.uploadedAt)],
);

/**
 * Audit trail of reward choice changes: one row for each change (not for an unchanged re-send).
 * actor: who sent the change (admin user for an upload or the dealer page, OAuth client_id for the API). chosen_by is
 * the person named in the data (for example the sales officer). upload_id: the file upload that made the change.
 */
export const dealerRewardChoiceLog = pgTable(
  "dealer_reward_choice_log",
  {
    id: serial("id").primaryKey(),
    dealerCode: text("dealer_code").notNull(),
    schemeTag: text("scheme_tag").notNull(),
    choice: text("choice").notNull(),
    destination: text("destination"),
    source: text("source").notNull(),
    chosenBy: text("chosen_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor"),
    uploadId: integer("upload_id").references(() => rewardChoiceUpload.id, { onDelete: "set null" }),
  },
  (t) => [
    index("dealer_reward_choice_log_dealer_idx").on(t.dealerCode, t.schemeTag),
    index("dealer_reward_choice_log_changed_idx").on(t.changedAt),
    index("dealer_reward_choice_log_upload_idx").on(t.uploadId),
  ],
);

/** OD (outstanding) status on a check date. No row = unknown / pending. */
export const dealerOdStatus = pgTable(
  "dealer_od_status",
  {
    dealerCode: text("dealer_code").notNull(),
    asOfDate: date("as_of_date").notNull(),
    hasOd: boolean("has_od").notNull(),
    odAmount: numeric("od_amount", { precision: 16, scale: 2 }),
    source: text("source"),
  },
  (t) => [primaryKey({ columns: [t.dealerCode, t.asOfDate] })],
);

/**
 * Per-dealer monthly totals from the BigQuery sync. One row per dealer × scheme × metric × month.
 * metric: gsr | mrv | tools_gsr | litres_LUXURY | litres_PREMIUM | litres_ECONOMY | litres_ENAMELS | litres_OTHERS
 */
export const dealerMetric = pgTable(
  "dealer_metric",
  {
    dealerCode: text("dealer_code").notNull(),
    schemeTag: text("scheme_tag").notNull(),
    metric: text("metric").notNull(),
    month: text("month").notNull(), // YYYY-MM
    value: numeric("value", { precision: 18, scale: 3 }).notNull(),
    syncRunId: integer("sync_run_id"),
  },
  (t) => [primaryKey({ columns: [t.dealerCode, t.schemeTag, t.metric, t.month] }), index("dealer_metric_scheme_idx").on(t.schemeTag)],
);

/* ---------------- Automatic setup at server start (src/server/db-setup.ts) ---------------- */

/** One row per key: scheme_config_hash (last seed), engine_build_id (build of the last startup engine run). */
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------- Runs and results ---------------- */

export const syncRun = pgTable("sync_run", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // BIGQUERY | CSV | DEMO
  status: text("status").notNull(), // RUNNING | SUCCESS | FAILED
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  /** Latest billing date in the source data used. */
  dataAsOf: timestamp("data_as_of", { withTimezone: true }),
  rowCount: integer("row_count"),
  bytesProcessed: numeric("bytes_processed", { precision: 20, scale: 0 }),
  message: text("message"),
});

export const dealerSchemeResult = pgTable(
  "dealer_scheme_result",
  {
    dealerCode: text("dealer_code").notNull(),
    schemeTag: text("scheme_tag").notNull(),
    participation: text("participation").notNull(), // IN_SCHEME | NOT_IN_SCOPE
    reasonCode: text("reason_code"),
    currentSlabNo: integer("current_slab_no"),
    benefitBlocked: boolean("benefit_blocked").notNull().default(false),
    provisional: boolean("provisional").notNull().default(true),
    /** SchemeStatus (engine/types.ts) – the iframe renders this directly. */
    status: jsonb("status").notNull(),
    syncRunId: integer("sync_run_id"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.dealerCode, t.schemeTag] }), index("dealer_scheme_result_scheme_idx").on(t.schemeTag, t.currentSlabNo)],
);
