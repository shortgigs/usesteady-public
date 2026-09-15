/**
 * Constitution Materialization V1 — public surface.
 *
 * Takes USESTEADY_CONSTITUTION_V1 Articles I, V, and VI out of markdown and
 * into runtime objects:
 *
 *   - assembleDecisionBasis(spec)         Article I  — the eight-class basis
 *   - computeDecisionBasisFingerprint     Article VI — fingerprint = hash(basis)
 *   - verifyDecisionBasisFingerprint      Article V  — lifecycle re-check (INV-COMP-2)
 *   - recordApprovalBasis / loadApprovalBasis        — durable approval record (step 3)
 *
 * Zero authority. Assembling a basis or computing a fingerprint grants nothing;
 * human approval remains the sole approval authority (Article IV, INV-PA-2).
 */

export type {
  CanonicalTaskFact,
  ConfigurationFact,
  DecisionBasis,
  DecisionBasisFacts,
  PoliciesFact,
  ProposalFact,
  RepositoryProvenanceFact,
} from "./decision-basis.js";
export { assembleDecisionBasis } from "./decision-basis.js";

export {
  REPOSITORY_PROVENANCE_UNAVAILABLE,
  captureRepositoryProvenance,
} from "./repository-provenance.js";

export type { DecisionBasisFingerprintVerification } from "./fingerprint.js";
export {
  computeDecisionBasisFingerprint,
  fingerprintWorkflowSpec,
  verifyDecisionBasisFingerprint,
} from "./fingerprint.js";

export type { ApprovalRecord } from "./approval-record.js";
export {
  APPROVAL_RECORD_JSONL_FILENAME,
  ApprovalRecordError,
  CONSTITUTION_STORE_DIRNAME,
  loadApprovalBasis,
  loadApprovalRecords,
  recordApprovalBasis,
} from "./approval-record.js";
