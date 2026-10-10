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

import type {
  UCPEnvelope,
  UCPType,
  UCPRefs,
  UCPMeta,
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
  // Phase 3
  ArtifactPayload,
  ExecutionTracePayload,
  ReplayReportPayload,
  ArtifactEnvelope,
  ExecutionTraceEnvelope,
  ReplayReportEnvelope,
  // Phase 6
  ReminderExecutionPayload,
  ReminderExecutionEnvelope,
  // Phase 8 ? Cursor integration
  CursorHandoffPayload,
  CursorReceiptPayload,
  CursorRefusedPayload,
  CursorHandoffEnvelope,
  CursorReceiptEnvelope,
  CursorRefusedEnvelope,
  // Phase 8B ? Claude Managed Agents integration
  ClaudeHandoffPayload,
  ClaudeReceiptPayload,
  ClaudeRefusedPayload,
  ClaudeHandoffEnvelope,
  ClaudeReceiptEnvelope,
  ClaudeRefusedEnvelope,
  // P3 Phase 2 ? model advisory positions
  ModelAdvisoryPayload,
  ModelAdvisoryEnvelope,
  // P4 ? model evidence-basis provenance
  ModelEvidenceBasisPayload,
  ModelEvidenceBasisEnvelope,
  ModelPositionRetirementPayload,
  ModelPositionRetirementEnvelope,
  RetiredPositionReassertionPayload,
  RetiredPositionReassertionEnvelope,
  ExecutorReportPayload,
  ExecutorReportEnvelope,
  OutcomeObservationPayload,
  OutcomeObservationEnvelope,
  OutcomeReconciliationPayload,
  OutcomeReconciliationEnvelope,
  // Phase 9F ? Workflow run
  WorkflowRunPayload,
  WorkflowRunEnvelope,
  // Phase 12A ? structured CLI shadow envelopes
  CommandPayload,
  CommandEnvelope,
  ExecutionResultPayload,
  ExecutionResultEnvelope,
} from "./types.js";
import { hashObject } from "./hashes.js";

// ??? Core factory ??????????????????????????????????????????????????????????????

export function recomputeEnvelopeIdentity<T>(envelope: Pick<
  UCPEnvelope<T>,
  "id" | "type" | "version" | "payload" | "meta" | "refs"
>): { readonly id: string; readonly hash: string } {
  const idInput = envelope.refs !== undefined
    ? { payload: envelope.payload, refs: envelope.refs, type: envelope.type }
    : { payload: envelope.payload, type: envelope.type };
  const id = hashObject(idInput);
  const hashInput = envelope.refs !== undefined
    ? {
        id,
        meta: envelope.meta,
        payload: envelope.payload,
        refs: envelope.refs,
        type: envelope.type,
        version: envelope.version,
      }
    : {
        id,
        meta: envelope.meta,
        payload: envelope.payload,
        type: envelope.type,
        version: envelope.version,
      };
  return { id, hash: hashObject(hashInput) };
}

/**
 * Create a UCPEnvelope from its constituent parts.
 *
 * @param type    Dot-notation type string, e.g. "ucp.intent.v1".
 * @param payload The structured payload. Must map EXACTLY from the source type.
 * @param source  The module name that produced this envelope (e.g. "completion").
 * @param refs    Optional parent/root envelope references.
 */
export function createEnvelope<T>(
  type:    UCPType,
  payload: T,
  source:  string,
  refs?:   UCPRefs,
): UCPEnvelope<T> {
  const meta: UCPMeta = { source, deterministic: true };

  // id: content-addressed. Same type + payload + refs ? same id.
  // ts is intentionally excluded.
  const identity = recomputeEnvelopeIdentity({
    id: "",
    type,
    version: 1,
    payload,
    meta,
    ...(refs !== undefined ? { refs } : {}),
  });

  return {
    id: identity.id,
    type,
    version: 1,
    ts: Date.now(),
    payload,
    meta,
    ...(refs !== undefined ? { refs } : {}),
    hash: identity.hash,
  };
}

// ??? Typed factory helpers ????????????????????????????????????????????????????

export function createIntentEnvelope(
  payload: IntentPayload,
  refs?: UCPRefs,
): IntentEnvelope {
  return createEnvelope("ucp.intent.v1", payload, "intake", refs);
}

export function createPRVEnvelope(
  payload: PRVPayload,
  refs?: UCPRefs,
): PRVEnvelope {
  return createEnvelope("ucp.prv.v1", payload, "prv", refs);
}

export function createSafetyEnvelope(
  payload: SafetyPayload,
  refs?: UCPRefs,
): SafetyEnvelope {
  return createEnvelope("ucp.safety.v1", payload, "safety", refs);
}

