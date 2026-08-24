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
export { AUTHORITY_DECISION_RELATION_RETIREMENT, classifyIncomingAdvisory, deriveStanding, groundsIdFromBasis, validateRetirementRequest, } from "./objection-retirement.js";
export { MODEL_ADVISORY_KINDS, canonicalModelAdvisoryEvent } from "./types.js";
// Artifact mapper
export { buildClaudeHandoffArtifact, approveClaudeArtifact, narrowClaudeArtifactScope, } from "./artifact-mapper.js";
export { ClaudeDeliveryGate } from "./delivery-gate.js";
// P4 — evidence-basis provenance (system-derived; zero authority)
export { deriveDeliveryEvidenceBasis, classifyAdvisoryEvidenceBasis, validateMappedRetirementEnvelopePair, } from "./evidence-basis.js";
// Stub adapter (testing + development)
export { ClaudeStubAdapter } from "./adapters/stub-adapter.js";
// Real API adapter (Phase 8C)
export { ClaudeApiAdapter } from "./adapters/api-adapter.js";
// Multi-LLM consensus layer
export { OpenAiCompatibleAgentAdapter } from "./adapters/openai-compatible-adapter.js";
export { MultiLlmPlugin } from "./adapters/multi-llm-adapter.js";
export { normalizeResponse, evaluatePolicy, buildReviewPayload, extractRawPosition, DEFAULT_MULTI_LLM_OPTIONS, MAX_OBSERVATION_SUMMARY_CHARS, } from "./adapters/multi-llm-types.js";
//# sourceMappingURL=index.js.map