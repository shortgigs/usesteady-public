/**
 * Typo-adjacent ambiguity detector.
 *
 * Detects inputs where a word closely resembles another word with a
 * significantly different meaning in a UseSteady context.
 *
 * This is NOT a generic spellchecker. Only well-known, high-risk pairs
 * are registered. The pair must change the semantic meaning materially.
 *
 * Example pair: "loops" vs "loopholes"
 *   "fix the loops in the code" → code loop (clear programming construct)
 *   "loops" near "approval"/"rule" → might mean loopholes (policy bypass)
 */

import type { AmbiguityDetector, DisambiguationResult } from "../types.js";

type AmbiguousPair = {
  readonly pattern: RegExp;
  readonly word: string;
  readonly alternatives: readonly string[];
  readonly reason: string;
};

const TYPO_ADJACENT_PAIRS: ReadonlyArray<AmbiguousPair> = [
  {
    // "loops" near policy/rule/approval language → could mean loopholes
    pattern: /\bloops?\b.{0,40}(rule|policy|approval|bypass)/i,
    word: "loops",
    alternatives: [
      "code loops (programming construct)",
      "loopholes (policy bypass attempt — blocked)",
    ],
    reason: "'loops' near policy language may mean code loops or loopholes.",
  },
  {
    // Standalone "loops" could go either way in ambiguous context
    pattern: /\b(approval|rule|policy).{0,40}\bloops?\b/i,
    word: "loops",
    alternatives: [
      "code loops (programming construct)",
      "loopholes (policy bypass attempt — blocked)",
    ],
    reason: "'loops' near policy language may mean code loops or loopholes.",
  },
];

function matches(input: string): AmbiguousPair | null {
  return TYPO_ADJACENT_PAIRS.find((pair) => pair.pattern.test(input)) ?? null;
}

export const typoAdjacentDetector: AmbiguityDetector = {
  id: "typo_adjacent",
  priority: 10,

  supports(input: string): boolean {
    return matches(input) !== null;
  },

  detect(input: string): DisambiguationResult | null {
    const pair = matches(input);
    if (pair === null) return null;
    return {
      kind: "ambiguous",
      reason: pair.reason,
      options: pair.alternatives,
    };
  },
};
