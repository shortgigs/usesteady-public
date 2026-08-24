/**
 * Cursor artifact mapper — builds the initial CursorHandoffArtifact.
 *
 * ── Role ───────────────────────────────────────────────────────────────────────
 *
 *   Translates an IntakeResult (mode === "execute") into a CursorHandoffArtifact
 *   with eligibility: "pending_confirmation" and an initial scopeConstraint.
 *
 *   This is the ONLY place that proposes allowedFiles. Specifically, it reads
 *   parsedChange.filePath when present. When absent, allowedFiles starts empty.
 *
 * ── What this mapper does ──────────────────────────────────────────────────────
 *
 *   1. Extracts changeSpec from InterpretationResult (execute + structured) or
 *      IntentInterpretation (execute + vague).
 *   2. Sets initial allowedFiles = [parsedChange.filePath] or [].
 *   3. Sets initial prohibitedPatterns from OCD policy (defensive defaults).
 *   4. Sets eligibility = "pending_confirmation".
 *   5. Sets ocdClearance = { status: "cleared", rulesFired: [], conflictsDetected: [] }
 *      (OCD evaluator updates this separately — see ocd-evaluator.ts).
 *
 * ── What this mapper does NOT do ──────────────────────────────────────────────
 *
 *   - Does not read the filesystem (no path resolution)
 *   - Does not call OCD (that is a separate step)
 *   - Does not set eligibility to "approved_for_cursor" (only H does that)
 *   - Does not validate H-provided paths (that is the delivery gate's job)
 *   - Does not invent file paths from intent category
 *
 * ── CONSTRUCTION RULE: undefined-free payloads ────────────────────────────────
 *
 *   All payload objects must be undefined-free per UCP protocol invariant.
 *   Optional fields are omitted entirely when absent. Never assigned undefined.
 *
 * See: docs/cursor-allowedfiles-policy.md — population source hierarchy
 *      docs/cursor-integration-architecture.md — authority model
 */
import type { IntakeResult } from "../intake/types.js";
import type { ReplaceChange } from "../understand/interpretation/types.js";
type ParsedChange = ReplaceChange;
import type { CursorHandoffArtifact, CursorOCDPolicy } from "./types.js";
/**
 * Build the initial CursorHandoffArtifact from an IntakeResult.
 *
 * PRECONDITION: intake.mode === "execute". Callers must verify this before calling.
 * Passing a non-execute IntakeResult is a caller contract violation.
 *
 * @param intake      The completed intake result (mode must be "execute").
 * @param intentId    The ucp.intent.v1 envelope id — links back to the root intent.
 * @param responseId  The ucp.response.v1 envelope id — links back to the mode decision.
 * @param policy      The OCD policy config (for defensive prohibitedPatterns).
 * @returns A CursorHandoffArtifact with eligibility: "pending_confirmation".
 */
export declare function buildCursorHandoffArtifact(intake: IntakeResult, intentId: string, responseId: string, policy: CursorOCDPolicy, parsedChange?: ParsedChange): CursorHandoffArtifact;
/**
 * Rebuild a CursorHandoffArtifact with a narrowed scopeConstraint.
 *
 * Called when H narrows the scope at ready_for_confirmation, or when a scope
 * clarification answer updates allowedFiles. Produces a new artifact with a
 * new content address (different scopeConstraint → different id).
 *
 * The new artifact retains the same intentId, responseId, and changeSpec.
 * eligibility is reset to "pending_confirmation" — H must re-confirm.
 *
 * PRECONDITION: newAllowedFiles ⊆ current artifact.scopeConstraint.allowedFiles
 *   OR current artifact.scopeConstraint.allowedFiles is empty (H setting from empty).
 * Callers must enforce the non-widening rule before calling.
 */
export declare function narrowArtifactScope(artifact: CursorHandoffArtifact, newAllowedFiles: readonly string[], newAllowedScopes?: readonly string[]): CursorHandoffArtifact;
/**
 * Approve a CursorHandoffArtifact — set eligibility to "approved_for_cursor".
 *
 * This is the ONLY place that sets eligibility to "approved_for_cursor".
 * Callers must verify that H has explicitly confirmed before calling.
 *
 * Returns a new artifact reference. The id does NOT change (eligibility and
 * approvedAt are not part of the content-addressed id input).
 */
export declare function approveArtifact(artifact: CursorHandoffArtifact, confirmedAt: number): CursorHandoffArtifact;
export {};
//# sourceMappingURL=artifact-mapper.d.ts.map