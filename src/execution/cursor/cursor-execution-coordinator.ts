/**
 * Cursor Execution Coordinator — product seam wiring.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   The execution entry point for code-change requests.
 *
 *   Mirrors the reminder execution coordinator in structure:
 *
 *     presentFromInput()         — intake result → display-ready presentation
 *     executeFromPresent()       — present result → display-ready execution outcome
 *
 *     prepareCursorExecution()   — intake result → artifact ready for H confirmation
 *     deliverCursorExecution()   — approved artifact + gate → display-ready outcome
 *
 *   Two phases are intentional. The split preserves the authority model:
 *     Phase 1 (prepare): deterministic, synchronous, no writes. A known
 *                        filePath is bound to exact filesystem identity
 *                        (stat metadata only) so H approves a receiver,
 *                        not a pathname. This is not a namespace lock.
 *     Phase 2 (deliver): async, requires H approval, produces real file changes.
 *                        Calls the delivery gate with an already-approved artifact.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a scheduler       — does not queue or retry
 *   NOT an OCD authority  — OCD fires conflicts; this surfaces them
 *   NOT a decision maker  — all decisions flow from intake + OCD + H approval
 *   NOT autonomous        — deliverCursorExecution() requires an approved artifact
 *
 * ── Consumer contract ─────────────────────────────────────────────────────────
 *
 *   Step 1 — Prepare:
 *     const prep = prepareCursorExecution(intakeResult, intentId, responseId, policy);
 *     if (prep.kind !== "ready_for_confirmation" && prep.kind !== "conflict_detected") return;
 *     // show prep.artifact to H; H may narrow scope or accept conflicts
 *
 *   Step 2 — H approves:
 *     const approved = approveArtifact(prep.artifact, Date.now());
 *
 *   Step 3 — Deliver:
 *     const result = await deliverCursorExecution(approved, gate);
 *     // route on result.kind: "accepted" | "refused_due_to_scope" | ...
 *
 * ── Dependency direction ───────────────────────────────────────────────────────
 *
 *   Coordinator imports: intake types, cursor module (all phases).
 *   Cursor module NEVER imports this coordinator.
 *   Present layer NEVER imports this coordinator.
 *   One-way dependencies only.
 *
 * ── Authority invariants preserved ────────────────────────────────────────────
 *
 *   - mode === "execute" is the only intake mode that opens Phase 1.
 *   - eligibility === "approved_for_cursor" is the only state that opens Phase 2.
 *   - Raw input never crosses to the delivery gate (enforced by CursorHandoffArtifact shape).
 *   - OCD fires conflicts; this surfaces them — never overrides them.
 *   - H approval is explicit (approveArtifact before deliverCursorExecution).
 *
 * See: docs/cursor-integration-architecture.md — authority model
 *      docs/cursor-delivery-contract.md        — delivery paths
 *      src/execution/reminders/reminder-execution-coordinator.ts — pattern reference
 */

import type { IntakeResult }         from "../../intake/types.js";
import type { ReplaceChange }        from "../../understand/interpretation/types.js";
import {
  bindReplaceChange,
  EFFECTIVE_RESOURCE_UNRESOLVED_MSG,
} from "../../input/effective-resource.js";
// Alias: this coordinator only ever receives ReplaceChange (FS ops bypass session pipeline entirely).
type ParsedChange = ReplaceChange;
import {
  buildCursorHandoffArtifact,
  evaluateOCDForHandoff,
  applyOCDClearance,
} from "../../cursor/index.js";
import type {
  CursorHandoffArtifact,
  CursorOCDPolicy,
  CursorScopeQuestion,
  CursorExecutionErrorCode,
} from "../../cursor/index.js";
import type { CursorEditorPlugin }   from "../../cursor/delivery-gate.js";
import { CursorDeliveryGate }        from "../../cursor/delivery-gate.js";
import type { CursorGateDeps }       from "../../cursor/delivery-gate.js";

// ─── Phase 1: Preparation result ─────────────────────────────────────────────

