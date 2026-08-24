/**
 * Phase 3 Lane A (A2) — approval provenance for execution-return transport.
 */
export type { BridgeApprovalProvenanceState, ExecutionReturnApprovalProvenance, } from "./types.js";
export { createBridgeApprovalProvenanceState, recordBridgeApprovalDecision, accumulateBridgeApprovalFromRemote, resolveExecutionReturnApprovalProvenance, } from "./accumulator.js";
export { maxHandoffConfirmedAtFromSessions, maxHandoffConfirmedAtIso, } from "./handoff-timestamp.js";
//# sourceMappingURL=index.d.ts.map