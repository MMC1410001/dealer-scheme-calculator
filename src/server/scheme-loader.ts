/**
 * Scheme configuration <-> database.
 *
 * - loadSchemes(db): the engine reads the scheme configuration from PostgreSQL (not from src/config).
 * - buildSchemeRows / buildScopeRules / buildGtProductRows: pure functions that turn a SchemeConfig
 *   into table rows. The seed script uses them. The later template upload must write the same rows.
 *
 * Do not import "server-only" here: tsx scripts import this module.
 */
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { scheme } from "@/db/schema";
import type { StarCategory, SchemeConfig } from "@/engine/types";

/** Active schemes from scheme.config, ordered by tag. */
export async function loadSchemes(db: Db): Promise<SchemeConfig[]> {
  const rows = await db
    .select({ tag: scheme.tag, config: scheme.config })
    .from(scheme)
    .where(eq(scheme.active, true))
    .orderBy(asc(scheme.tag));
  // The DB tag is the key. Keep the config tag in step with it.
  return rows.map((r) => ({ ...(r.config as SchemeConfig), tag: r.tag }));
}

/* ------------------------------------------------------------------ */
/* Pure row builders                                                    */
/* ------------------------------------------------------------------ */

export type ScopeRuleType = "INCLUDE" | "EXCLUDE";

/** One row of scheme_scope_rule (template v3.0 shape: one value per cell, empty = all, AND within a row). */
export interface ScopeRuleRow {
  schemeTag: string;
  ruleType: ScopeRuleType;
  channel: string | null;
  zone: string | null;
  region: string | null;
  area: string | null;
  depot: string | null;
  productCode: string | null;
  skuCode: string | null;
  productCategory: string | null;
  productGroup: string | null;
  appliesTo: string;
  remarks: string | null;
}

export interface ScopeInputs {
  /** Channel codes per scheme tag (SCHEME_CHANNELS). */
  schemeChannels: Record<string, string[]>;
  /** Festive Bonanza product exclusions (FB_EXCLUSIONS). */
  fbExclusions: { categoryNames: string[]; productGroups: string[]; productCodes: string[] };
  /** Channel code whose billing counts only for channel12Eligible Star Points products. */
  institutionalChannel?: string;
}

function emptyRule(schemeTag: string, ruleType: ScopeRuleType): ScopeRuleRow {
  return {
    schemeTag,
    ruleType,
    channel: null,
    zone: null,
    region: null,
    area: null,
    depot: null,
    productCode: null,
    skuCode: null,
    productCategory: null,
    productGroup: null,
    appliesTo: "QUALIFICATION_AND_BENEFIT",
    remarks: null,
  };
}

/**
 * Expand one scheme into scope rule rows. One value per row (decision 3).
 * - INCLUDE one row per channel code.
 * - Region scope: one INCLUDE or EXCLUDE row per region name. Null region scope = Pan India = no row.
 * - Festive Bonanza: one EXCLUDE row per excluded category, product group and product code.
 * - Star Points: product scope is the sp_product_category table (Table III), not scope rows.
 */
export function buildScopeRules(cfg: SchemeConfig, inputs: ScopeInputs): ScopeRuleRow[] {
  const rows: ScopeRuleRow[] = [];
  const tag = cfg.tag;

  for (const channel of inputs.schemeChannels[tag] ?? []) {
    const r = emptyRule(tag, "INCLUDE");
    r.channel = channel;
    if (cfg.type === "STAR_POINTS" && inputs.institutionalChannel && channel === inputs.institutionalChannel) {
      r.remarks = "Channel 12: only Acme One Emulsions topcoats (sp_product_category.channel12_eligible).";
    }
    rows.push(r);
  }

  if (cfg.regionScope) {
    for (const region of cfg.regionScope.regionNames) {
      const r = emptyRule(tag, cfg.regionScope.mode);
      r.region = region;
      rows.push(r);
    }
  }

  if (cfg.type === "FESTIVE_BONANZA") {
    for (const category of inputs.fbExclusions.categoryNames) {
      const r = emptyRule(tag, "EXCLUDE");
      r.productCategory = category;
      r.remarks = "test_product.categoryname";
      rows.push(r);
    }
    for (const group of inputs.fbExclusions.productGroups) {
      const r = emptyRule(tag, "EXCLUDE");
      r.productGroup = group;
      r.remarks = "test_product.productgrp";
      rows.push(r);
    }
    for (const code of inputs.fbExclusions.productCodes) {
      const r = emptyRule(tag, "EXCLUDE");
      r.productCode = code;
      rows.push(r);
    }
  }

  return rows;
}

/** scheme table row (without updatedAt). */
export function buildSchemeRow(cfg: SchemeConfig) {
  return {
    tag: cfg.tag,
    type: cfg.type,
    name: cfg.name,
    circularRef: cfg.circularRef,
    fromDate: cfg.fromDate,
    toDate: cfg.toDate,
    baseFromDate: cfg.baseFromDate,
    baseToDate: cfg.baseToDate,
    odCheckDate: cfg.odCheckDate,
    finalOn: cfg.finalOn,
    exclusivityGroup: cfg.exclusivityGroup,
    config: cfg,
    active: true,
  };
}

const num = (v: number | null | undefined): string | null => (v === null || v === undefined ? null : String(v));

/** scheme_slab rows. Numeric columns as strings (Drizzle numeric). */
export function buildSlabRows(cfg: SchemeConfig) {
  return cfg.slabs.map((s) => ({
    schemeTag: cfg.tag,
    slabNo: s.slabNo,
    label: s.label,
    periodGsrRequired: num(s.periodGsrRequired),
    minFirstMonthGsr: num(s.minFirstMonthGsr),
    growthPct: num(s.growthPct),
    pointsRequired: num(s.pointsRequired),
    giftDescription: s.gift.description,
    giftValue: num(s.gift.value),
    cnAlternative: String(s.cnAlternative),
  }));
}

export interface GtProductInput {
  productCode: string;
  productName: string;
  productCategory: string;
  brand: string;
  starCategory: StarCategory;
  channel12Eligible: boolean;
}

export interface GtProductRow {
  schemeTag: string;
  productCode: string;
  productName: string;
  productCategory: string | null;
  brand: string | null;
  starCategory: StarCategory | "TOOLS";
  channel12Eligible: boolean;
}

/**
 * sp_product_category rows: Table III products plus tools codes (star_category TOOLS).
 * A product code appears once. A Table III product wins over a tools code.
 */
export function buildGtProductRows(schemeTag: string, products: GtProductInput[], toolsCodes: string[]): GtProductRow[] {
  const byCode = new Map<string, GtProductRow>();
  for (const p of products) {
    if (byCode.has(p.productCode)) continue;
    byCode.set(p.productCode, {
      schemeTag,
      productCode: p.productCode,
      productName: p.productName,
      productCategory: p.productCategory || null,
      brand: p.brand || null,
      starCategory: p.starCategory,
      channel12Eligible: p.channel12Eligible,
    });
  }
  for (const code of toolsCodes) {
    if (byCode.has(code)) continue;
    byCode.set(code, {
      schemeTag,
      productCode: code,
      productName: "Tools (Rollers / Sandpapers / Masking Tapes)",
      productCategory: "Tools",
      brand: null,
      starCategory: "TOOLS",
      channel12Eligible: false,
    });
  }
  return [...byCode.values()];
}
