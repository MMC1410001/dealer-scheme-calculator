/**
 * Participation check: decides IN_SCHEME or NOT_IN_SCOPE before the slab evaluation.
 *
 * Order:
 *  1. Enrolment. A dealer can join Festive Bonanza or Star Points, not both (exclusivity groups).
 *     If the dealer enrolled in a scheme of ANOTHER exclusivity group, this scheme is out of scope.
 *     Schemes of the same group (FB-PAN vs FB-TNHPJK) are decided by region, not by enrolment.
 *     An enrolment tag that is not in `allSchemes` is ignored (no exclusion).
 *  2. Region scope (INCLUDE / EXCLUDE list of dealer-master region names). Null scope = Pan India.
 *  3. No metrics for the dealer → NO_DATA.
 */
import type { DealerContext, DealerSchemeMetrics, ParticipationReasonCode, SchemeConfig } from "./types";

export type ParticipationResult =
  | { participation: "IN_SCHEME" }
  | { participation: "NOT_IN_SCOPE"; reason_code: ParticipationReasonCode; reason: string };

const norm = (s: string) => s.trim().toLowerCase();

export function checkParticipation(
  scheme: SchemeConfig,
  dealer: DealerContext,
  metrics: DealerSchemeMetrics | null,
  allSchemes: SchemeConfig[],
): ParticipationResult {
  const enrolledTag = dealer.enrolledSchemeTag?.trim();
  if (enrolledTag) {
    const enrolled = allSchemes.find((s) => s.tag === enrolledTag);
    if (enrolled && enrolled.exclusivityGroup !== scheme.exclusivityGroup) {
      return {
        participation: "NOT_IN_SCOPE",
        reason_code: "ENROLLED_IN_OTHER_SCHEME",
        reason: `Dealer is in scheme ${enrolled.tag}. A dealer can join only one of these schemes.`,
      };
    }
  }

  if (scheme.regionScope) {
    const region = dealer.regionName?.trim();
    if (!region) {
      return {
        participation: "NOT_IN_SCOPE",
        reason_code: "REGION_UNKNOWN",
        reason: "Dealer region is not known. This scheme applies only to some regions.",
      };
    }
    const inList = scheme.regionScope.regionNames.some((r) => norm(r) === norm(region));
    const inScope = scheme.regionScope.mode === "INCLUDE" ? inList : !inList;
    if (!inScope) {
      return {
        participation: "NOT_IN_SCOPE",
        reason_code: "REGION_NOT_IN_SCOPE",
        reason: "Dealer region is not in the scope of this scheme.",
      };
    }
  }

  if (metrics == null) {
    return {
      participation: "NOT_IN_SCOPE",
      reason_code: "NO_DATA",
      reason: "No sales data for this dealer in this scheme.",
    };
  }

  return { participation: "IN_SCHEME" };
}
