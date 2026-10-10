/**
 * UseSteady internal Agent SDK — entrypoint (Phase 5).
 *
 * INTERNAL, non-public. This module is deliberately NOT re-exported from
 * `src/index.ts` (the public API surface) — the Phase 5 non-goal is "internal
 * only, no public SDK release". Internal hosts import from this deep path.
 *
 * Pipeline: `planProposal` (Proposal -> RoutingSurface -> DecisionBasis) ->
 * `captureApproval` (durable ApprovalRecord bound to the fingerprint). Zero
 * execution authority; execution stays behind the existing workflow gate.
 */

export {
  SDK_CANONICAL_SPEC_NAME,
  noSuggestions,
  type SdkProposalInput,
  type SdkContext,
  type SdkPlan,
  type SdkApprovalRequest,
  type SdkApprovalResult,
} from "./types.js";

export { planProposal } from "./plan.js";
export { captureApproval, verifyPlanFingerprint } from "./approve.js";

// Read side for hosts / replay (re-exported from the constitution surface).
export { loadApprovalBasis, loadApprovalRecords } from "../constitution/index.js";
