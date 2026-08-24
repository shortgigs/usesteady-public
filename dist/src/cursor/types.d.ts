/**
 * Cursor Integration types.
 *
 * ── Role of this module ────────────────────────────────────────────────────────
 *
 *   This module defines the seam between UseSteady's authority system and
 *   Cursor's edit machinery. It is the type contract for:
 *
 *     - CursorHandoffArtifact: the approved, constrained artifact Cursor receives
 *     - CursorDeliveryRequest: what the delivery gate sends to Cursor
 *     - CursorResponse: the three response kinds Cursor may return
 *     - CursorScopeQuestion: Cursor's structured scope clarification request
 *     - CursorOCDPolicy: the policy inputs for the OCD evaluator
 *
 * ── Authority model ────────────────────────────────────────────────────────────
 *
 *   PROPOSE    parsedChange.filePath   (artifact mapper only)
 *   CONSTRAIN  OCD policy engine       (conflicts + prohibitedPatterns)
 *   REFINE     H at ready_for_confirmation (set from empty or narrow non-empty)
 *   SELECT     H at scope_clarification (from Cursor's candidates only)
 *
 *   Cursor: execute only. No upstream reach-back. No re-interpretation.
 *
 * ── Key invariants ─────────────────────────────────────────────────────────────
 *
 *   - CursorHandoffArtifact never carries the original input string
 *   - eligibility === "approved_for_cursor" is the only value that opens delivery
 *   - H can set allowedFiles from empty or narrow non-empty; cannot widen non-empty
 *   - H-provided paths are validated against workspace boundary (hard block)
 *     and write_safe_globs (OCD conflict trigger)
 *   - Maximum one scope clarification per delivery sequence
 *
 * ── Provenance chain ───────────────────────────────────────────────────────────
 *
 *   ucp.intent.v1 → ucp.response.v1 → ucp.cursor_handoff.v1
 *     → ucp.cursor_receipt.v1
 *       → [ucp.cursor_artifact.v1 — RESERVED FUTURE SLOT]
 *         → ucp.execution_trace.v1 → ucp.replay_report.v1
 *
 *   Refusal path:
 *     ucp.cursor_handoff.v1 → ucp.cursor_refused.v1 (dead end or retry trigger)
 *
 * See: docs/cursor-integration-architecture.md
 *      docs/cursor-delivery-contract.md
 *      docs/cursor-allowedfiles-policy.md
 */
export type CursorHandoffEligibility = 
/** OCD cleared; awaiting H confirmation. */
"pending_confirmation"
/** H confirmed. Only value that opens the delivery gate. */
 | "approved_for_cursor"
/** H rejected, timed out, auto-rejected, or Cursor execution error. */
 | "rejected";
