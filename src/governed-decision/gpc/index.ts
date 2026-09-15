/**
 * Governed Projection Capsules (GPC) — public surface.
 * Hybrid D: sandbox remains projection backend; workspace_key binds org;
 * capsule_id links the approved work item run. Institutional memory = ledger.
 */

export {
  contentAddress,
  requireHumanApproval,
  sha256Utf8,
  type ApprovedPlanStub,
  type Capsule,
  type ProjectionBackend,
  type ProjectionReceipt,
  type RealityProbeResult,
  type VerifiedProjectionRecord,
  type GpcWireStatus,
} from "./types.js";
export { sealCapsule } from "./seal.js";
export { CapsuleLedger } from "./ledger.js";
export {
  materializeProjection,
  materializeEphemeral,
  materializeSandboxFs,
  type MaterializeResult,
} from "./materialize.js";
export { probeProjection } from "./probe.js";
export {
  runGovernedProjectionCapsule,
  lookupGpcStatus,
  type RunGpcInput,
  type RunGpcResult,
} from "./flow.js";
export { approvedPlanFromDraft } from "./from-draft.js";
export {
  capsuleLedgerPathForSandbox,
  capsuleProjectionsRoot,
  CAPSULE_LEDGER_FILENAME,
} from "./paths.js";
