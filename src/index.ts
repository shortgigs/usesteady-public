/**
 * usesteady-core-v2 — public API surface.
 *
 * This is the only import path consumers should use.
 * Internal modules may be accessed directly for testing.
 */

// ── UCP ────────────────────────────────────────────────────────────────────────
export type {
  UCPEnvelope,
  UCPType,
  UCPKind,         // @deprecated alias for UCPType
  UCPMeta,
  UCPRefs,
  IntentEnvelope,
  PRVEnvelope,
  SafetyEnvelope,
  ContextAlignmentEnvelope,
  DisambiguationEnvelope,
  CompletionEnvelope,
  IntentInterpretationEnvelope,
  ChangeInterpretationEnvelope,
  ResponseEnvelope,
  InteractionContractEnvelope,
  InteractionEventEnvelope,
  DebugTraceEnvelope,
  // Payload types
  IntentPayload,
  PRVPayload,
  SafetyPayload,
  ContextAlignmentPayload,
  DisambiguationPayload,
  CompletionPayload,
  IntentInterpretationPayload,
  ChangeInterpretationPayload,
  ResponsePayload,
  InteractionContractPayload,
  InteractionEventPayload,
  DebugTracePayload,
  CommandEnvelope,
  CommandPayload,
  ExecutionResultEnvelope,
  ExecutionResultPayload,
} from "./ucp/types.js";
export {
  createEnvelope,
  createIntentEnvelope,
  createPRVEnvelope,
  createSafetyEnvelope,
  createContextAlignmentEnvelope,
  createDisambiguationEnvelope,
  createCompletionEnvelope,
  createIntentInterpretationEnvelope,
  createChangeInterpretationEnvelope,
  createResponseEnvelope,
  createInteractionContractEnvelope,
  createInteractionEventEnvelope,
  createDebugTraceEnvelope,
  createCommandEnvelope,
  createExecutionResultEnvelope,
} from "./ucp/envelope.js";
export { hashObject, stableStringify } from "./ucp/hashes.js";
// UCP mappers (pure, one per envelope family)
export { mapIntentToEnvelope }              from "./ucp/mappers/map-intent.js";
export { mapPRVToEnvelope }                 from "./ucp/mappers/map-prv.js";
export { mapSafetyToEnvelope }              from "./ucp/mappers/map-safety.js";
export { mapContextToEnvelope }             from "./ucp/mappers/map-context.js";
export { mapDisambiguationToEnvelope }      from "./ucp/mappers/map-disambiguation.js";
export { mapCompletionToEnvelope }          from "./ucp/mappers/map-completion.js";
export { mapIntentInterpretationToEnvelope } from "./ucp/mappers/map-intent-interpretation.js";
export { mapChangeInterpretationToEnvelope } from "./ucp/mappers/map-change-interpretation.js";
export { mapResponseToEnvelope }            from "./ucp/mappers/map-response.js";
export { mapDebugTraceToEnvelope }          from "./ucp/mappers/map-debug-trace.js";
export { mapJsonOpToCommandEnvelope }       from "./ucp/mappers/map-json-op-command.js";
export { mapWorkflowExecutionResultToEnvelope } from "./ucp/mappers/map-workflow-execution-result.js";

// ── PRV ────────────────────────────────────────────────────────────────────────
export type { PRVResult, PRVContext } from "./prv/types.js";
export { runPRV } from "./prv/prv.js";

// ── Safety ─────────────────────────────────────────────────────────────────────
export type { SafetyVerdict, SafetyReason, SafetyResult, SafetyDetector } from "./safety/types.js";
export { runSafetyGate } from "./safety/safety-gate.js";

// ── Interaction Contract ───────────────────────────────────────────────────────
export type { InteractionContract, InteractionEvent, ObservedIntentPatterns } from "./interaction/types.js";
export { DEFAULT_CONTRACT, DEFAULT_OBSERVED_INTENT_PATTERNS, createDefaultContract } from "./interaction/defaults.js";
export { getAmbiguityPolicy, getExplanationPolicy, getUnsupportedGuidancePolicy } from "./interaction/selectors.js";
export { applyInteractionEvent } from "./interaction/updater.js";
export { observeIntentPattern } from "./interaction/observe.js";
export { applyGuidanceOrdering, FAMILIARITY_THRESHOLD } from "./interaction/guidance-order.js";

// ── Understand: Context Alignment ─────────────────────────────────────────────
export type { ContextAlignmentResult } from "./understand/context/types.js";
export { runContextAlignment } from "./understand/context/context-alignment.js";

// ── Understand: Disambiguation ────────────────────────────────────────────────
export type { DisambiguationResult, AmbiguityDetector } from "./understand/disambiguation/types.js";
export { runDisambiguation } from "./understand/disambiguation/registry.js";

// ── Understand: Completion ────────────────────────────────────────────────────
export type {
  CompletionResult,
  CompletionNextStep,
  CompletionRule,
} from "./understand/completion/types.js";
export { runCompletion } from "./understand/completion/completion.js";

