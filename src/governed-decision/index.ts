/**
 * Public surface for the constitutional execution kernel spine.
 *
 * Canonical architecture: docs/architecture/USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md
 */

export * from "./types.js";
export {
  runGovernedDecisionSpine,
  type StagePorts,
  type SpineInput,
  type SpineAccumulator,
  type BaseStageContext,
  type BasisStageContext,
} from "./pipeline.js";
export {
  projectGovernedDecision,
  renderProjectionLines,
  type ProjectedStatus,
  type ProjectedSection,
  type GovernedDecisionProjection,
} from "./projection.js";
export {
  produceDraft,
  produceFinal,
  ratifiableFingerprint,
  type HumanRatification,
  type ProduceFinalOptions,
  type LoopInput,
} from "./runner.js";
export {
  makeExecutionPort,
  executionPort,
  identityExecutor,
  type DeterministicExecutor,
  type ExecutorOutcome,
} from "./stages/execution.js";
export { makeSandboxedFsExecutor } from "./stages/fs-executor.js";
export { makeHumanAttestationExecutor } from "./stages/human-attestation-executor.js";
export { makeDocumentRecordExecutor } from "./stages/document-record-executor.js";
export { makeDocumentRecordRealityProbe } from "./stages/document-record-reality-probe.js";
export {
  makeObservationPort,
  observationPort,
  agreeingRealityProbe,
  type RealityProbe,
} from "./stages/observation.js";
export { makeFsRealityProbe } from "./stages/fs-reality-probe.js";
export {
  makeFsScopeSensor,
  deriveObservationScope,
  snapshotFsScope,
  diffScopeSnapshots,
  authorizedDeltaPaths,
  classifyCollateral,
  type ScopeSensor,
  type ScopeSensing,
  type ScopeDiff,
  type CollateralClassification,
} from "./stages/scope-snapshot.js";
export {
  createGovernedDecisionStore,
  type GovernedDecisionStore,
  type StoredRecord,
  type StoredEnvelope,
  type StoredKind,
  type ThreadSummary,
} from "./store.js";
export {
  classifyEpistemic,
  CERTIFICATION_RULE,
  KIND_CEILING,
  type EpistemicObject,
  type EpistemicKind,
  type EpistemicStatus,
} from "./epistemic.js";
export {
  evaluateElicitation,
  type ElicitationOutcome,
  type ElicitationBasis,
} from "./elicitation.js";
export {
  buildInvocationLineage,
  renderLineageLines,
  type InvocationLineage,
  type LineageNode,
  type LineageEdge,
} from "./lineage.js";
export {
  makePersonaRatification,
  syntheticRatifierEnabled,
  SYNTHETIC_RATIFIER_ENV,
  type PersonaRatificationInput,
} from "./ratifier/persona.js";
export {
  proposeDecomposition,
  deriveRiskClass,
  hashConversation,
  MAX_WORK_ITEMS,
  MAX_STOP_CONDITIONS,
  type CandidateWorkItem,
  type DecompositionProposal,
  type DecompositionModelCall,
  type WorkItemRiskClass,
} from "./decomposition/decompose.js";
export {
  runDecomposedLoop,
  policyClearanceVerdict,
  type DecomposedLoopOptions,
  type DecomposedLoopResult,
  type DecomposedItemResult,
  type ItemVerdict,
} from "./decomposition/loop.js";
export { runGovernedDecisionCli, type CliIO } from "./cli.js";
export {
  handleGovernedApi,
  registerGovernedRoutes,
  type GovernedApiRequest,
  type GovernedApiResponse,
  type GovernedApiDeps,
  type GovernedHttpApp,
} from "./http.js";
