/**
 * UCP envelope factory.
 *
 * ?? Identity contract ?????????????????????????????????????????????????????????
 *
 *   id   = sha256({ type, payload, refs })
 *          Content-addressed: same content ? same id.
 *          Does NOT include ts ? never changes when only ts changes.
 *
 *   hash = sha256({ id, meta, payload, refs, type, version })
 *          Integrity hash covering all fields except ts (mutable) and hash itself.
 *          ts is excluded so the hash is stable regardless of wall-clock time.
 *
 * ?? Determinism guarantee ?????????????????????????????????????????????????????
 *
 *   Two calls to createEnvelope() with identical type, payload, source, and refs
 *   will produce envelopes with the SAME id and SAME hash.
 *   They will differ only in ts (timestamp).
 *
 * ?? No randomness ?????????????????????????????????????????????????????????????
 *
 *   createEnvelope does NOT use randomUUID or any non-deterministic input.
 *   id is fully determined by content.
 */
import type { UCPEnvelope, UCPType, UCPRefs, IntentPayload, PRVPayload, SafetyPayload, ContextAlignmentPayload, DisambiguationPayload, CompletionPayload, IntentInterpretationPayload, ChangeInterpretationPayload, ResponsePayload, InteractionContractPayload, InteractionEventPayload, DebugTracePayload, IntentEnvelope, PRVEnvelope, SafetyEnvelope, ContextAlignmentEnvelope, DisambiguationEnvelope, CompletionEnvelope, IntentInterpretationEnvelope, ChangeInterpretationEnvelope, ResponseEnvelope, InteractionContractEnvelope, InteractionEventEnvelope, DebugTraceEnvelope, ArtifactPayload, ExecutionTracePayload, ReplayReportPayload, ArtifactEnvelope, ExecutionTraceEnvelope, ReplayReportEnvelope, ReminderExecutionPayload, ReminderExecutionEnvelope, CursorHandoffPayload, CursorReceiptPayload, CursorRefusedPayload, CursorHandoffEnvelope, CursorReceiptEnvelope, CursorRefusedEnvelope, ClaudeHandoffPayload, ClaudeReceiptPayload, ClaudeRefusedPayload, ClaudeHandoffEnvelope, ClaudeReceiptEnvelope, ClaudeRefusedEnvelope, ModelAdvisoryPayload, ModelAdvisoryEnvelope, ModelEvidenceBasisPayload, ModelEvidenceBasisEnvelope, ModelPositionRetirementPayload, ModelPositionRetirementEnvelope, RetiredPositionReassertionPayload, RetiredPositionReassertionEnvelope, ExecutorReportPayload, ExecutorReportEnvelope, OutcomeObservationPayload, OutcomeObservationEnvelope, OutcomeReconciliationPayload, OutcomeReconciliationEnvelope, WorkflowRunPayload, WorkflowRunEnvelope, CommandPayload, CommandEnvelope, ExecutionResultPayload, ExecutionResultEnvelope } from "./types.js";
export declare function recomputeEnvelopeIdentity<T>(envelope: Pick<UCPEnvelope<T>, "id" | "type" | "version" | "payload" | "meta" | "refs">): {
    readonly id: string;
    readonly hash: string;
};
/**
 * Create a UCPEnvelope from its constituent parts.
 *
 * @param type    Dot-notation type string, e.g. "ucp.intent.v1".
 * @param payload The structured payload. Must map EXACTLY from the source type.
 * @param source  The module name that produced this envelope (e.g. "completion").
 * @param refs    Optional parent/root envelope references.
 */
export declare function createEnvelope<T>(type: UCPType, payload: T, source: string, refs?: UCPRefs): UCPEnvelope<T>;
export declare function createIntentEnvelope(payload: IntentPayload, refs?: UCPRefs): IntentEnvelope;
export declare function createPRVEnvelope(payload: PRVPayload, refs?: UCPRefs): PRVEnvelope;
export declare function createSafetyEnvelope(payload: SafetyPayload, refs?: UCPRefs): SafetyEnvelope;
export declare function createContextAlignmentEnvelope(payload: ContextAlignmentPayload, refs?: UCPRefs): ContextAlignmentEnvelope;
export declare function createDisambiguationEnvelope(payload: DisambiguationPayload, refs?: UCPRefs): DisambiguationEnvelope;
export declare function createCompletionEnvelope(payload: CompletionPayload, refs?: UCPRefs): CompletionEnvelope;
export declare function createIntentInterpretationEnvelope(payload: IntentInterpretationPayload, refs?: UCPRefs): IntentInterpretationEnvelope;
export declare function createChangeInterpretationEnvelope(payload: ChangeInterpretationPayload, refs?: UCPRefs): ChangeInterpretationEnvelope;
export declare function createResponseEnvelope(payload: ResponsePayload, refs?: UCPRefs): ResponseEnvelope;
export declare function createInteractionContractEnvelope(payload: InteractionContractPayload, refs?: UCPRefs): InteractionContractEnvelope;
export declare function createInteractionEventEnvelope(payload: InteractionEventPayload, refs?: UCPRefs): InteractionEventEnvelope;
export declare function createDebugTraceEnvelope(payload: DebugTracePayload, refs?: UCPRefs): DebugTraceEnvelope;
/**
 * Create an artifact envelope from a finalized run record.
 *
 * source = "artifact_finalizer" ? the component that calls finalizeArtifact().
 * refs.rootId = intentId (ucp.intent.v1 ID) when available ? closes the provenance chain.
 * refs.parentId = response envelope ID when available.
 */
