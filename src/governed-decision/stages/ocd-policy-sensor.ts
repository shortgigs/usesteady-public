/**
 * OCD policy sensor — Decision Basis policy sub-section (L3.S2, Lane 3).
 *
 * Reads the OCD policy (the constraint authority) and evaluates the
 * understanding's executable operation target paths through the authority's
 * OWN rule code — `evaluatePathsAgainstOCDPolicy` in src/cursor/ocd-evaluator.ts,
 * the exact function the Cursor handoff evaluator delegates to. The sensor
 * READS the policy; it never reinterprets it: no rule is reimplemented here,
 * no verdict is computed outside the authority's evaluator, and the policy
 * fields that governed the evaluation are recorded verbatim in the value.
 *
 * ── What is sensed ─────────────────────────────────────────────────────────────
 *
 *   policy         → writeSafeGlobs / maxFilesApprovalThreshold /
 *                    alwaysProhibitedGlobs, verbatim from the injected policy.
 *   evaluatedPaths → the target paths of the understanding's executable
 *                    operations, verbatim. For a rename_file op BOTH paths
 *                    are evaluated (the source it removes and the destination
 *                    it writes) — a rename into a policy-violating location
 *                    must be as visible as a create there.
 *   clearance      → the authority's verdict over those paths
 *                    ("cleared" | "conflict_detected" + rulesFired +
 *                    conflictsDetected, verbatim). PRESENT ONLY when there was
 *                    at least one path to evaluate — a verdict over zero
 *                    proposals is never fabricated (gauge law).
 *
 * ── What this sensor is NOT ────────────────────────────────────────────────────
 *
 *   Not a gate. A conflict_detected clearance does NOT block ratification —
 *   it makes the violation visible in the basis the human decides against
 *   (H remains the sole approval authority). Enforcement surfaces (delivery
 *   gate / OCD conflict acceptance) are untouched.
 *
 * Pure and read-only: no filesystem access, no mutation, deterministic for a
 * given (policy, ops) input. Never throws for well-formed inputs.
 */

import { evaluatePathsAgainstOCDPolicy } from "../../cursor/ocd-evaluator.js";
import type { CursorOCDClearance, CursorOCDPolicy } from "../../cursor/types.js";
import type { ExecutableOperation } from "../types.js";

/**
 * The connected policy sub-section value: the policy read verbatim plus the
 * authority's evaluation of the proposed operation targets.
 */
export type OcdPolicyEvaluation = {
  readonly source: "OCD policy (constraint authority)";
  /** The policy fields that governed this evaluation, verbatim. */
  readonly policy: {
    readonly writeSafeGlobs: readonly string[];
    readonly maxFilesApprovalThreshold: number;
    readonly alwaysProhibitedGlobs: readonly string[];
  };
  /** The executable-operation target paths evaluated, verbatim. */
  readonly evaluatedPaths: readonly string[];
  /**
   * The authority's verdict over evaluatedPaths — verbatim output of
   * evaluatePathsAgainstOCDPolicy. ABSENT (not null, not "cleared") when
   * evaluatedPaths is empty: no proposal existed, so no verdict is real.
   */
  readonly clearance?: CursorOCDClearance;
};

/**
 * Sense the OCD policy against the proposed executable operations.
 *
 * `ops` may be empty (the understanding carried no executable operations, or
 * nothing was understood) — the policy itself is still a real, connected fact,
 * so the sensor returns it verbatim with `evaluatedPaths: []` and NO clearance.
 */
export function senseOcdPolicy(
  policy: CursorOCDPolicy,
  ops: readonly ExecutableOperation[],
): OcdPolicyEvaluation {
  const evaluatedPaths = ops.flatMap((op) =>
    op.kind === "rename_file" ? [op.path, op.toPath] : [op.path],
  );

  const base = {
    source: "OCD policy (constraint authority)" as const,
    policy: {
      writeSafeGlobs: policy.writeSafeGlobs,
      maxFilesApprovalThreshold: policy.maxFilesApprovalThreshold,
      alwaysProhibitedGlobs: policy.alwaysProhibitedGlobs,
    },
    evaluatedPaths,
  };

  if (evaluatedPaths.length === 0) {
    return base;
  }

  return {
    ...base,
    clearance: evaluatePathsAgainstOCDPolicy(evaluatedPaths, policy),
  };
}
