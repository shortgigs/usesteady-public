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
import { hashObject } from "../ucp/hashes.js";
// ─── Public API ───────────────────────────────────────────────────────────────
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
export function buildCursorHandoffArtifact(intake, intentId, responseId, policy, parsedChange) {
    const changeSpec = buildChangeSpec(intake, parsedChange);
    const scopeConstraint = buildInitialScopeConstraint(changeSpec, policy);
    const ocdClearance = buildInitialOCDClearance();
    // id is content-addressed: same inputs → same id.
    // ts is excluded (per UCP protocol). eligibility and approvedAt are NOT included
    // in the id input — they are mutable fields that change as the flow progresses.
    // The content identity is determined by what the edit IS, not its current state.
    const idInput = {
        intentId,
        mode: "execute",
        changeSpec,
        responseId,
        scopeConstraint,
    };
    const id = hashObject(idInput);
    return {
        id,
        intentId,
        responseId,
        mode: "execute",
        changeSpec,
        ocdClearance,
        eligibility: "pending_confirmation",
        scopeConstraint,
    };
}
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
export function narrowArtifactScope(artifact, newAllowedFiles, newAllowedScopes) {
    const newScopeConstraint = {
        allowedFiles: newAllowedFiles,
        allowedScopes: newAllowedScopes ?? artifact.scopeConstraint.allowedScopes,
        prohibitedPatterns: artifact.scopeConstraint.prohibitedPatterns,
    };
    const idInput = {
        intentId: artifact.intentId,
        mode: "execute",
        changeSpec: artifact.changeSpec,
        responseId: artifact.responseId,
        scopeConstraint: newScopeConstraint,
    };
    const id = hashObject(idInput);
    return {
        id,
        intentId: artifact.intentId,
        responseId: artifact.responseId,
        mode: "execute",
        changeSpec: artifact.changeSpec,
        ocdClearance: artifact.ocdClearance,
        eligibility: "pending_confirmation",
        scopeConstraint: newScopeConstraint,
    };
}
/**
 * Approve a CursorHandoffArtifact — set eligibility to "approved_for_cursor".
 *
 * This is the ONLY place that sets eligibility to "approved_for_cursor".
 * Callers must verify that H has explicitly confirmed before calling.
 *
 * Returns a new artifact reference. The id does NOT change (eligibility and
 * approvedAt are not part of the content-addressed id input).
 */
export function approveArtifact(artifact, confirmedAt) {
    return {
        ...artifact,
        eligibility: "approved_for_cursor",
        approvedAt: confirmedAt,
    };
}
// ─── Internal builders ────────────────────────────────────────────────────────
function buildChangeSpec(intake, parsedChange) {
    const interp = intake.interpretation;
    const intent = intake.guidance?.interpretation;
    if (interp !== undefined) {
        return buildChangeSpecFromInterpretation(interp, parsedChange);
    }
    if (intent !== undefined) {
        return buildChangeSpecFromIntentInterpretation(intent);
    }
    // No interpretation of either kind — vague execute with no classification.
    // certaintyLevel will be "unknown". changeSpec carries what we know.
    return {
        category: "unknown",
        summary: intake.reason,
        impact: [],
        confidence: "low",
        basis: [],
        ...(parsedChange !== undefined ? { parsedChange } : {}),
    };
}
function buildChangeSpecFromInterpretation(interp, parsedChange) {
    // InterpretationResult carries summary/impact/confidence/category.
    // ParsedChange (oldValue, newValue, filePath) is threaded in separately by the
    // coordinator, which has access to both simultaneously (e.g. from parseChange(input)).
    return {
        category: interp.category,
        summary: interp.summary,
        impact: interp.impact,
        confidence: interp.confidence,
        basis: [],
        ...(parsedChange !== undefined ? { parsedChange } : {}),
    };
}
function buildChangeSpecFromIntentInterpretation(intent) {
    return {
        category: intent.category,
        summary: intent.summary,
        impact: [],
        confidence: intent.confidence,
        basis: [...intent.basis],
    };
}
function buildInitialScopeConstraint(changeSpec, policy) {
    // PROPOSE: from parsedChange.filePath only.
    const allowedFiles = changeSpec.parsedChange?.filePath != null
        ? [changeSpec.parsedChange.filePath]
        : [];
    // CONSTRAIN: defensive prohibitions always applied.
    const prohibitedPatterns = [
        ...policy.alwaysProhibitedGlobs,
        ...(allowedFiles.length === 0
            ? policy.emptyAllowedFilesAdditionalProhibitions
            : []),
    ];
    return {
        allowedFiles,
        allowedScopes: [],
        prohibitedPatterns,
    };
}
function buildInitialOCDClearance() {
    // OCD clearance starts as "cleared" with no rules evaluated.
    // The OCD evaluator (ocd-evaluator.ts) runs next and updates this.
    return {
        status: "cleared",
        rulesFired: [],
        conflictsDetected: [],
    };
}
//# sourceMappingURL=artifact-mapper.js.map