export declare function createArtifactEnvelope(payload: ArtifactPayload, refs?: UCPRefs): ArtifactEnvelope;
/**
 * Create an execution trace envelope ? the sealed batch record of a run's timeline.
 *
 * source = "artifact_finalizer" ? emitted at the same point as the artifact envelope.
 * refs.parentId = artifact envelope ID (immediate causal predecessor).
 * refs.rootId   = intentId (propagated from artifact envelope).
 */
export declare function createExecutionTraceEnvelope(payload: ExecutionTracePayload, refs?: UCPRefs): ExecutionTraceEnvelope;
/**
 * Create a replay report envelope ? the canonical record of a verification outcome.
 *
 * source = "replay_engine" ? the component that calls verifyArtifact().
 * refs.parentId = artifact envelope ID (the artifact that was verified).
 * refs.rootId   = intentId (propagated from artifact envelope, when available).
 *
 * NOTE: replay is a statement about an artifact, not an independent truth.
 * The parentId link is the formal expression of that relationship.
 */
export declare function createReplayReportEnvelope(payload: ReplayReportPayload, refs?: UCPRefs): ReplayReportEnvelope;
/**
 * Create a cursor handoff envelope ? persisted by the delivery gate BEFORE
 * the artifact is passed to Cursor. Hard gate: if this fails, delivery is blocked.
 *
 * source = "cursor_delivery_gate"
 * refs.parentId = response envelope ID (ucp.response.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.response.v1 ? ucp.cursor_handoff.v1
 */
export declare function createCursorHandoffEnvelope(payload: CursorHandoffPayload, refs?: UCPRefs): CursorHandoffEnvelope;
/**
 * Create a cursor receipt envelope ? persisted AFTER Cursor returns "accepted".
 * Records that Cursor took ownership of the artifact.
 *
 * source = "cursor_delivery_gate"
 * refs.parentId = cursor handoff envelope ID (ucp.cursor_handoff.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.cursor_handoff.v1 ? ucp.cursor_receipt.v1
 *   ? [ucp.cursor_artifact.v1 ? RESERVED FUTURE SLOT]
 *     ? ucp.execution_trace.v1
 */
export declare function createCursorReceiptEnvelope(payload: CursorReceiptPayload, refs?: UCPRefs): CursorReceiptEnvelope;
/**
 * Create a cursor refused envelope ? persisted when Cursor returns either
 * refused_due_to_scope or refused_due_to_execution_error.
 *
 * source = "cursor_delivery_gate"
 * refs.parentId = cursor handoff envelope ID (ucp.cursor_handoff.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.cursor_handoff.v1 ? ucp.cursor_refused.v1 (dead end or retry trigger)
 */
export declare function createCursorRefusedEnvelope(payload: CursorRefusedPayload, refs?: UCPRefs): CursorRefusedEnvelope;
/**
 * Create a Claude handoff envelope ? persisted by the delivery gate BEFORE
 * the artifact is passed to Claude Managed Agents. Hard gate: if this fails,
 * delivery is blocked.
 *
 * source = "claude_delivery_gate"
 * refs.parentId = response envelope ID (ucp.response.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.response.v1 ? ucp.claude_handoff.v1
 */
export declare function createClaudeHandoffEnvelope(payload: ClaudeHandoffPayload, refs?: UCPRefs): ClaudeHandoffEnvelope;
/**
 * Create a Claude receipt envelope ? persisted AFTER Claude accepts the task.
 * Records that Claude started a managed agent session.
 *
 * source = "claude_delivery_gate"
 * refs.parentId = claude handoff envelope ID (ucp.claude_handoff.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.claude_handoff.v1 ? ucp.claude_receipt.v1
 */
export declare function createClaudeReceiptEnvelope(payload: ClaudeReceiptPayload, refs?: UCPRefs): ClaudeReceiptEnvelope;
/**
 * Create a Claude refused envelope ? persisted when Claude responds with
 * refused_due_to_scope or refused_due_to_execution_error.
 *
 * source = "claude_delivery_gate"
 * refs.parentId = claude handoff envelope ID (ucp.claude_handoff.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.claude_handoff.v1 ? ucp.claude_refused.v1 (dead end or retry trigger)
 */