/**
 * Hints for wiring contradiction visibility via presentFromInput().
 *
 * Pass these to presentFromInput(rawInput, intakeResult, trace, policyHint, parsedChangeHint)
 * to surface policy_may_block_target when an execute-mode request targets a
 * prohibited path (Phase 5D cross-layer contradiction visibility).
 *
 *   prohibitedGlobs    — from CursorOCDPolicy.alwaysProhibitedGlobs
 *   parsedChangeFilePath — from the parsedChange extracted during preparation (if any)
 */
export type CursorPresentHints = {
  readonly prohibitedGlobs:       readonly string[];
  readonly parsedChangeFilePath?: string;
};

/**
 * CursorPreparationResult — returned by prepareCursorExecution().
 *
 *   "ready_for_confirmation"  OCD cleared. Artifact awaits H approval.
 *   "conflict_detected"       OCD fired one or more conflicts. H must review.
 *                             H may call acceptOCDConflict() then approve.
 *   "not_execute"             intakeResult.mode was not "execute". No artifact produced.
 *
 * For execute-mode results, presentHints can be passed directly to
 * presentFromInput() to enable Phase 5D contradiction visibility.
 */
export type CursorPreparationResult =
  | {
      readonly kind:         "ready_for_confirmation";
      readonly artifact:     CursorHandoffArtifact;
      readonly display:      CursorPreparationDisplay;
      readonly presentHints: CursorPresentHints;
    }
  | {
      readonly kind:         "conflict_detected";
      readonly artifact:     CursorHandoffArtifact;
      readonly display:      CursorPreparationDisplay;
      readonly presentHints: CursorPresentHints;
    }
  | {
      readonly kind:   "not_execute";
      readonly reason: string;
    };

/**
 * CursorPreparationDisplay — consumer-ready strings for the Phase 1 result.
 *
 *   headline     — "Ready to apply" / "Conflict detected" (for confirm UI)
 *   summary      — what the change will do (from changeSpec.summary)
 *   targetFile   — the proposed target file, if already known (from allowedFiles[0])
 *   conflicts    — human-readable OCD conflict messages; empty when cleared
 */
export type CursorPreparationDisplay = {
  readonly headline:   string;
  readonly summary:    string;
  readonly targetFile: string | null;
  readonly conflicts:  readonly string[];
};

// ─── Phase 2: Delivery result ─────────────────────────────────────────────────

/**
 * CursorExecutionResult — returned by deliverCursorExecution().
 *
 * Mirrors DeliveryGateResult but adds consumer-ready display strings.
 *
 *   "accepted"                      Edit applied. File mutated on disk.
 *   "refused_due_to_scope"          Cursor needs H to narrow scope.
 *   "refused_due_to_execution_error" Cursor could not apply the edit.
 *   "blocked_ineligible"            Artifact not approved. Caller error.
 *   "blocked_persistence_failure"   Handoff provenance could not be recorded.
 */
export type CursorExecutionResult =
  | {
      readonly kind:              "accepted";
      readonly deliveryId:        string;
      readonly artifactId:        string;
      readonly handoffEnvelopeId: string;
      readonly receiptEnvelopeId: string;
      readonly display:           CursorExecutionDisplay;
    }
  | {
      readonly kind:          "refused_due_to_scope";
      readonly deliveryId:    string;
      readonly scopeQuestion: CursorScopeQuestion;
      readonly display:       CursorExecutionDisplay;
    }
  | {
      readonly kind:       "refused_due_to_execution_error";
      readonly deliveryId: string;
      readonly errorCode:  CursorExecutionErrorCode;
      readonly detail:     string;
      readonly display:    CursorExecutionDisplay;
    }
  | {
      readonly kind:    "blocked_ineligible";
      readonly display: CursorExecutionDisplay;
    }
  | {
      readonly kind:    "blocked_persistence_failure";
      readonly reason:  string;
      readonly display: CursorExecutionDisplay;
    };

/**
 * CursorExecutionDisplay — consumer-ready strings for the Phase 2 result.
 *
 *   verdict   — "accepted" | "refused" | "blocked"
 *   headline  — single-line summary for the user
 *   note      — additional detail for the user; null when headline is sufficient
 */
export type CursorExecutionDisplay = {
  readonly verdict:  "accepted" | "refused" | "blocked";
  readonly headline: string;
  readonly note:     string | null;
};

