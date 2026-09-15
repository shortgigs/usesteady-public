export type {
  ExecutionCapability,
  ExecutionCapabilityId,
  ProposalCapabilityBinding,
  RemediationProposal,
  RemediationProposalRecord,
} from "./types.js";

export {
  CAPABILITY_REGISTRY_VERSION,
  PROPOSAL_CAPABILITY_BINDINGS_V1,
  capabilityIdForObservationCode,
} from "./proposal-bindings.js";

export { EXECUTION_CAPABILITY_CATALOG_V1 } from "./catalog-v1.js";

export { PROPOSAL_VERSION, proposalCopyForCode } from "./proposal-copy.js";

export {
  generateRemediationProposalsFromDiagnostic,
  stableProposalId,
} from "./proposal-generator.js";

export {
  REMEDIATION_PROPOSALS_DISCLAIMER,
  renderRemediationProposalsSection,
} from "./render.js";
