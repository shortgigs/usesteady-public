/**
 * Interaction Contract selectors.
 *
 * Pure functions that extract policy decisions from a contract.
 * Nothing should read contract fields directly outside this module.
 */

import type { InteractionContract } from "./types.js";

export function getAmbiguityPolicy(
  contract: InteractionContract,
): InteractionContract["ambiguityMode"] {
  return contract.ambiguityMode;
}

export function getExplanationPolicy(
  contract: InteractionContract,
): InteractionContract["explanationMode"] {
  return contract.explanationMode;
}

export function getUnsupportedGuidancePolicy(
  contract: InteractionContract,
): InteractionContract["unsupportedGuidanceMode"] {
  return contract.unsupportedGuidanceMode;
}

/**
 * Returns true if ambiguity should be treated conservatively
 * (i.e., always ask rather than guess).
 */
export function isConservativeAmbiguityMode(contract: InteractionContract): boolean {
  return contract.ambiguityMode === "conservative";
}
