/**
 * Scheme engine contracts.
 *
 * The engine is plain TypeScript. It has no dependency on Next.js, the database or BigQuery.
 * All amounts are in INR (rupees, not lakh). Months are "YYYY-MM" strings.
 */

export type SchemeType = "FESTIVE_BONANZA" | "STAR_POINTS";

/** How the engine picks the dealer's slab (CLAUDE.md section 6 and section 11). */
export type ClassificationRule =
  /** Check slabs in order. Stop at the first slab with any unmet condition. Dealer is in the previous slab. */
  | "STOP_AT_FIRST_FAIL"
  /** Dealer is in the highest slab whose conditions are all met. */
  | "HIGHEST_ALL_MET";

/**
 * What the growth condition returns when the base (Q1) GSR is zero or less.
 * MET_IF_ANY_BASE_SALES: met only when the dealer had Q1 sales of any product (totalGsrByMonth), so a dealer with
 * no Q1 sales at all is not eligible (BA, 19-10-2026).
 */
export type ZeroBaseGrowthRule = "MET" | "NOT_MET" | "MET_IF_ANY_BASE_SALES";

/** Which GSR the growth condition compares. SCHEME_PRODUCTS = gsrByMonth; ALL_PRODUCTS = totalGsrByMonth. */
export type GrowthGsrBasis = "SCHEME_PRODUCTS" | "ALL_PRODUCTS";

export type StarCategory = "LUXURY" | "PREMIUM" | "ECONOMY" | "ENAMELS" | "OTHERS";
export const STAR_CATEGORIES: readonly StarCategory[] = ["LUXURY", "PREMIUM", "ECONOMY", "ENAMELS", "OTHERS"];

export type ConditionKey = "period_gsr" | "min_first_month_gsr" | "growth_pct" | "points";

export interface Gift {
  description: string;
  /** INR. Null for trips. */
  value: number | null;
}

export interface SlabConfig {
  slabNo: number;
  label: string; // "Slab 1"
  /** Festive Bonanza: Oct + Nov GSR required, INR. */
  periodGsrRequired?: number;
  /** Festive Bonanza: minimum GSR in the first month (Oct), INR. */
  minFirstMonthGsr?: number;
  /** Growth % required. Festive Bonanza FB-PAN and Star Points. Undefined = no growth condition. */
  growthPct?: number;
  /** Star Points: points required. */
  pointsRequired?: number;
  gift: Gift;
  cnAlternative: number;
}

/** Star Points extra benefit beyond a top slab (circular page 2, "Additional Trip/CN criteria"). */
export interface ExtraBenefitRule {
  /** The slab the dealer must be in (or above) for this rule to apply. */
  fromSlabNo: number;
  /** Points threshold. Extra benefit counts on points above this value. */
  beyondPoints: number;
  /** Trip option: one more ticket for every `tripEveryPoints` points. */
  tripEveryPoints: number;
  tripDescription: string;
  tripCnValue: number;
  /** CN option: `cnPerStep` INR for every `cnEveryPoints` points. */
  cnEveryPoints: number;
  cnPerStep: number;
  /** Trip destination of this rule. The dealer selects only 1 destination (circular p2). Missing = no destination choice. */
  destination?: TripDestination;
}

/** Star Points trip destinations (circular p2: "Overseas Tour or Island/equivalent Cruise"). */
export type TripDestination = "CRUISE" | "OVERSEAS";

export interface StarPointsPointsConfig {
  /** Base points per litre, whole scheme period. */
  basePerLitre: Record<StarCategory, number>;
  /** Bonus points per litre by month ("YYYY-MM"). A missing month or category = 0. */
  bonusPerLitre: Record<string, Partial<Record<StarCategory, number>>>;
  /** Tools: `toolsPointsPerStep` points for every `toolsGsrStep` INR GSR. */
  toolsGsrStep: number;
  toolsPointsPerStep: number;
  extraBenefits: ExtraBenefitRule[];
}

export interface SchemeConfig {
  tag: string; // configurable, for example "FB-PAN"
  type: SchemeType;
  name: string;
  circularRef: string;
  fromDate: string; // ISO date
  toDate: string; // ISO date
  /** Months of the scheme period, in order. Festive Bonanza: ["2026-10","2026-11"]. */
  periodMonths: string[];
  /** Base period (Q1 FY 2026-27). */
  baseFromDate: string;
  baseToDate: string;
  baseMonths: string[];
  /** Number of months to divide base GSR by for the monthly average (3 for a quarter). */
  baseMonthCount: number;
  /** Return window month(s) after the end date (material returns deducted). */
  returnWindowMonths: string[];
  odCheckDate: string;
  /** Date after which the result is final (end of the return window). */
  finalOn: string;
  /** Exclusivity group. A dealer can join only one group (FESTIVE_BONANZA or STAR_POINTS). */
  exclusivityGroup: string;
  /** Region scope with region names as in the dealer master. Null = Pan India (no region condition). */
  regionScope: { mode: "INCLUDE" | "EXCLUDE"; regionNames: string[] } | null;
  classificationRule: ClassificationRule;
  zeroBaseGrowthRule: ZeroBaseGrowthRule;
  /** Star Points only. Default SCHEME_PRODUCTS. Festive Bonanza always uses the scheme products. */
  growthGsrBasis?: GrowthGsrBasis;
  slabs: SlabConfig[];
  starPoints?: StarPointsPointsConfig;
}

