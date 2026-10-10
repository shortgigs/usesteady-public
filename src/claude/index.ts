/**
 * Claude Managed Agents integration — V1 public API (Phase 8C).
 *
 * This module exports the complete V1 seam: artifact mapper, delivery gate,
 * stub adapter (tests), and real API adapter (production).
 *
 * See: docs/claude-v1-baseline.md — full invariant set (A1–A4, RA1–RA6)
 *
 * Reserved slots (NOT exported, not built in V1):
 *   - ucp.claude_session.v1
 *   - ucp.claude_result.v1
 *   - networkAccess: "allow_limited" semantics
 *   - session resumability
 *   - multi-session orchestration
 */

// Seam types
export type {
  ClaudeAgentHandoffArtifact,
  ClaudeHandoffEligibility,
  ClaudeExecutionDomain,
  ClaudeTaskSpec,
  ClaudeToolPolicy,
  ClaudeDeliveryRequest,
  ClaudeDeliveryResponse,
  ClaudeAccepted,
  ClaudeRefusedDueToScope,
  ClaudeRefusedDueToExecutionError,
  ClaudeScopeQuestion,
  ClaudeAdvisoryPositions,
  ModelAdvisoryKind,
  ModelAdvisoryPosition,
  ModelAdvisoryRecord,
  ModelRetirementRecord,
  RetiredAdvisoryContext,
} from "./types.js";
export {
  AUTHORITY_DECISION_RELATION_RETIREMENT,
  classifyIncomingAdvisory,
  deriveStanding,
  groundsIdFromBasis,
  validateRetirementRequest,
} from "./objection-retirement.js";
export { MODEL_ADVISORY_KINDS, canonicalModelAdvisoryEvent } from "./types.js";

// Artifact mapper
export {
  buildClaudeHandoffArtifact,
  approveClaudeArtifact,
  bindClaudeArtifactEffectiveReceiver,
  narrowClaudeArtifactScope,
} from "./artifact-mapper.js";
export type { ClaudeOCDPolicy } from "./artifact-mapper.js";

// Delivery gate
export type { ClaudeAgentPlugin, ClaudeDeliveryGateResult, ClaudeGateDeps } from "./delivery-gate.js";
export { ClaudeDeliveryGate } from "./delivery-gate.js";

// P4 — evidence-basis provenance (system-derived; zero authority)
export {
  deriveDeliveryEvidenceBasis,
  classifyAdvisoryEvidenceBasis,
  validateMappedRetirementEnvelopePair,
} from "./evidence-basis.js";
export type {
  DeliveryEvidenceBasis,
  AdvisoryEvidenceBasisLookup,
  MappedRetirementEnvelopeReader,
} from "./evidence-basis.js";

// Stub adapter (testing + development)
export { ClaudeStubAdapter } from "./adapters/stub-adapter.js";

// Real API adapter (Phase 8C)
export { ClaudeApiAdapter } from "./adapters/api-adapter.js";
export type { ClaudeApiAdapterConfig } from "./adapters/api-adapter.js";

// Multi-LLM consensus layer
export { OpenAiCompatibleAgentAdapter } from "./adapters/openai-compatible-adapter.js";
export type { OpenAiCompatibleAdapterConfig } from "./adapters/openai-compatible-adapter.js";

export { MultiLlmPlugin } from "./adapters/multi-llm-adapter.js";
export type { NamedPlugin } from "./adapters/multi-llm-adapter.js";

export type {
  OperationClass,
  RationaleCategory,
  QuorumState,
  PolicyMode,
  NormalizedDecision,
  MultiLlmOptions,
  ReviewPayload,
  ConsensusAuditRecord,
  ConsensusRoundEntry,
  ParticipantRawPosition,
  PolicyEvaluation,
} from "./adapters/multi-llm-types.js";
export {
  normalizeResponse,
  evaluatePolicy,
  buildReviewPayload,
  extractRawPosition,
  DEFAULT_MULTI_LLM_OPTIONS,
  MAX_OBSERVATION_SUMMARY_CHARS,
} from "./adapters/multi-llm-types.js";
