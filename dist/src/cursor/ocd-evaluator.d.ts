/**
 * OCD Evaluator — evaluates a CursorHandoffArtifact against policy rules.
 *
 * ── Role ───────────────────────────────────────────────────────────────────────
 *
 *   Takes the initial artifact produced by the artifact mapper and applies
 *   the three OCD rules that govern Cursor handoffs:
 *
 *     RULE_WRITE_OUTSIDE_WORKSPACE  — file outside write_safe_globs
 *     RULE_WRITE_TOO_MANY_FILES     — allowedFiles count exceeds threshold
 *     RULE_H_PATH_WORKSPACE_BOUNDARY — H-provided path outside workspace root
 *                                      (hard block, not a conflict)
 *
 *   Returns an updated ocdClearance. The artifact itself is not mutated —
 *   callers receive a new ocdClearance to apply.
 *
 * ── What OCD does ─────────────────────────────────────────────────────────────
 *
 *   - Fires conflicts when allowedFiles entries violate write_safe_globs
 *   - Fires conflicts when allowedFiles.length > maxFilesApprovalThreshold
 *   - Returns "cleared" when no rules fire
 *   - Returns "conflict_detected" when one or more rules fire
 *
 * ── What OCD does NOT do ──────────────────────────────────────────────────────
 *
 *   - Does not add to allowedFiles (NEVER proposes files)
 *   - Does not remove from allowedFiles (fires conflict; H decides)
 *   - Does not read the filesystem
 *   - Does not call the intake pipeline
 *
 * ── H-provided path validation ────────────────────────────────────────────────
 *
 *   When H sets allowedFiles from empty, the path must pass two tiers:
 *
 *     Tier 1 — workspace boundary (hard block):
 *       validateHProvidedPath() returns { ok: false } → path rejected, not added
 *
 *     Tier 2 — write_safe_globs (OCD conflict):
 *       evaluateOCDForHandoff() returns conflict_detected → H sees conflict surface
 *
 *   Tier 1 runs in the delivery gate before OCD is called.
 *   Tier 2 runs here in the OCD evaluator.
 *
 * See: docs/cursor-allowedfiles-policy.md — policy rules section
 *      docs/cursor-integration-architecture.md — OCD role in authority model
 */
import type { CursorHandoffArtifact, CursorOCDClearance, CursorOCDPolicy, WorkspacePathValidationResult } from "./types.js";
/**
 * Evaluate a CursorHandoffArtifact against OCD policy rules.
 *
 * Returns an updated ocdClearance. The artifact is not mutated.
 * Callers apply the returned ocdClearance to the artifact before surfacing
 * it to H.
 *
 * Note: if the artifact already has ocdClearance.status === "conflict_accepted",
 * this function should NOT be called again (H already accepted the conflict).
 * The existing ocdClearance should be preserved unchanged.
 */
export declare function evaluateOCDForHandoff(artifact: CursorHandoffArtifact, policy: CursorOCDPolicy): CursorOCDClearance;
/**
 * Evaluate a set of proposed file paths against OCD policy rules.
 *
 * This IS the constraint authority's rule evaluation — extracted verbatim from
 * evaluateOCDForHandoff() so other surfaces (e.g. the governed-decision kernel's
 * policy sensor, L3.S2) can READ the policy through the authority's own rule
 * code instead of reinterpreting it. Pure function: no filesystem reads, no
 * mutation, deterministic for a given (paths, policy) input.
 *
 * Rules applied (unchanged from the handoff evaluator):
 *   RULE_WRITE_OUTSIDE_WORKSPACE — each path must match write_safe_globs in
 *     BOTH its original and canonical (NFKC/zero-width/BIDI-stripped) form.
 *   RULE_WRITE_TOO_MANY_FILES    — path count must not exceed the threshold.
 */
export declare function evaluatePathsAgainstOCDPolicy(allowedFiles: readonly string[], policy: CursorOCDPolicy): CursorOCDClearance;
/**
 * Validate an H-provided file path against the workspace boundary.
 *
 * This is Tier 1 of H-provided path validation (hard block — not a conflict).
 * Tier 2 (write_safe_globs) is handled by evaluateOCDForHandoff().
 *
 * Called by the delivery gate when H sets allowedFiles from empty, before
 * adding the path to the artifact and before calling the OCD evaluator.
 *
 * A path is valid if and only if:
 *   - It is a non-empty string
 *   - Its resolved form is within the workspace root
 */
export declare function validateHProvidedPath(filePath: string, workspaceRoot: string): WorkspacePathValidationResult;
/**
 * Apply a completed ocdClearance to an artifact, returning an updated artifact.
 *
 * Does not mutate. Returns a new artifact reference with ocdClearance replaced.
 * The artifact id is unchanged — ocdClearance is not part of the content-addressed
 * id input (the id reflects what the edit IS, not its current OCD state).
 */
export declare function applyOCDClearance(artifact: CursorHandoffArtifact, ocdClearance: CursorOCDClearance): CursorHandoffArtifact;
/**
 * Mark an artifact's OCD conflict as accepted by H.
 *
 * Called when H explicitly accepts a detected conflict (conflict_detected → conflict_accepted).
 * Preserves rulesFired and conflictsDetected for audit — only status changes.
 */
export declare function acceptOCDConflict(artifact: CursorHandoffArtifact): CursorHandoffArtifact;
//# sourceMappingURL=ocd-evaluator.d.ts.map