export type CursorOCDClearanceStatus = "cleared" | "conflict_detected" | "conflict_accepted";
export type CursorOCDClearance = {
    readonly status: CursorOCDClearanceStatus;
    /** Policy rule IDs that were evaluated (from approval-workflow rule registry). */
    readonly rulesFired: readonly string[];
    /** Human-readable conflict descriptions. Empty when status === "cleared". */
    readonly conflictsDetected: readonly string[];
};
export type CursorScopeConstraint = {
    /**
     * Files Cursor is allowed to touch.
     *
     * Empty ([]) = no explicit file restriction.
     *   Semantic: Cursor may search freely within prohibitedPatterns.
     *   H is shown this state and may specify a file before confirming.
     *   OCD adds defensive prohibitedPatterns when this is empty.
     *
     * Non-empty = Cursor must stay within these paths.
     *   Any write outside this set is an authority violation.
     *   H may narrow (remove entries) but not widen (add entries).
     *
     * Populated by: artifact mapper from parsedChange.filePath.
     * Refined by:   H (set from empty, or remove from non-empty).
     * Never touched by: OCD (OCD fires conflicts; H decides).
     */
    readonly allowedFiles: readonly string[];
    /**
     * Named scopes within allowed files (function, class, component names).
     * Empty = no sub-file restriction.
     * Populated during scope clarification when questionKind === "need_scope_selection".
     */
    readonly allowedScopes: readonly string[];
    /**
     * Glob patterns Cursor must NOT touch, regardless of allowedFiles.
     * Takes precedence over allowedFiles if there is overlap.
     *
     * Always contains defensive system globs (set by OCD policy):
     *   migrations, .env files, secrets, lockfiles, generated code
     * When allowedFiles is empty, also contains:
     *   node_modules, .git
     */
    readonly prohibitedPatterns: readonly string[];
};
export type CursorChangeSpec = {
    /**
     * Category from whichever interpretation family ran.
     *
     * For execute + structured command (ParsedChange present):
     *   InterpretationCategory values:
     *   "tailwind_color_change" | "css_color_change" | "text_literal_change" | "config_value_change"
     *
     * For execute + intent interpretation (no ParsedChange):
     *   IntentInterpretationCategory values:
     *   "visual_color" | "text_change" | "config_change" | "workflow_operation" | "unknown"
     */
    readonly category: string;
    /** Human-readable summary of what the change is. */
    readonly summary: string;
    /** Impact list from InterpretationResult. Empty for intent-only interpretations. */
    readonly impact: readonly string[];
    readonly confidence: "high" | "medium" | "low";
    /**
     * The parsed change directive.
     *
     * Present when mode === "execute" AND a structured command was parsed
     * (i.e. InterpretationResult was produced — "replace X with Y in file").
     *
     * Absent for vague execute flows where only intent interpretation exists.
     * When absent, Cursor has no concrete search string — the flow will likely
     * reach Cursor and refuse (see Case C in allowedfiles-policy.md).
     *
     * When present: this is the primary edit directive. Cursor must use
     * oldValue/newValue/filePath as the authoritative change spec.
     * Cursor must not expand or paraphrase this.
     */
    readonly parsedChange?: {
        readonly oldValue: string;
        readonly newValue: string;
        readonly filePath?: string;
    };
    /**
     * Signals that produced the classification (from IntentInterpretation.basis
     * or InterpretationResult category-specific evidence).
     * Observability only — not an edit directive.
     */
    readonly basis: readonly string[];
};
export type CursorHandoffArtifact = {
    /** Content-addressed identifier. Computed from artifact content, not delivery time. */
    readonly id: string;
    /** Links back to ucp.intent.v1 — the originating user intent. */
    readonly intentId: string;
    /** Links back to ucp.response.v1 — the intake mode decision. */
    readonly responseId: string;
    /**
     * Mode authority — always "execute".
     * Only intake mode === "execute" flows produce a CursorHandoffArtifact.
     * Never re-derived by OCD, Present, or Cursor.
     */
    readonly mode: "execute";
    /** What the edit is. Cursor uses this as the sole edit directive. */
    readonly changeSpec: CursorChangeSpec;
    /** OCD policy evaluation result. */
    readonly ocdClearance: CursorOCDClearance;
    /**
     * Eligibility state.
     * Only "approved_for_cursor" opens the delivery gate.
     * Set exclusively by H — never by OCD, Present, or Cursor.
     */
    readonly eligibility: CursorHandoffEligibility;
    /** What Cursor is allowed to touch. Set by OCD + optionally refined by H. */
    readonly scopeConstraint: CursorScopeConstraint;
    /**
     * Epoch ms when H set eligibility to "approved_for_cursor".
     * Absent until H approves.
     * Omit entirely (do not set to undefined) per UCP undefined-free invariant.
     */
    readonly approvedAt?: number;
};
export type CursorOCDPolicy = {
    /**
     * Glob patterns that define the safe write zone.
     * Files outside these globs trigger RULE_WRITE_OUTSIDE_WORKSPACE.
     * Maps to write_safe_globs from the approval-workflow PolicyConfig.
     */
    readonly writeSafeGlobs: readonly string[];
    /**
     * Maximum number of files in allowedFiles before RULE_WRITE_TOO_MANY_FILES fires.
     * Maps to max_files_approval_threshold from PolicyConfig.
     */
    readonly maxFilesApprovalThreshold: number;
    /**
     * Glob patterns always added to prohibitedPatterns regardless of allowedFiles.
     * Example: ["**\/migrations\/**", "**\/.env*", "**\/secrets\/**", "*.lock"]
     */
    readonly alwaysProhibitedGlobs: readonly string[];
    /**
     * Additional globs added to prohibitedPatterns ONLY when allowedFiles is empty.
     * Example: ["**\/node_modules\/**", "**\/.git\/**"]
     */
    readonly emptyAllowedFilesAdditionalProhibitions: readonly string[];
    /**
     * The workspace root path. Used for the H-provided path workspace-boundary check.
     * H-provided paths outside this root are hard-blocked (not OCD conflicts).
     */
    readonly workspaceRoot: string;
};
export type CursorDeliveryRequest = {
    /**
     * Delivery-attempt identifier.
     *
     * IMPORTANT: This is an ATTEMPT identity, not a content identity.
     *
     *   deliveryId = sha256({ artifactId: artifact.id, sentAt })
     *
     * Unlike artifact.id (content-addressed, stable across re-deliveries),
     * deliveryId is unique per delivery attempt. Use deliveryId for
     * transport-level correlation only (ucp.cursor_receipt.v1, ucp.cursor_refused.v1).
     * Never use deliveryId for content deduplication or provenance chain links —
     * use artifact.id for those purposes.
     */
    readonly deliveryId: string;
    /** Epoch ms when the delivery gate sent this request. */
    readonly sentAt: number;
    /**
     * The approved artifact. Complete source of truth for the edit.
     *
     * Immutability rule: bit-for-bit identical to the artifact whose id was
     * used to compute ucp.cursor_handoff.v1. If they diverge, the delivery
     * is considered corrupted and must be aborted.
     */
    readonly artifact: CursorHandoffArtifact;
};
/**
 * CursorAccepted — Cursor has taken ownership and will begin applying the edit.
 *
 * Does NOT mean the edit is complete — only that Cursor accepted the request.
 * After returning Accepted, Cursor MUST apply the edit and MUST emit
 * ucp.execution_trace.v1 when complete. Cursor MUST NOT surface a new
 * confirmation request to H.
 */