export function createContextAlignmentEnvelope(
  payload: ContextAlignmentPayload,
  refs?: UCPRefs,
): ContextAlignmentEnvelope {
  return createEnvelope("ucp.context.v1", payload, "context", refs);
}

export function createDisambiguationEnvelope(
  payload: DisambiguationPayload,
  refs?: UCPRefs,
): DisambiguationEnvelope {
  return createEnvelope("ucp.disambiguation.v1", payload, "disambiguation", refs);
}

export function createCompletionEnvelope(
  payload: CompletionPayload,
  refs?: UCPRefs,
): CompletionEnvelope {
  return createEnvelope("ucp.completion.v1", payload, "completion", refs);
}

export function createIntentInterpretationEnvelope(
  payload: IntentInterpretationPayload,
  refs?: UCPRefs,
): IntentInterpretationEnvelope {
  return createEnvelope("ucp.intent_interpretation.v1", payload, "intent_interpretation", refs);
}

export function createChangeInterpretationEnvelope(
  payload: ChangeInterpretationPayload,
  refs?: UCPRefs,
): ChangeInterpretationEnvelope {
  return createEnvelope("ucp.change_interpretation.v1", payload, "change_interpretation", refs);
}

export function createResponseEnvelope(
  payload: ResponsePayload,
  refs?: UCPRefs,
): ResponseEnvelope {
  return createEnvelope("ucp.response.v1", payload, "response_planner", refs);
}

export function createInteractionContractEnvelope(
  payload: InteractionContractPayload,
  refs?: UCPRefs,
): InteractionContractEnvelope {
  return createEnvelope("ucp.interaction_contract.v1", payload, "interaction", refs);
}

export function createInteractionEventEnvelope(
  payload: InteractionEventPayload,
  refs?: UCPRefs,
): InteractionEventEnvelope {
  return createEnvelope("ucp.interaction_event.v1", payload, "interaction", refs);
}

export function createDebugTraceEnvelope(
  payload: DebugTracePayload,
  refs?: UCPRefs,
): DebugTraceEnvelope {
  return createEnvelope("ucp.debug_trace.v1", payload, "intake", refs);
}

// ??? Phase 3: post-execution envelope factories ???????????????????????????????

/**
 * Create an artifact envelope from a finalized run record.
 *
 * source = "artifact_finalizer" ? the component that calls finalizeArtifact().
 * refs.rootId = intentId (ucp.intent.v1 ID) when available ? closes the provenance chain.
 * refs.parentId = response envelope ID when available.
 */
export function createArtifactEnvelope(
  payload: ArtifactPayload,
  refs?: UCPRefs,
): ArtifactEnvelope {
  return createEnvelope("ucp.artifact.v1", payload, "artifact_finalizer", refs);
}

/**
 * Create an execution trace envelope ? the sealed batch record of a run's timeline.
 *
 * source = "artifact_finalizer" ? emitted at the same point as the artifact envelope.
 * refs.parentId = artifact envelope ID (immediate causal predecessor).
 * refs.rootId   = intentId (propagated from artifact envelope).
 */
export function createExecutionTraceEnvelope(
  payload: ExecutionTracePayload,
  refs?: UCPRefs,
): ExecutionTraceEnvelope {
  return createEnvelope("ucp.execution_trace.v1", payload, "artifact_finalizer", refs);
}

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
export function createReplayReportEnvelope(
  payload: ReplayReportPayload,
  refs?: UCPRefs,
): ReplayReportEnvelope {
  return createEnvelope("ucp.replay_report.v1", payload, "replay_engine", refs);
}

// ??? Phase 8: Cursor integration envelope factories ??????????????????????????

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
export function createCursorHandoffEnvelope(
  payload: CursorHandoffPayload,
  refs?:   UCPRefs,
): CursorHandoffEnvelope {
  return createEnvelope("ucp.cursor_handoff.v1", payload, "cursor_delivery_gate", refs);
}

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
export function createCursorReceiptEnvelope(
  payload: CursorReceiptPayload,
  refs?:   UCPRefs,
): CursorReceiptEnvelope {
  return createEnvelope("ucp.cursor_receipt.v1", payload, "cursor_delivery_gate", refs);
}

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
export function createCursorRefusedEnvelope(
  payload: CursorRefusedPayload,
  refs?:   UCPRefs,
): CursorRefusedEnvelope {
  return createEnvelope("ucp.cursor_refused.v1", payload, "cursor_delivery_gate", refs);
}

