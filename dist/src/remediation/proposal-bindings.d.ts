/**
 * Static observation → capability bindings (INV-GEN-12).
 */
import type { ExecutionCapabilityId, ProposalCapabilityBinding } from "./types.js";
export declare const CAPABILITY_REGISTRY_VERSION = "cap-registry-v1";
export declare const PROPOSAL_CAPABILITY_BINDINGS_V1: readonly ProposalCapabilityBinding[];
/** Exact match only — no string inference. */
export declare function capabilityIdForObservationCode(code: string): ExecutionCapabilityId | undefined;
//# sourceMappingURL=proposal-bindings.d.ts.map