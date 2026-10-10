/**
 * Candidate Plan Bridge (P.S1 - WORK_ITEM_LIFECYCLE_WIRING_V1 Lane P) - public
 * surface.
 *
 * Core (Runtime) -> Portal side-channel that emits a DRAFT's candidate plan as
 * the `usesteady.candidate-plan/v1` wire payload at draft-persist time - before
 * any ratification decision exists - so the Portal lifecycle rail's
 * `candidate_plan` stage renders from a stored record. Zero authority
 * (INV-WL-4); DEFAULT OFF; never-throws (INV-PS1-2).
 */

export {
  CANDIDATE_PLAN_SCHEMA,
  type CandidatePlanPayloadV1,
  type CandidatePlanBody,
  type CandidatePlanEntry,
  type CandidatePlanOperation,
  type CandidatePlanProvenanceLinks,
} from "./types.js";
export {
  candidatePlanFromDraft,
  attachPlanHash,
  validateCandidatePlanPayload,
  type CandidatePlanLinks,
  type PayloadValidation,
} from "./build-payload.js";
export {
  resolveCandidatePlanReporting,
  normalizeCandidatePlansBaseUrl,
  CANDIDATE_PLANS_TOGGLE_ENV,
  CANDIDATE_PLANS_URL_ENV,
  PORTAL_TOKEN_ENV,
  type CandidatePlanReportingConfig,
  type CandidatePlanReportingDisabledReason,
} from "./opt-in.js";
export { sendCandidatePlan, type SendResult, type SendOptions } from "./transport.js";
export {
  reportCandidatePlanToPortal,
  type ReportCandidatePlanResult,
  type ReportCandidatePlanOptions,
} from "./report-plan.js";
