/**
 * Claude artifact mapper — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   Translates an IntakeResult (mode === "execute") into a ClaudeAgentHandoffArtifact
 *   with eligibility: "pending_confirmation" and initial scope + tool constraints.
 *
 *   This is the ONLY place that produces executionDomain.
 *   INVARIANT (A1): executionDomain is derived here from InterpretationResult or
 *   IntentInterpretation category. No downstream layer may re-classify it.
 *
 * ── What this mapper does ─────────────────────────────────────────────────────
 *
 *   1. Derives executionDomain from the interpretation category.
 *   2. Builds taskSpec from interpretation summary + parsedChange (if present).
 *   3. Sets initial allowedFiles = [parsedChange.filePath] or [].
 *   4. Sets initial prohibitedPatterns from OCD policy (defensive defaults).
 *   5. Sets allowedTools from the provided tool policy.
 *   6. Sets eligibility = "pending_confirmation".
 *   7. Sets ocdClearance = "clear" (OCD evaluator updates this separately).
 *
 * ── What this mapper does NOT do ──────────────────────────────────────────────
 *
 *   - Does not read the filesystem
 *   - Does not call the Claude API
 *   - Does not set eligibility to "approved_for_agent" (only H does that)
 *   - Does not validate H-provided paths (delivery gate's job)
 *   - Does not re-classify executionDomain after building (A1)
 *
 * ── CONSTRUCTION RULE: undefined-free payloads ────────────────────────────────
 *
 *   All payload objects must be undefined-free per UCP protocol invariant.
 *   Optional fields are omitted entirely when absent. Never assigned undefined.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */
import type { IntakeResult } from "../intake/types.js";
import type { ReplaceChange } from "../understand/interpretation/types.js";
type ParsedChange = ReplaceChange;
import type { ClaudeAgentHandoffArtifact, ClaudeToolPolicy } from "./types.js";
/**
 * ClaudeOCDPolicy — the policy inputs for scope constraint building.
 *
 * Mirrors CursorOCDPolicy but applies to the Claude seam.
 */
export type ClaudeOCDPolicy = {
    /** Globs that are always prohibited regardless of allowedFiles. */
    readonly alwaysProhibitedGlobs: readonly string[];
    /** Globs that are safe to write within. Empty = no positive restriction. */
    readonly writeSafeGlobs: readonly string[];
};
/**
 * Build the initial ClaudeAgentHandoffArtifact from an IntakeResult.
 *
 * PRECONDITION: intake.mode === "execute". Caller must verify this.
 *
 * @param intake       The completed intake result (mode must be "execute").
 * @param intentId     The ucp.intent.v1 envelope id.
 * @param responseId   The ucp.response.v1 envelope id.
 * @param policy       The OCD policy for scope constraint building.
 * @param toolPolicy   The tool policy (allowedTools, networkAccess, filesystemMode).
 * @param parsedChange Optional parsed change from a structured edit command.
 */
export declare function buildClaudeHandoffArtifact(intake: IntakeResult, intentId: string, responseId: string, policy: ClaudeOCDPolicy, toolPolicy: ClaudeToolPolicy, parsedChange?: ParsedChange): ClaudeAgentHandoffArtifact;
/**
 * Approve the artifact — transitions eligibility from "pending_confirmation"
 * to "approved_for_agent". Records the approval timestamp.
 *
 * H is the only actor that may call this. Called by the product session on
 * H's explicit approval action.
 */
export declare function approveClaudeArtifact(artifact: ClaudeAgentHandoffArtifact, at?: number): ClaudeAgentHandoffArtifact;
/**
 * Narrow the artifact's allowed files to a subset.
 *
 * H may narrow (remove entries) but not widen (add new paths).
 * The gate enforces this at delivery; this function enforces monotonicity
 * structurally by filtering the current allowedFiles.
 *
 * Returns a new artifact with updated allowedFiles and a recomputed id.
 */
export declare function narrowClaudeArtifactScope(artifact: ClaudeAgentHandoffArtifact, allowedFiles: readonly string[]): ClaudeAgentHandoffArtifact;
export {};
//# sourceMappingURL=artifact-mapper.d.ts.map