// ── Understand: Interpretation (v1) ──────────────────────────────────────────
export type {
  InterpretationResult,
  InterpretationCategory,
  InterpretationRule,
  ParsedChange,
} from "./understand/interpretation/types.js";
export { interpretChange } from "./understand/interpretation/interpretation.js";
export { parseChange } from "./understand/interpretation/parser.js";

// ── Understand: Intent Interpretation Bridge ──────────────────────────────────
export type {
  IntentInterpretationCategory,
  IntentInterpretation,
  IntentInterpreter,
  GuidancePayload,          // home of record — enriched form includes interpretation
} from "./understand/intent-interpretation/types.js";
export { runIntentInterpretation, enrichGuidance } from "./understand/intent-interpretation/intent-interpretation.js";

// ── Understand: Silent Guidance Mode (Phase 4C) ───────────────────────────────
export type { SilentGuidanceMode } from "./understand/silent-guidance/types.js";
export { selectSilentGuidanceMode, getSilentGuidanceSteps } from "./understand/silent-guidance/index.js";

// ── Intake (main pipeline) ────────────────────────────────────────────────────
export type {
  IntakeSignal,
  IntentState,
  ResponseMode,
  IntakeContext,
  IntakeResult,
} from "./intake/types.js";
export type { DebugTrace } from "./intake/trace.js";
export { runIntake, runIntakeWithTrace, runIntakeWithUCP } from "./intake/intake-service.js";
export type { UCPBundle, RunIntakeWithUCPResult } from "./intake/intake-service.js";

// ── Presentation (last mile before consumer render) ───────────────────────────
export type { PresentationOutput } from "./present/types.js";
export { formatIntakeResult } from "./present/format.js";

// ── Presentation: coordinator (Phase 5 integration path) ─────────────────────
export type { PresentResult } from "./present/present-coordinator.js";
export { presentFromInput, isReminderConfirmable, getReminderPrompt } from "./present/present-coordinator.js";

// ── Presentation: Reminder slice (Phase 5) ────────────────────────────────────
export type {
  ReminderPresentationState,
  ReminderConfidence,
  PresentAction,
  ReminderPresentation,
  RenderedReminder,
} from "./present/reminders/index.js";
export { presentReminder, renderReminder } from "./present/reminders/index.js";

// ── UCP Projection (Phase 2 — formal seam shape derived from UCPBundle) ───────
export type { UCPSeamProjection, UCPProjectionEnvelopeIds } from "./ucp/projection.js";
export { projectUCPBundle } from "./ucp/projection.js";

// ── UCP Phase 3A — artifact + execution trace envelope types and mappers ──────
export type { ArtifactPayload, ExecutionTracePayload } from "./ucp/types.js";
export type { ArtifactEnvelope, ExecutionTraceEnvelope } from "./ucp/types.js";
export { createArtifactEnvelope, createExecutionTraceEnvelope } from "./ucp/envelope.js";
// Mappers (also export minimal input types so consumers use structural typing, not branded imports)
export type { ArtifactLike } from "./ucp/mappers/map-artifact.js";
export { mapArtifactToEnvelope } from "./ucp/mappers/map-artifact.js";
export type { ArtifactWithTraceLike, TraceEntryLike } from "./ucp/mappers/map-execution-trace.js";
export { mapExecutionTraceToEnvelope } from "./ucp/mappers/map-execution-trace.js";

// ── UCP Phase 3B — replay report envelope type and mapper ─────────────────────
export type { ReplayReportPayload } from "./ucp/types.js";
export type { ReplayReportEnvelope } from "./ucp/types.js";
export { createReplayReportEnvelope } from "./ucp/envelope.js";
// Mapper (export minimal input types for structural compatibility with consumers)
export type {
  ReplayReportLike,
  NodeReplayResultLike,
} from "./ucp/mappers/map-replay-report.js";
export { mapReplayReportToEnvelope } from "./ucp/mappers/map-replay-report.js";

// ── UCP Phase 4A — persistence layer ──────────────────────────────────────────
// Callers supply storeDir — the library is path-agnostic.
// Example: join(process.env.DATA_DIR ?? homedir(), ".usesteady", "ucp")
export type { UCPIndex } from "./ucp/persistence/index.js";
export {
  LOG_FILENAME,
  INDEX_FILENAME,
  emptyIndex,
  ensureStoreDir,
  appendEnvelope,
  loadIndex,
  updateIndex,
  rebuildIndex,
  persistEnvelope,
} from "./ucp/persistence/index.js";

// ── Execution Layer: Reminder slice (Phase 6) ─────────────────────────────────
export type {
  ReminderExecutionRequest,
  ParsedTime,
  ExecutionRejectionCode,
  ExecutionValidation,
  ReminderExecutionArtifact,
  ReminderExecutionResult,
} from "./execution/reminders/index.js";
export { parseTimeText }             from "./execution/reminders/index.js";
export { validateExecutionRequest }  from "./execution/reminders/index.js";
export { buildExecutionRequest, executeReminder } from "./execution/reminders/index.js";
export type {
  ReminderExecutionDisplay,
  ReminderExecuteResult,
} from "./execution/reminders/index.js";
export { executeFromPresent, isExecutionAccepted, getExecutionNote } from "./execution/reminders/index.js";

