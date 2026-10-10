/**
 * Shared types for the Understand layer.
 *
 * The Understand layer is ADVISORY, not authoritative.
 * It reports on what it observes; it does not decide what happens.
 * The Response Planner makes all decisions.
 */

export type UnderstandContext = {
  readonly hasPriorSession: boolean;
  readonly lastInput?: string;
  readonly lastResult?: string;
};