export type CursorAccepted = {
    readonly kind: "accepted";
    readonly deliveryId: string;
    readonly artifactId: string;
    readonly receivedAt: number;
};
/**
 * CursorRefusedDueToScope — Cursor cannot determine the edit target.
 *
 * Valid only when:
 *   - parsedChange.filePath is absent AND Cursor found 0 or 2+ candidate files
 *   - parsedChange.filePath is present but oldValue appears in multiple scopes
 *
 * Cursor MUST NOT have begun any file writes before returning this response.
 * Triggers scope_clarification_needed state.
 */
export type CursorRefusedDueToScope = {
    readonly kind: "refused_due_to_scope";
    readonly deliveryId: string;
    readonly artifactId: string;
    readonly receivedAt: number;
    readonly scopeQuestion: CursorScopeQuestion;
};
/**
 * CursorRefusedDueToExecutionError — Cursor found the target but could not apply the edit.
 *
 * Cursor MUST NOT have written partial changes before returning this response.
 * Triggers rejected state. No retry path.
 */
export type CursorRefusedDueToExecutionError = {
    readonly kind: "refused_due_to_execution_error";
    readonly deliveryId: string;
    readonly artifactId: string;
    readonly receivedAt: number;
    readonly errorCode: CursorExecutionErrorCode;
    /** Human-readable detail for Present layer. Must not contain raw stack traces. */
    readonly detail: string;
};
export type CursorResponse = CursorAccepted | CursorRefusedDueToScope | CursorRefusedDueToExecutionError;
/**
 * CursorScopeQuestion — Cursor's structured scope clarification request.
 *
 * Not prose. The Present layer formats this for H.
 * H selects from candidates — cannot add paths outside candidates.
 */
export type CursorScopeQuestionKind = "need_file_path" | "need_scope_selection" | "ambiguous_old_value";
export type CursorScopeQuestion = {
    readonly questionKind: CursorScopeQuestionKind;
    /**
     * Candidates Cursor found:
     *   need_file_path:       relative file paths containing oldValue
     *   need_scope_selection: scope names (function/class/component) within the file
     *   ambiguous_old_value:  line numbers or context snippets
     *
     * Empty candidates = Cursor found nothing. This should produce
     * refused_due_to_execution_error (errorCode: "old_value_not_found") instead.
     */
    readonly candidates: readonly string[];
    /** What Cursor was searching for. Typically parsedChange.oldValue. */
    readonly searchedFor: string;
    /**
     * Terse factual statement for the Present layer.
     * Not a question — a statement of what was found.
     * Example: "Found 'bg-blue-500' in 3 files. Select the target file."
     */
    readonly explanation: string;
};
export type CursorExecutionErrorCode = "old_value_not_found" | "ambiguous_match" | "file_not_found" | "scope_outside_allowed" | "prohibited_pattern_match" | "parse_error" | "merge_conflict" | "outside_workspace" | "invalid_replacement_chars" | "delivery_timeout";
export type WorkspacePathValidationResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly reason: "outside_workspace_boundary" | "invalid_path";
};
//# sourceMappingURL=types.d.ts.map