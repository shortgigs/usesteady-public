/**
 * Decision Record Bridge (DECISION_RECORD_BRIDGE_V1) - public surface.
 *
 * Core (Runtime) -> Portal side-channel that emits the kernel's canonical
 * GovernedDecisionRecord as the `usesteady.decision-record/v1` wire payload, so
 * Portal V2's O4/O5 surfaces project REAL governed decisions. DEFAULT OFF;
 * never-throws; hash-parity with the Portal validator (INV-DEC-012).
 */

export {
  DECISION_RECORD_SCHEMA,
  type DecisionRecordPhase,
  type DecisionRecordPayloadV1,
  type DecisionRecordBody,
  type DecisionRecordAuthority,
  type DecisionRecordProvenanceLinks,
  type DecisionRecordExecutionOutcome,
  type DecisionRecordReality,
  type DecisionRecordEpistemicObject,
  type DecisionRecordReference,
} from "./types.js";
export {
  decisionRecordFromGoverned,
  attachRecordHash,
  validateDecisionRecordPayload,
  type DecisionRecordLinks,
  type PayloadValidation,
} from "./build-payload.js";
export {
  resolveDecisionReporting,
  normalizeDecisionRecordsBaseUrl,
  DECISION_RECORDS_TOGGLE_ENV,
  DECISION_RECORDS_URL_ENV,
  PORTAL_TOKEN_ENV,
  type DecisionReportingConfig,
  type DecisionReportingDisabledReason,
} from "./opt-in.js";
export { sendDecisionRecord, type SendResult, type SendOptions } from "./transport.js";
export {
  reportDecisionToPortal,
  type ReportDecisionResult,
  type ReportDecisionOptions,
} from "./report-decision.js";
export {
  resolveDecisionRecordUcpRootId,
  readPortalSuppliedUcpRootId,
  resolveStoredRecordUcpRootId,
  type ResolveDecisionRecordUcpRootOptions,
} from "./resolve-ucp-root.js";
