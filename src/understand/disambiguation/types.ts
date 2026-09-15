/**
 * Intent Disambiguation types.
 *
 * Disambiguation identifies whether an input has a single clear meaning
 * or multiple competing interpretations.
 *
 * Results:
 *   clear      — single unambiguous meaning; normalized form provided
 *   ambiguous  — multiple valid interpretations; bounded options provided
 *   unknown    — no registered detector matched; no interpretation available
 *
 * Detectors may NOT silently rewrite input. If ambiguous, they MUST return options.
 */

export type DisambiguationResult =
  | { readonly kind: "clear"; readonly normalized: string }
  | { readonly kind: "ambiguous"; readonly reason: string; readonly options: readonly string[] }
  | { readonly kind: "unknown" };

/**
 * An AmbiguityDetector examines an input and returns a DisambiguationResult
 * if it recognizes a pattern, or null if the input is outside its scope.
 */
export type AmbiguityDetector = {
  readonly id: string;
  readonly priority: number;
  supports(input: string): boolean;
  detect(input: string): DisambiguationResult | null;
};