// ─── Phase 1: prepareCursorExecution ─────────────────────────────────────────

/**
 * Build and OCD-evaluate a CursorHandoffArtifact from an IntakeResult.
 *
 * Call this when intakeResult.mode === "execute" and the consumer wants to
 * present a confirmation to H before delivery. Returns a preparation result
 * that describes what will happen and whether OCD has any conflicts.
 *
 * This is synchronous and writes nothing. A known `filePath` is bound by
 * reading identity metadata so the confirmation names a receiver. That
 * read is not an effect and is not a namespace lock.
 *
 * @param intakeResult  Output of runIntake(). Must have mode === "execute".
 * @param intentId      UCP envelope id of the intent (from runIntakeWithUCP).
 * @param responseId    UCP envelope id of the response (from runIntakeWithUCP).
 * @param policy        OCD policy — write_safe_globs, prohibited patterns, etc.
 */
export function prepareCursorExecution(
  intakeResult: IntakeResult,
  intentId:     string,
  responseId:   string,
  policy:       CursorOCDPolicy,
  parsedChange?: ParsedChange,
): CursorPreparationResult {
  if (intakeResult.mode !== "execute") {
    return {
      kind:   "not_execute",
      reason: `Cannot prepare cursor execution for mode "${intakeResult.mode}". Only "execute" mode is valid.`,
    };
  }

  let pc = parsedChange;
  if (pc?.filePath !== undefined && pc.approvedEffective === undefined) {
    if (policy.workspaceRoot.length === 0) {
      return {
        kind: "not_execute",
        reason: `${EFFECTIVE_RESOURCE_UNRESOLVED_MSG} Existing-object prepare requires a workspace root.`,
      };
    }
    const bound = bindReplaceChange(pc, policy.workspaceRoot);
    if (!bound.ok) {
      return { kind: "not_execute", reason: bound.message };
    }
    pc = bound.parsed;
  }

  const artifact      = buildCursorHandoffArtifact(intakeResult, intentId, responseId, policy, pc);
  const ocdClearance  = evaluateOCDForHandoff(artifact, policy);
  const withClearance = applyOCDClearance(artifact, ocdClearance);
  const display       = formatPreparationDisplay(withClearance);

  const presentHints: CursorPresentHints = {
    prohibitedGlobs:       policy.alwaysProhibitedGlobs,
    ...(parsedChange?.filePath !== undefined
      ? { parsedChangeFilePath: parsedChange.filePath }
      : {}),
  };

  if (ocdClearance.status === "cleared" || ocdClearance.status === "conflict_accepted") {
    return { kind: "ready_for_confirmation", artifact: withClearance, display, presentHints };
  }

  return { kind: "conflict_detected", artifact: withClearance, display, presentHints };
}

// ─── Phase 2: deliverCursorExecution ─────────────────────────────────────────

/**
 * Deliver an already-approved CursorHandoffArtifact through the delivery gate.
 *
 * Call this after H has called approveArtifact() on the prepared artifact.
 * The gate enforces that eligibility === "approved_for_cursor" before proceeding.
 *
 * @param approvedArtifact  A CursorHandoffArtifact with eligibility: "approved_for_cursor".
 * @param plugin            The transport adapter (in-process, IPC, etc.).
 * @param storeDir          Absolute path to the UCP store directory.
 * @param deps              Optional: injectable persistence fns for testing.
 */
