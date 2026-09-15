/**
 * Cursor integration — public API surface.
 *
 * Exports the types, functions, and classes that consumers of this module need.
 * Internal helpers (normalizePath, buildChangeSpecFrom*, etc.) are not re-exported.
 *
 * ── Intended consumers ────────────────────────────────────────────────────────
 *
 *   - Workflow coordinator / product session: calls buildCursorHandoffArtifact
 *     + evaluateOCDForHandoff + CursorDeliveryGate.deliver() in sequence
 *   - Test suite: imports types and stubs CursorEditorPlugin
 *   - UCP persistence layer: already imported via src/ucp/envelope.ts
 *
 * ── Call sequence ─────────────────────────────────────────────────────────────
 *
 *   1. buildCursorHandoffArtifact(intake, intentId, responseId, policy)
 *        → initial artifact (eligibility: "pending_confirmation")
 *
 *   2. evaluateOCDForHandoff(artifact, policy)
 *        → ocdClearance
 *      applyOCDClearance(artifact, ocdClearance)
 *        → artifact with OCD result (may be conflict_detected)
 *
 *   3. [OCD conflict? → acceptOCDConflict(artifact) when H accepts]
 *
 *   4. [H narrows scope? → narrowArtifactScope(artifact, newAllowedFiles)]
 *      [H provides path from empty?
 *        → validateHProvidedPath(path, workspaceRoot) — tier 1
 *        → if ok: narrowArtifactScope(artifact, [path])
 *        → re-run evaluateOCDForHandoff for tier 2]
 *
 *   5. approveArtifact(artifact, confirmedAt)
 *        → artifact with eligibility: "approved_for_cursor"
 *
 *   6. new CursorDeliveryGate(plugin, storeDir).deliver(artifact)
 *        → DeliveryGateResult
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type {
  CursorHandoffEligibility,
  CursorOCDClearanceStatus,
  CursorOCDClearance,
  CursorScopeConstraint,
  CursorChangeSpec,
  CursorHandoffArtifact,
  CursorOCDPolicy,
  CursorDeliveryRequest,
  CursorAccepted,
  CursorRefusedDueToScope,
  CursorRefusedDueToExecutionError,
  CursorResponse,
  CursorScopeQuestionKind,
  CursorScopeQuestion,
  CursorExecutionErrorCode,
  WorkspacePathValidationResult,
} from "./types.js";

// ─── Artifact mapper ──────────────────────────────────────────────────────────

export {
  buildCursorHandoffArtifact,
  narrowArtifactScope,
  approveArtifact,
} from "./artifact-mapper.js";

// ─── OCD evaluator ────────────────────────────────────────────────────────────

export {
  evaluateOCDForHandoff,
  evaluatePathsAgainstOCDPolicy,
  validateHProvidedPath,
  applyOCDClearance,
  acceptOCDConflict,
} from "./ocd-evaluator.js";

// ─── Delivery gate ────────────────────────────────────────────────────────────

export {
  CursorDeliveryGate,
} from "./delivery-gate.js";

export type {
  CursorEditorPlugin,
  CursorGateDeps,
  DeliveryGateResult,
} from "./delivery-gate.js";