/**
 * Per-dealer totals for one scheme, as the sync job stores them.
 * All GSR values are net values (sales − cancellations − material returns) for the scheme's product and channel scope.
 */
export interface DealerSchemeMetrics {
  /** GSR by month ("YYYY-MM"). Includes base months, period months and return-window months (returns only). */
  gsrByMonth: Record<string, number>;
  /** Material return value by month (negative or zero), for display. Already included in gsrByMonth. */
  mrvByMonth: Record<string, number>;
  /**
   * GSR of all products by month, in the scheme's channels (same months and billing types as gsrByMonth).
   * Missing (old data, demo data) = gsrByMonth is used instead.
   */
  totalGsrByMonth?: Record<string, number>;
  /** Star Points: net litres by month by category. */
  litresByMonth?: Record<string, Partial<Record<StarCategory, number>>>;
  /** Star Points: net tools GSR by month. */
  toolsGsrByMonth?: Record<string, number>;
}

export interface DealerContext {
  dealerCode: string;
  dealerName?: string | null;
  /** Region name from the dealer master. Null = unknown. */
  regionName: string | null;
  /** Scheme tag the dealer enrolled in. Null = no enrolment record. */
  enrolledSchemeTag: string | null;
  /** OD status on the scheme's OD check date. Null = not known yet. */
  hasOdOnCheckDate: boolean | null;
}

/*
 * ---------- Output: the API contract in docs/api-contract.md (also the iframe data shape) ----------
 * Derived from the Frappe draft dealer-scheme-status-api.yaml v1.0.0-draft, without the `message` wrapper.
 * Additions to the draft: dealer_name, slab_no, current_slab_no, reason_code, benefit_blocked, od_status,
 * extra_benefits. Metric.value and Condition.actual can be null (zero Q1 base).
 * Header metric keys (display order): one GSR for each period month, growth_pct; Star Points also points_earned.
 * Condition keys: Festive Bonanza period_gsr, min_first_month_gsr, growth_pct (FB-PAN only); Star Points points, growth_pct.
 * Full list of differences from the Frappe draft: docs/api-contract.md section 12.
 */

export interface Metric {
  key: string;
  label: string;
  value: number | null;
  unit: "INR" | "PERCENT" | "POINTS";
}

export interface Condition {
  key: ConditionKey;
  label: string;
  required: number;
  actual: number | null;
  met: boolean;
}

export interface SlabStatus {
  slab: string;
  slab_no: number;
  lock_status: "UNLOCKED" | "LOCKED";
  gift: Gift;
  cn_alternative: number;
  conditions: Condition[];
}

export interface ExtraBenefitStatus {
  description: string;
  /** Trip destination of the rule. Null when the rule has none. Missing in results stored before 22-10-2026. */
  destination?: TripDestination | null;
  extra_tickets: number;
  extra_ticket_cn_value: number;
  cn_option_value: number;
}

/** Reward choice of the dealer for a scheme: gift or CN, and the trip destination (Star Points, Slab 7). */
export type RewardChoiceValue = "GIFT" | "CN";
export type RewardChoiceSource = "ADMIN" | "UPLOAD" | "API" | "DEMO";

export interface RewardChoice {
  choice: RewardChoiceValue;
  /** Destination of the extra tickets. Null = not chosen or not applicable. */
  destination: TripDestination | null;
  /** Where the choice came from. Null for rows written before 22-10-2026. */
  source: RewardChoiceSource | null;
  /** Admin-area user name (one choice or upload), or chosen_by of the API. Null when not known. */
  chosen_by: string | null;
  updated_at: string;
}

export interface SchemeHeader {
  scheme_name: string;
  from_date: string;
  to_date: string;
  q1_monthly_avg_gsr: number;
  metrics: Metric[];
}

export type ParticipationReasonCode =
  | "REGION_NOT_IN_SCOPE"
  | "REGION_UNKNOWN"
  | "ENROLLED_IN_OTHER_SCHEME"
  | "NO_DATA";

/** Why a dealer in the scheme has no slab (first failed Slab 1 condition), or why the benefit is blocked. */
export type ResultReasonCode =
  | "SLAB1_PERIOD_GSR_NOT_MET"
  | "SLAB1_MIN_FIRST_MONTH_GSR_NOT_MET"
  | "SLAB1_GROWTH_NOT_MET"
  | "SLAB1_POINTS_NOT_MET"
  | "OD_ON_CHECK_DATE";

export interface SchemeStatus {
  scheme_tag: string;
  participation: "IN_SCHEME" | "NOT_IN_SCOPE";
  reason?: string;
  reason_code?: ParticipationReasonCode | ResultReasonCode;
  header?: SchemeHeader;
  provisional?: boolean;
  final_on?: string;
  /** Highest unlocked slab label. Null when no slab is unlocked. */
  current_slab?: string | null;
  current_slab_no?: number | null;
  /** True when OD on the check date blocks the benefit. */
  benefit_blocked?: boolean;
  od_status?: "NO_OD" | "OD" | "PENDING";
  details?: SlabStatus[];
  extra_benefits?: ExtraBenefitStatus[];
  /** Stored reward choice (IN_SCHEME only). Null = not chosen. Not engine output: added when the status is read. */
  reward_choice?: RewardChoice | null;
}

export interface DealerStatus {
  dealer_code: string;
  dealer_name?: string | null;
  data_as_of: string | null;
  schemes: SchemeStatus[];
}