// ── UCP Phase 6 — reminder execution envelope ─────────────────────────────────
export type { ReminderExecutionPayload }  from "./ucp/types.js";
export type { ReminderExecutionEnvelope } from "./ucp/types.js";
export { createReminderExecutionEnvelope } from "./ucp/envelope.js";
export { mapReminderExecutionToEnvelope }  from "./ucp/mappers/map-reminder-execution.js";

// ── Execution Layer: Cursor slice (Phase 8) ────────────────────────────────────
// Two-phase coordinator: prepare (build + OCD) → deliver (approved artifact + gate).
export type {
  CursorPreparationResult,
  CursorPreparationDisplay,
  CursorExecutionResult,
  CursorExecutionDisplay,
} from "./execution/cursor/index.js";
export {
  prepareCursorExecution,
  deliverCursorExecution,
  hasConflicts,
  isCursorExecutionAccepted,
  getCursorExecutionNote,
} from "./execution/cursor/index.js";
// Cursor handoff types and seam utilities (full module)
export type {
  CursorHandoffArtifact,
  CursorHandoffEligibility,
  CursorOCDClearance,
  CursorOCDClearanceStatus,
  CursorScopeConstraint,
  CursorChangeSpec,
  CursorDeliveryRequest,
  CursorResponse,
  CursorAccepted,
  CursorRefusedDueToScope,
  CursorRefusedDueToExecutionError,
  CursorScopeQuestion,
  CursorScopeQuestionKind,
  CursorExecutionErrorCode,
  CursorOCDPolicy,
  WorkspacePathValidationResult,
} from "./cursor/index.js";
export {
  buildCursorHandoffArtifact,
  narrowArtifactScope,
  approveArtifact,
  evaluateOCDForHandoff,
  applyOCDClearance,
  acceptOCDConflict,
  validateHProvidedPath,
  CursorDeliveryGate,
} from "./cursor/index.js";
export type { CursorEditorPlugin, CursorGateDeps, DeliveryGateResult } from "./cursor/delivery-gate.js";

// ── UCP Phase 4B — query layer ────────────────────────────────────────────────
// Read-only navigation over the persisted UCP envelope history.
// All queries follow refs only — no inference, no caching, no mutation.
export { readEnvelopeAt, readAllEnvelopes } from "./ucp/persistence/index.js";
export type { RunTimeline } from "./ucp/persistence/index.js";
export {
  getEnvelopeById,
  getByType,
  getChain,
  getArtifactByRunId,
  getTraceByArtifactId,
  getReplayByArtifactId,
  getReminderExecutionByResponseId,
  getTimeline,
} from "./ucp/persistence/index.js";

// ── Executor read-only seam (B3) ──────────────────────────────────────────────
// Read-only access to the durable, append-only execution ledger so Lane B (and
// any other consumer) can read governance records WITHOUT importing executor
// internals or any write/execute path. Pure reads + a frozen projection only.
// No write function (appendLedgerEntry) is exposed here by design. Authority
// records are not yet durably persisted and are intentionally not surfaced.
// @see docs/product/b3-readonly-executor-ledger-seam-v1.md
export type {
  PersistedLedgerEntry,
} from "./executor/persistence/types.js";
export {
  loadPersistedLedgerEntries,
  replayLedgerEntriesByExecutionId,
} from "./executor/persistence/append-ledger-entry.js";
export type {
  ExecutionLedgerRecord,
  ExecutionLedgerActor,
  ExecutionLedgerLineageEntry,
  ExecutionLedgerLineageKind,
} from "./executor/ledger/types.js";
export type {
  ExecutionLedgerEntryView,
  ExecutionLedgerIntentView,
  ExecutionLedgerLineageView,
} from "./executor/projection/ledger-entry-view.js";
export {
  EXECUTION_LEDGER_VIEW_VERSION,
  mapLedgerEntryToView,
} from "./executor/projection/ledger-entry-view.js";

// ─── Constitution Materialization V1 (Articles I, V, VI made executable) ──────
export type {
  ApprovalRecord,
  CanonicalTaskFact,
  ConfigurationFact,
  DecisionBasis,
  DecisionBasisFacts,
  DecisionBasisFingerprintVerification,
  PoliciesFact,
  ProposalFact,
  RepositoryProvenanceFact,
} from "./constitution/index.js";
export {
  APPROVAL_RECORD_JSONL_FILENAME,
  ApprovalRecordError,
  CONSTITUTION_STORE_DIRNAME,
  REPOSITORY_PROVENANCE_UNAVAILABLE,
  assembleDecisionBasis,
  captureRepositoryProvenance,
  computeDecisionBasisFingerprint,
  fingerprintWorkflowSpec,
  loadApprovalBasis,
  loadApprovalRecords,
  recordApprovalBasis,
  verifyDecisionBasisFingerprint,
} from "./constitution/index.js";
