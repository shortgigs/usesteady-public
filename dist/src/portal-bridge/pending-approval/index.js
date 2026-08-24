/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - Core-side public
 * surface.
 *
 * PR1: frozen wire types + pure payload builder/validator + decision parser/
 *      interpreter + opt-in resolution (default off).
 * PR2: best-effort HTTPS transport (emit/poll, never throws) + emit->poll->timeout
 *      orchestrator (fail-closed, deterministic under injected clock/sleep).
 * PR3: run -> input mapping (read-only) for the CLI approval-gate hook.
 * S0/S1: shared resolveRemoteApprovalDecision + web resolveWebConfirmYes
 *      (opt-in POST /confirm parity; default off).
 *
 * Authority: this bridge is a remote INPUT to Core's existing approval gate, never a
 * new authority and never an executor. `approved` is necessary, not sufficient - the
 * caller re-validates locally. Any degradation falls back to Core's local approval
 * flow; silence/absence is never approval.
 */
export { PENDING_APPROVAL_SCHEMA, PENDING_AFFECTED_RESOURCES_LIMIT, PENDING_MODEL_ADVISORIES_LIMIT, PENDING_MODEL_ADVISORY_EXPLANATION_LIMIT, PENDING_MODEL_ADVISORY_KINDS, buildPendingApprovalPayload, validatePendingApprovalPayload, } from "./payload.js";
export { APPROVAL_DECISION_SCHEMA, parseApprovalDecisionResponse, selectDecisionForStep, selectDecisionForStepAndCycle, interpretDecisionStatus, interpretDecision, } from "./decision.js";
export { resolvePortalApprovals, PORTAL_APPROVALS_URL_ENV, PORTAL_TOKEN_ENV, } from "./opt-in.js";
export { emitPendingApproval, pollApprovalDecision, } from "./transport.js";
export { runPendingApprovalBridge, withdrawPendingApprovalGate, } from "./bridge.js";
export { pendingApprovalInputFromRun } from "./from-run.js";
export { resolveRemoteApprovalDecision, resolveWebConfirmYes, verifyRemoteEntryAuthority, } from "./resolve-remote.js";
//# sourceMappingURL=index.js.map