export async function deliverCursorExecution(
  approvedArtifact: CursorHandoffArtifact,
  plugin:           CursorEditorPlugin,
  storeDir:         string,
  deps?:            CursorGateDeps,
): Promise<CursorExecutionResult> {
  const gate   = new CursorDeliveryGate(plugin, storeDir, deps);
  const result = await gate.deliver(approvedArtifact);

  switch (result.outcome) {
    case "accepted":
      return {
        kind:              "accepted",
        deliveryId:        result.deliveryId,
        artifactId:        approvedArtifact.id,
        handoffEnvelopeId: result.handoffEnvelopeId,
        receiptEnvelopeId: result.receiptEnvelopeId,
        display:           { verdict: "accepted", headline: "Edit applied.", note: null },
      };

    case "refused_due_to_scope":
      return {
        kind:          "refused_due_to_scope",
        deliveryId:    result.deliveryId,
        scopeQuestion: result.scopeQuestion,
        display:       {
          verdict:  "refused",
          headline: "Scope clarification needed.",
          note:     result.scopeQuestion.explanation,
        },
      };

    case "refused_due_to_execution_error":
      return {
        kind:       "refused_due_to_execution_error",
        deliveryId: result.deliveryId,
        errorCode:  result.errorCode,
        detail:     result.detail,
        display:    {
          verdict:  "refused",
          headline: formatErrorHeadline(result.errorCode),
          note:     result.detail,
        },
      };

    case "blocked_ineligible":
      return {
        kind:    "blocked_ineligible",
        display: {
          verdict:  "blocked",
          headline: "Delivery blocked: artifact not approved.",
          note:     result.reason,
        },
      };

    case "blocked_persistence_failure":
      return {
        kind:    "blocked_persistence_failure",
        reason:  result.reason,
        display: {
          verdict:  "blocked",
          headline: "Delivery blocked: provenance record could not be written.",
          note:     result.reason,
        },
      };
  }
}

// ─── Consumer helpers ─────────────────────────────────────────────────────────

/**
 * Returns true if the preparation result needs H to review OCD conflicts
 * before the artifact can be approved.
 */
export function hasConflicts(result: CursorPreparationResult): boolean {
  return result.kind === "conflict_detected";
}

/**
 * Returns true if the execution result is "accepted" (edit applied on disk).
 */
export function isCursorExecutionAccepted(result: CursorExecutionResult): boolean {
  return result.kind === "accepted";
}

/**
 * Returns a plain-English note for the consumer to display.
 *
 * "accepted"                      → null (headline is sufficient)
 * "refused_due_to_scope"          → scope question explanation
 * "refused_due_to_execution_error" → detail text
 * "blocked_*"                     → block reason
 */
export function getCursorExecutionNote(result: CursorExecutionResult): string | null {
  switch (result.kind) {
    case "accepted":
      return null;
    case "refused_due_to_scope":
      return result.scopeQuestion.explanation;
    case "refused_due_to_execution_error":
      return result.detail;
    case "blocked_ineligible":
      return "Artifact must be approved by H before delivery.";
    case "blocked_persistence_failure":
      return result.reason;
  }
}

// ─── Internal formatters ──────────────────────────────────────────────────────

function formatPreparationDisplay(artifact: CursorHandoffArtifact): CursorPreparationDisplay {
  const { ocdClearance, changeSpec, scopeConstraint } = artifact;
  const cleared  = ocdClearance.status === "cleared" || ocdClearance.status === "conflict_accepted";
  const headline = cleared ? "Ready to apply." : "Conflict detected — review before confirming.";

  const targetFile = scopeConstraint.allowedFiles.length === 1
    ? (scopeConstraint.allowedFiles[0] ?? null)
    : null;

  return {
    headline,
    summary:   changeSpec.summary,
    targetFile,
    conflicts: ocdClearance.conflictsDetected,
  };
}

function formatErrorHeadline(errorCode: CursorExecutionErrorCode): string {
  switch (errorCode) {
    case "old_value_not_found":    return "Edit target not found in file.";
    case "ambiguous_match":        return "Edit target is ambiguous — found more than once.";
    case "file_not_found":         return "Target file not found.";
    case "scope_outside_allowed":  return "Target file is outside the approved scope.";
    case "prohibited_pattern_match": return "Target file matches a prohibited pattern.";
    case "parse_error":            return "No edit directive available.";
    case "merge_conflict":         return "File could not be written — possible merge conflict.";
    case "outside_workspace":      return "Path is outside the workspace. Use a relative path inside the current workspace.";
    case "effective_resource_unresolved": return "Effective resource could not be resolved. No edit was performed.";
    case "effective_resource_changed": return "Approved file identity changed. Fresh preview and approval are required. No edit was performed.";
    case "invalid_replacement_chars": return "Replacement text contains invisible or unsafe characters (BIDI / zero-width / control).";
    case "prohibited_path":       return "Target path is protected. No edit was performed.";
    case "delivery_timeout":       return "Delivery timed out.";
  }
}