// ??? Phase 8B: Claude Managed Agents envelope factories ??????????????????????

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
export function createClaudeHandoffEnvelope(
  payload: ClaudeHandoffPayload,
  refs?:   UCPRefs,
): ClaudeHandoffEnvelope {
  return createEnvelope("ucp.claude_handoff.v1", payload, "claude_delivery_gate", refs);
}

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
export function createClaudeReceiptEnvelope(
  payload: ClaudeReceiptPayload,
  refs?:   UCPRefs,
): ClaudeReceiptEnvelope {
  return createEnvelope("ucp.claude_receipt.v1", payload, "claude_delivery_gate", refs);
}

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
export function createClaudeRefusedEnvelope(
  payload: ClaudeRefusedPayload,
  refs?:   UCPRefs,
): ClaudeRefusedEnvelope {
  return createEnvelope("ucp.claude_refused.v1", payload, "claude_delivery_gate", refs);
}

// ??? P3 Phase 2: model advisory envelope factory ????????????????????????????

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
export function createModelAdvisoryEnvelope(
  payload: ModelAdvisoryPayload,
  refs?:   UCPRefs,
): ModelAdvisoryEnvelope {
  return createEnvelope("ucp.model_advisory.v1", payload, "claude_delivery_gate", refs);
}

// ─── P4: model evidence-basis envelope factory ───────────────────────────────

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
export function createModelEvidenceBasisEnvelope(
  payload: ModelEvidenceBasisPayload,
  refs?:   UCPRefs,
): ModelEvidenceBasisEnvelope {
  return createEnvelope("ucp.model_evidence_basis.v1", payload, "claude_delivery_gate", refs);
}

/**
 * Create a model-position retirement envelope (P5 V1).
 *
 * source = "claude_delivery_gate"
 * refs.parentId = the retired ucp.model_advisory.v1 envelope id
 * refs.rootId   = intent envelope ID
 *
 * The advisory payload is never altered. Standing is derived from this child.
 */
export function createModelPositionRetirementEnvelope(
  payload: ModelPositionRetirementPayload,
  refs?:   UCPRefs,
): ModelPositionRetirementEnvelope {
  return createEnvelope("ucp.model_position_retirement.v1", payload, "claude_delivery_gate", refs);
}

export function createExecutorReportEnvelope(
  payload: ExecutorReportPayload,
  refs?: UCPRefs,
): ExecutorReportEnvelope {
  return createEnvelope("ucp.executor_report.v1", payload, "workflow_coordinator", refs);
}

export function createOutcomeObservationEnvelope(
  payload: OutcomeObservationPayload,
  refs?: UCPRefs,
): OutcomeObservationEnvelope {
  return createEnvelope("ucp.outcome_observation.v1", payload, "workflow_coordinator", refs);
}

export function createOutcomeReconciliationEnvelope(
  payload: OutcomeReconciliationPayload,
  refs?: UCPRefs,
): OutcomeReconciliationEnvelope {
  return createEnvelope("ucp.outcome_reconciliation.v1", payload, "workflow_coordinator", refs);
}

/**
 * Create a retired-position reassertion envelope (P5 V1).
 *
 * source = "claude_delivery_gate"
 * refs.parentId = the new (historical) advisory envelope id
 * refs.rootId   = intent envelope ID
 */
export function createRetiredPositionReassertionEnvelope(
  payload: RetiredPositionReassertionPayload,
  refs?:   UCPRefs,
): RetiredPositionReassertionEnvelope {
  return createEnvelope(
    "ucp.retired_position_reassertion.v1",
    payload,
    "claude_delivery_gate",
    refs,
  );
}

// ??? Phase 6: reminder execution envelope factory ????????????????????????????

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
export function createReminderExecutionEnvelope(
  payload: ReminderExecutionPayload,
  refs?: UCPRefs,
): ReminderExecutionEnvelope {
  return createEnvelope("ucp.reminder_execution.v1", payload, "reminder_executor", refs);
}

// ??? Phase 9F: workflow run envelope factory ??????????????????????????????????

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
export function createWorkflowRunEnvelope(
  payload: WorkflowRunPayload,
  refs?: UCPRefs,
): WorkflowRunEnvelope {
  return createEnvelope("ucp.workflow_run.v1", payload, "workflow_coordinator", refs);
}

/**
 * Create a structured command envelope from a normalized CLI JsonOp shape.
 *
 * Shadow-only in this phase: for observability/parity, not live path ownership.
 */
export function createCommandEnvelope(
  payload: CommandPayload,
  refs?: UCPRefs,
): CommandEnvelope {
  return createEnvelope("ucp.command.v1", payload, "cli_adapter", refs);
}

/**
 * Create a terminal execution-result envelope from workflow terminal state.
 *
 * Shadow-only in this phase: live CLI output still uses current path.
 */
export function createExecutionResultEnvelope(
  payload: ExecutionResultPayload,
  refs?: UCPRefs,
): ExecutionResultEnvelope {
  return createEnvelope("ucp.execution_result.v1", payload, "workflow_coordinator", refs);
}

