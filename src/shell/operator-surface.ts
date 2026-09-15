/**
 * P-DISC / P-LABEL — operator-facing mutation labels.
 *
 * Two facts that must not collapse:
 *   no governed effect  — does not execute an approved workspace mutation
 *   no state mutation   — leaves the audit store and workspace unchanged
 *
 * "read-only" is reserved for no-state-mutation commands only.
 * A command may have no governed effect and still persist bookkeeping.
 *
 * Discoverability only. Does not change store location, retention,
 * tamper evidence, or actor identity.
 */

export const NO_GOVERNED_EFFECT_LABEL = "no governed effect";
export const NO_STATE_MUTATION_LABEL = "no state mutation";
export const TEMPORARY_STORE_MUTATION_LABEL = "temporary store mutation";
export const BOOKKEEPING_LABEL = "may persist bookkeeping";

export type OperatorMutationClass =
  | "no_state_mutation"
  | "temporary_store_mutation"
  | "bookkeeping_only"
  | "governed_effect";

export type OperatorSurfaceCommand = {
  readonly id: string;
  readonly mutationClass: OperatorMutationClass;
};

/**
 * Commands this slice classifies for help/health honesty.
 * Strict no-mutation labels may be attached only to `no_state_mutation`.
 */
export const OPERATOR_SURFACE_COMMANDS: readonly OperatorSurfaceCommand[] = [
  { id: "help", mutationClass: "no_state_mutation" },
  { id: "capabilities", mutationClass: "no_state_mutation" },
  { id: "templates", mutationClass: "no_state_mutation" },
  { id: "examples", mutationClass: "no_state_mutation" },
  { id: "quickstart", mutationClass: "no_state_mutation" },
  { id: "timeline", mutationClass: "no_state_mutation" },
  { id: "audit-summary", mutationClass: "no_state_mutation" },
  // Default/stdout `audit export` only. `--output file` writes ./audit-exports/
  // and is not the no-state-mutation invocation.
  { id: "audit-export", mutationClass: "no_state_mutation" },
  { id: "workflow-inspect", mutationClass: "no_state_mutation" },
  { id: "workflow-resume-info", mutationClass: "no_state_mutation" },
  { id: "doctor", mutationClass: "temporary_store_mutation" },
  { id: "doctor-help", mutationClass: "no_state_mutation" },
  { id: "reconstruct", mutationClass: "bookkeeping_only" },
  { id: "usage-summary", mutationClass: "bookkeeping_only" },
  { id: "run", mutationClass: "governed_effect" },
];

export function noStateMutationCommandIds(): readonly string[] {
  return OPERATOR_SURFACE_COMMANDS.filter((c) => c.mutationClass === "no_state_mutation").map(
    (c) => c.id,
  );
}
