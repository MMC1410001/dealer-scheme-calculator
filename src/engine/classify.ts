/**
 * Slab classification (CLAUDE.md section 6 and section 11).
 */
import type { ClassificationRule } from "./types";

/**
 * Picks the dealer's slab.
 *
 * @param slabResults per slab (in slab order), per condition: true when the condition is met.
 * @param rule STOP_AT_FIRST_FAIL (default rule) or HIGHEST_ALL_MET.
 * @returns the 0-based index of the current slab in `slabResults`, or null for no slab.
 *
 * STOP_AT_FIRST_FAIL: check Slab 1, Slab 2, ... in order. A slab is met only when ALL its
 * conditions are met (AND). Stop at the first slab with any unmet condition; the dealer is in
 * the previous slab. If Slab 1 fails, the dealer is in no slab.
 *
 * HIGHEST_ALL_MET: the dealer is in the highest slab whose conditions are all met.
 */
export function classifySlabs(slabResults: boolean[][], rule: ClassificationRule): number | null {
  let current: number | null = null;
  for (let i = 0; i < slabResults.length; i++) {
    const allMet = slabResults[i].every(Boolean);
    if (allMet) {
      current = i;
    } else if (rule === "STOP_AT_FIRST_FAIL") {
      break;
    }
  }
  return current;
}
