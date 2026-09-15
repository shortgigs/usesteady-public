/**
 * PRV — Pre-Response Validation types.
 *
 * PRV is the first gate every input must pass before any processing occurs.
 * Its job is narrow: detect inputs that depend on prior context that does not exist.
 *
 * PRV does NOT:
 *   - perform semantic reasoning
 *   - classify intent
 *   - suggest responses
 *
 * PRV only answers: "Can this input be processed at all?"
 */

export type PRVResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly mode: "clarify"; readonly reason: string };

export type PRVContext = {
  readonly hasPriorSession: boolean;
  readonly lastInput?: string;
  readonly lastResult?: string;
};