export declare function createClaudeRefusedEnvelope(payload: ClaudeRefusedPayload, refs?: UCPRefs): ClaudeRefusedEnvelope;
/**
 * Create a model advisory envelope ? persisted by the delivery gate when
 * Claude responds with kind: "advisory". One envelope per advisory position.
 *
 * The exact model-authored position survives here as durable, content-addressed
 * evidence. A later human supersession decision never alters this record; the
 * supersession relation lives on the Portal-signed authority assertion and on
 * the workflow task record.
 *
 * source = "claude_delivery_gate"
 * refs.parentId = claude handoff envelope ID (ucp.claude_handoff.v1)
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * Chain position: ucp.claude_handoff.v1 ? ucp.model_advisory.v1
 */
export declare function createModelAdvisoryEnvelope(payload: ModelAdvisoryPayload, refs?: UCPRefs): ModelAdvisoryEnvelope;
/**
 * Create a model evidence-basis envelope — the SYSTEM's factual record of what
 * evidence basis was actually available to the model for one durable challenge
 * (advisory position or scope refusal).
 *
 * source = "claude_delivery_gate"
 *
 * refs.parentId = the challenge envelope id (ucp.model_advisory.v1 or
 * ucp.claude_refused.v1) — the basis is a CHILD of the challenge it describes.
 * refs.rootId   = intent envelope ID (ucp.intent.v1)
 *
 * The basis payload is derived from the deterministic delivery contract only —
 * never from the model's response prose. See src/claude/evidence-basis.ts.
 *
 * Chain position: ucp.model_advisory.v1 → ucp.model_evidence_basis.v1
 *                 ucp.claude_refused.v1 → ucp.model_evidence_basis.v1
 */
export declare function createModelEvidenceBasisEnvelope(payload: ModelEvidenceBasisPayload, refs?: UCPRefs): ModelEvidenceBasisEnvelope;
/**
 * Create a model-position retirement envelope (P5 V1).
 *
 * source = "claude_delivery_gate"
 * refs.parentId = the retired ucp.model_advisory.v1 envelope id
 * refs.rootId   = intent envelope ID
 *
 * The advisory payload is never altered. Standing is derived from this child.
 */
export declare function createModelPositionRetirementEnvelope(payload: ModelPositionRetirementPayload, refs?: UCPRefs): ModelPositionRetirementEnvelope;
export declare function createExecutorReportEnvelope(payload: ExecutorReportPayload, refs?: UCPRefs): ExecutorReportEnvelope;
export declare function createOutcomeObservationEnvelope(payload: OutcomeObservationPayload, refs?: UCPRefs): OutcomeObservationEnvelope;
export declare function createOutcomeReconciliationEnvelope(payload: OutcomeReconciliationPayload, refs?: UCPRefs): OutcomeReconciliationEnvelope;
/**
 * Create a retired-position reassertion envelope (P5 V1).
 *
 * source = "claude_delivery_gate"
 * refs.parentId = the new (historical) advisory envelope id
 * refs.rootId   = intent envelope ID
 */
export declare function createRetiredPositionReassertionEnvelope(payload: RetiredPositionReassertionPayload, refs?: UCPRefs): RetiredPositionReassertionEnvelope;
/**
 * Create a reminder execution envelope from a finalized execution artifact.
 *
 * source = "reminder_executor" ? the reminder execution layer.
 * refs.parentId = response envelope ID (the intake decision that led to this).
 * refs.rootId   = intent envelope ID (the originating user intent).
 *
 * Both refs are optional in this slice ? they will be wired when the execution
 * layer is integrated into the full intake?present?execute pipeline.
 */
export declare function createReminderExecutionEnvelope(payload: ReminderExecutionPayload, refs?: UCPRefs): ReminderExecutionEnvelope;
/**
 * Create a workflow run envelope ? the terminal provenance record for one
 * complete workflow run. Persisted ONLY when the run reaches "completed" or
 * "stopped" (W5). Never written for in-progress runs.
 *
 * source = "workflow_coordinator"
 *
 * refs are optional because the workflow spans multiple sessions.
 * Individual session chains are recoverable through sessionRefs entries.
 */
export declare function createWorkflowRunEnvelope(payload: WorkflowRunPayload, refs?: UCPRefs): WorkflowRunEnvelope;
/**
 * Create a structured command envelope from a normalized CLI JsonOp shape.
 *
 * Shadow-only in this phase: for observability/parity, not live path ownership.
 */
export declare function createCommandEnvelope(payload: CommandPayload, refs?: UCPRefs): CommandEnvelope;
/**
 * Create a terminal execution-result envelope from workflow terminal state.
 *
 * Shadow-only in this phase: live CLI output still uses current path.
 */
export declare function createExecutionResultEnvelope(payload: ExecutionResultPayload, refs?: UCPRefs): ExecutionResultEnvelope;
//# sourceMappingURL=envelope.d.ts.map