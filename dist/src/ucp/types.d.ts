/**
 * UCP — UseSteady Control Protocol types.
 *
 * OWNERSHIP RULE: Every decision that flows through UseSteady is representable
 * as a UCPEnvelope. Envelopes are versioned, content-addressed, and hashable.
 *
 * UCPEnvelope is the canonical representation — NOT a transport wrapper.
 * The pipeline is authoritative. Envelopes are a parallel, read-only view.
 *
 * ── Envelope fields ────────────────────────────────────────────────────────
 *
 *   id      Content-addressed identifier: sha256({ type, payload, refs }).
 *           Same content → same id. Does NOT change with ts.
 *
 *   type    Dot-notation namespaced string: "ucp.intent.v1", "ucp.prv.v1", etc.
 *
 *   version Always 1 in this phase.
 *
 *   ts      Epoch milliseconds. Excluded from id and hash.
 *           Records when the envelope was created; does not affect identity.
 *
 *   payload The structured result of the relevant pipeline step.
 *           Contains ONLY fields present in the source type — no invention.
 *
 *   meta    Envelope metadata. source = the module that produced this envelope.
 *           deterministic is always true in v1 (no random-valued payloads).
 *
 *   refs    Optional parent/root references for trace chain linkage.
 *
 *   hash    Integrity hash: sha256 over { id, meta, payload, refs, type, version }.
 *           Excludes ts and hash itself.
 *
 * ── PROTOCOL INVARIANT: Payloads must be undefined-free ──────────────────
 *
 *   stableStringify (used by computeId) serializes `undefined` as the string
 *   "undefined" — it does NOT omit keys with undefined values the way
 *   JSON.stringify does. This means:
 *
 *     { rejection_reason: undefined }  →  id contains "rejection_reason":"undefined"
 *     { }                              →  id does NOT contain "rejection_reason"
 *
 *   These produce DIFFERENT content addresses for otherwise-identical payloads.
 *   If the envelope is then persisted via JSON.stringify (which strips undefined
 *   keys), the stored record diverges from the id used to index it — breaking
 *   the content-addressing guarantee.
 *
 *   CONSTRUCTION RULE (enforced by convention, checked in mappers):
 *     ✓ Omit optional fields entirely when they are absent.
 *     ✓ Use conditional spreading: ...(value !== undefined ? { key: value } : {})
 *     ✗ Never assign explicit `undefined` to a payload field.
 *     ✗ Never use Object.assign or spread with an object containing undefined values.
 *
 *   All mappers in src/ucp/mappers/ must follow this rule.
 *   Callers constructing payloads inline must follow this rule.
 */
import type { SafetyReason } from "../safety/types.js";
import type { IntentInterpretationCategory } from "../understand/intent-interpretation/types.js";
import type { InterpretationCategory } from "../understand/interpretation/types.js";
import type { IntentState, ResponseMode } from "../intake/types.js";
import type { ObservedIntentPatterns } from "../interaction/types.js";
import type { EvidenceSourceBasis, EvidenceContradictionStatus, ModelComprehensionStatus, SystemStructuralDerivationV1 } from "../evidence-basis/types.js";
export type UCPType = "ucp.intent.v1" | "ucp.prv.v1" | "ucp.safety.v1" | "ucp.context.v1" | "ucp.disambiguation.v1" | "ucp.completion.v1" | "ucp.intent_interpretation.v1" | "ucp.change_interpretation.v1" | "ucp.response.v1" | "ucp.interaction_contract.v1" | "ucp.interaction_event.v1" | "ucp.debug_trace.v1" | "ucp.artifact.v1" | "ucp.execution_trace.v1" | "ucp.replay_report.v1" | "ucp.reminder_execution.v1" | "ucp.cursor_handoff.v1" | "ucp.cursor_receipt.v1" | "ucp.cursor_refused.v1" | "ucp.claude_handoff.v1" | "ucp.claude_receipt.v1" | "ucp.claude_refused.v1" | "ucp.model_advisory.v1" | "ucp.model_evidence_basis.v1" | "ucp.model_position_retirement.v1" | "ucp.retired_position_reassertion.v1" | "ucp.executor_report.v1" | "ucp.outcome_observation.v1" | "ucp.outcome_reconciliation.v1" | "ucp.command.v1" | "ucp.execution_result.v1" | "ucp.workflow_run.v1";
/**
 * @deprecated Use UCPType. UCPKind is kept for backward compatibility only.
 */
export type UCPKind = UCPType;
export type UCPMeta = {
    readonly source: string;
    readonly deterministic: true;
};
export type UCPRefs = {
    readonly parentId?: string;
    readonly rootId?: string;
};
export type UCPEnvelope<TPayload = unknown> = {
    /**
     * Content-addressed identity: sha256({ type, payload, refs }).
     *
     * Excludes: ts, meta, version, hash.
     * Same content (type + payload + refs) → same id, regardless of wall-clock time
     * or which module emitted the envelope.
     *
     * Use id for: provenance chain links (parentId, rootId), deduplication,
     * content-addressed lookups, and replay verification.
     */
    readonly id: string;
    /** Dot-notation type identifier, e.g. "ucp.intent.v1". */
    readonly type: UCPType;
    readonly version: 1;
    /**
     * Creation timestamp (epoch ms).
     * Excluded from both id and hash — ts records when, not what.
     */
    readonly ts: number;
    readonly payload: TPayload;
    readonly meta: UCPMeta;
    readonly refs?: UCPRefs;
    /**
     * Integrity checksum: sha256({ id, meta, payload, refs, type, version }).
     *
     * Excludes: ts, hash itself.
     * Includes meta.source — so two envelopes from different modules with identical
     * content will have the same id but different hash values.
     *
     * Use hash for: tamper detection of a specific persisted envelope record.
     * Do NOT use hash for identity comparisons — use id.
     *
     * id ≠ hash: they are not redundant.
     *   id   = "what was decided" (content identity, source-agnostic)
     *   hash = "does this record match what was produced" (integrity, source-aware)
     */
    readonly hash: string;
};
/**
 * IntentPayload — the raw user input before any processing.
 * Source: the raw input string passed to runIntake().
 */
export type IntentPayload = {
    readonly input: string;
};
/**
 * PRVPayload — maps exactly from PRVResult (src/prv/types.ts).
 */
export type PRVPayload = {
    readonly ok: boolean;
    readonly mode?: "clarify";
    readonly reason?: string;
};
/**
 * SafetyPayload — maps exactly from SafetyResult (src/safety/types.ts).
 * Includes inspection fields detectorId and matchedPattern when available.
 */
export type SafetyPayload = {
    readonly verdict: "allow" | "block";
    readonly reason?: SafetyReason;
    readonly detectorId?: string;
    readonly matchedPattern?: string;
    readonly note?: string;
};
/**
 * ContextAlignmentPayload — maps from ContextAlignmentResult (src/understand/context/types.ts).
 */
export type ContextAlignmentPayload = {
    readonly kind: "aligned" | "non_literal" | "hard_mismatch";
    readonly reason?: string;
};
/**
 * DisambiguationPayload — maps from DisambiguationResult (src/understand/disambiguation/types.ts).
 */
export type DisambiguationPayload = {
    readonly kind: "clear" | "ambiguous" | "unknown";
    readonly normalized?: string;
    readonly reason?: string;
    readonly options?: readonly string[];
};
/**
 * CompletionPayload — maps from CompletionResult (src/understand/completion/types.ts).
 * Includes all three kinds: complete, incomplete, guided_recovery.
 */
export type CompletionPayload = {
    readonly kind: "complete" | "incomplete" | "guided_recovery";
    readonly reason?: string;
    readonly missing?: readonly string[];
    readonly nextSteps?: ReadonlyArray<{
        readonly type: "read_first" | "use_exact_format" | "add_missing_field";
        readonly label: string;
    }>;
};
/**
 * IntentInterpretationPayload — maps from IntentInterpretation
 * (src/understand/intent-interpretation/types.ts).
 * Present only when the Intent Interpretation Bridge fired (bridgeFired === true).
 */
export type IntentInterpretationPayload = {
    readonly category: IntentInterpretationCategory;
    readonly summary: string;
    readonly confidence: "high" | "medium" | "low";
    readonly basis: readonly string[];
};
/**
 * ChangeInterpretationPayload — maps from InterpretationResult
 * (src/understand/interpretation/types.ts).
 * Present only when mode === "execute" AND the input matched a structured
 * change pattern.
 */
export type ChangeInterpretationPayload = {
    readonly summary: string;
    readonly impact: readonly string[];
    readonly confidence: "high" | "medium" | "low";
    readonly category: InterpretationCategory;
};
/**
 * ResponsePayload — maps from IntakeResult (src/intake/types.ts).
 * The final decision: mode, reason, intent state, and — when present — the
 * ENRICHED guidance (post-enrichGuidance + post-applyGuidanceOrdering).
 *
 * guidance captures the authoritative final form seen by the renderer, not the
 * raw CompletionResult (which lives in CompletionPayload). This distinction is
 * critical: the completion envelope is the intermediate step output; the response
 * envelope is the final user-facing decision including any session adaptations.
 */
export type ResponsePayload = {
    readonly mode: ResponseMode;
    readonly reason: string;
    readonly intentState: IntentState;
    /** Enriched, ordering-applied guidance. Only present when mode === "guide". */
    readonly guidance?: {
        readonly missing: ReadonlyArray<string>;
        readonly nextSteps: ReadonlyArray<{
            readonly type: string;
            readonly label: string;
        }>;
    };
};
/**
 * InteractionContractPayload — maps from InteractionContract (src/interaction/types.ts).
 */
export type InteractionContractPayload = {
    readonly subjectId: string;
    readonly ambiguityMode: "conservative" | "balanced" | "fast";
    readonly explanationMode: "plain_first" | "technical_first" | "mixed";
    readonly unsupportedGuidanceMode: "syntax_first" | "examples_first" | "stepwise";
    readonly observedIntentPatterns: ObservedIntentPatterns;
};
/**
 * InteractionEventPayload — maps from InteractionEvent (src/interaction/types.ts).
 */
export type InteractionEventPayload = {
    readonly type: "misinterpretation_corrected" | "unsupported_recovered" | "color_intent_observed" | "text_intent_observed" | "config_intent_observed";
    readonly recoveryStyle?: "syntax_hint" | "example_used" | "stepwise_followed";
};
/**
 * DebugTracePayload — maps exactly from DebugTrace (src/intake/trace.ts).
 * Zero-authority: recorded for observability only.
 */
export type DebugTracePayload = {
    readonly prvPassed: boolean;
    readonly safetyVerdict: "allow" | "block" | "not_reached";
    readonly contextKind: "aligned" | "non_literal" | "hard_mismatch" | "not_reached";
    readonly disambigKind: "clear" | "ambiguous" | "unknown" | "not_reached";
    readonly completionKind: "complete" | "incomplete" | "guided_recovery" | "not_reached";
    readonly bridgeFired: boolean;
};
/**
 * ArtifactPayload — maps from any FinalizedArtifact-compatible type via ArtifactLike.
 *
 * Lightweight identity record. Does NOT copy nodes[], trace[], lineage, or
 * explainSummary. Full artifact data lives in the artifact file.
 *
 * CONTRACT: artifact.checksum is copied as-is — NEVER recomputed here.
 * UCP wraps the existing artifact checksum; it does not replace or compete with it.
 */
export type ArtifactPayload = {
    /** FinalizedArtifact.runId */
    readonly runId: string;
    /** FinalizedArtifact.goal */
    readonly goal: string;
    /** FinalizedArtifact.status */
    readonly status: "COMPLETED" | "FAILED" | "DENIED";
    /** FinalizedArtifact.checksum — the existing immutable artifact SHA-256. NOT recomputed. */
    readonly checksum: string;
    /** FinalizedArtifact.graph.checksum — the compiled graph SHA-256 */
    readonly graphChecksum: string;
    /** FinalizedArtifact.nodes.length — total node count, not the full node list */
    readonly nodeCount: number;
    /** FinalizedArtifact.startedAtMs */
    readonly startedAtMs: number;
    /** FinalizedArtifact.completedAtMs */
    readonly completedAtMs: number;
};
/**
 * ExecutionTracePayload — maps from FinalizedArtifact.trace[] (batch envelope).
 *
 * Seals the full execution timeline for one run as a lightweight identity record.
 * Individual trace entries are not copied — they are represented by traceHash.
 *
 * traceHash specification (5 locked rules):
 *   1. Ordering:   recorded/append order — same as artifact.trace[] array order
 *   2. Included:   ALL TraceEntry fields (kind, runId, nodeId, timestampMs, payload)
 *   3. Excluded:   none — no derived summaries or presentation fields added/removed
 *   4. Timestamps: timestampMs IS included — two runs at different times produce
 *                  different traceHash values (correct: each trace is a specific execution)
 *   5. Serialization: stableStringify() — sorted keys at all nesting levels, same algorithm
 *                     as FinalizedArtifact.checksum computation
 *
 * Consequence: traceHash is unique per run. That is correct and expected.
 */
export type ExecutionTracePayload = {
    /** FinalizedArtifact.runId (same as artifact envelope) */
    readonly runId: string;
    /** FinalizedArtifact.trace.length — total entry count */
    readonly entryCount: number;
    /** Ordered TraceEntryKind strings in recorded sequence */
    readonly kinds: ReadonlyArray<string>;
    /** SHA-256 of stableStringify(artifact.trace) — per locked spec above */
    readonly traceHash: string;
};
/**
 * ReplayReportPayload — maps from any ReplayReport-compatible type via ReplayReportLike.
 *
 * A mirror of the replay verification outcome, not an interpretation of it.
 * The mapper derives count fields from nodeResults but adds no new conclusions.
 *
 * ── Node-level verdict states (3, exhaustive) ─────────────────────────────────
 *   "VERIFIED"  node re-executed and output matched
 *   "DRIFTED"   node re-executed and output differed (environment changed)
 *   "SKIPPED"   node skipped (write-only commands: fs.apply_patch, git.commit, etc.)
 *
 * ── Run-level verdict states (4, derived from node results) ───────────────────
 *   "VERIFIED"  checksumValid AND at least one VERIFIED, none DRIFTED
 *   "DRIFTED"   checksumValid AND at least one DRIFTED
 *   "PARTIAL"   checksumValid AND all nodes SKIPPED (allSkipped)
 *   "CORRUPTED" checksumValid === false → short-circuits before drift detection
 *               nodeResults is [] (empty) — all counts are 0
 *
 * ── CORRUPTED behavior ────────────────────────────────────────────────────────
 *   When verdict === "CORRUPTED":
 *     nodeCount    = 0
 *     verifiedCount = 0
 *     driftedCount  = 0
 *     skippedCount  = 0
 *   This is not partial — it is an invalid baseline (artifact tampered with).
 *
 * ── Exhaustiveness invariant ──────────────────────────────────────────────────
 *   For all non-CORRUPTED reports:
 *     verifiedCount + driftedCount + skippedCount === nodeCount
 *
 * ── What this payload does NOT contain ────────────────────────────────────────
 *   No per-node driftField / driftExpected / driftActual details.
 *   Those live in the native ReplayReport.nodeResults[].
 *   The envelope carries the summary signal only.
 */
export type ReplayReportPayload = {
    /** ReplayReport.runId */
    readonly runId: string;
    /** ReplayReport.verdict — run-level outcome */
    readonly verdict: "VERIFIED" | "DRIFTED" | "CORRUPTED" | "PARTIAL";
    /** ReplayReport.checksumValid — false when artifact was tampered with */
    readonly checksumValid: boolean;
    /** ReplayReport.artifactChecksum — the artifact hash that was verified */
    readonly artifactChecksum: string;
    /** ReplayReport.nodeResults.length — always 0 when verdict === "CORRUPTED" */
    readonly nodeCount: number;
    /** Count of nodes with verdict "VERIFIED". 0 when CORRUPTED (nodeResults is []). */
    readonly verifiedCount: number;
    /** Count of nodes with verdict "DRIFTED". 0 when CORRUPTED. */
    readonly driftedCount: number;
    /** Count of nodes with verdict "SKIPPED". Equals nodeCount when verdict === "PARTIAL". */
    readonly skippedCount: number;
    /** ReplayReport.replayedAtMs */
    readonly replayedAtMs: number;
};
/**
 * ReminderExecutionPayload — maps from ReminderExecutionArtifact
 * (src/execution/reminders/reminder-execution-types.ts).
 *
 * ── Field selection rationale ─────────────────────────────────────────────────
 *
 *   subject           — the validated reminder task
 *   time_text         — the original time phrase (mapper faithfulness)
 *   parsed_time_kind  — the structural parse result kind ONLY, not the full
 *                       ParsedTime struct. The envelope records the classification
 *                       outcome (was time parseable, and of what shape?), not a
 *                       full scheduler-ready temporal model. Full ParsedTime lives
 *                       in the artifact for downstream integrations.
 *   recurrence_text   — recurrence phrase or null
 *   source_confidence — from the presentation; part of why accepted/rejected
 *   verdict           — accepted or rejected
 *   rejection_reason  — present when rejected; includes ParsedTime.reason detail
 *                       for time_unresolvable cases
 *
 * ── What this payload does NOT contain ────────────────────────────────────────
 *
 *   No full ParsedTime object (hour/minute/period/offset_minutes).
 *   Those fields live in the artifact file for schedulers that need them.
 *   The envelope carries the summary signal: was it accepted, and what shape?
 */
export type ReminderExecutionPayload = {
    readonly subject: string;
    readonly time_text: string;
    /** ParsedTime.kind — structural classification of the time phrase. */
    readonly parsed_time_kind: "time_of_day" | "relative_offset" | "day_with_time" | "unresolvable";
    readonly recurrence_text: string | null;
    readonly source_confidence: "explicit" | "partial" | "ambiguous";
    readonly verdict: "accepted" | "rejected";
    readonly rejection_reason?: string;
};
/**
 * CursorHandoffPayload — persisted by the delivery gate BEFORE the artifact
 * is passed to Cursor. This is the hard persistence gate: if it fails, delivery
 * is blocked.
 *
 * CONSTRUCTION RULE: undefined-free payloads (see protocol invariant above).
 * All optional fields must be omitted entirely when absent.
 *
 * ── Chain position ─────────────────────────────────────────────────────────────
 *
 *   ucp.intent.v1 → ucp.response.v1 → ucp.cursor_handoff.v1
 *     → ucp.cursor_receipt.v1 → [ucp.cursor_artifact.v1 — reserved future slot]
 *       → ucp.execution_trace.v1 → ucp.replay_report.v1
 *
 * ── Field selection rationale ──────────────────────────────────────────────────
 *
 *   eligibility       — always "approved_for_cursor"; delivery gate enforces this
 *   ocdStatus         — "cleared" or "conflict_accepted"; never "conflict_detected"
 *   rulesFired        — audit: which OCD rules were evaluated
 *   changeCategory    — what kind of edit Cursor was handed
 *   scopeAllowedFiles — snapshot of the approved file set at delivery time
 *   confirmedByHuman  — invariant: always true; H must have confirmed
 *   confirmedAt       — epoch ms of H's confirmation
 */
export type CursorHandoffPayload = {
    readonly intentId: string;
    readonly responseId: string;
    readonly eligibility: "approved_for_cursor";
    readonly ocdStatus: "cleared" | "conflict_accepted";
    readonly rulesFired: readonly string[];
    readonly changeCategory: string;
    readonly scopeAllowedFiles: readonly string[];
    readonly confirmedByHuman: true;
    readonly confirmedAt: number;
};
/**
 * CursorReceiptPayload — persisted by the delivery gate AFTER Cursor responds
 * with kind: "accepted". Records that Cursor took ownership.
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 *
 * refs.parentId = ucp.cursor_handoff.v1 id.
 */
export type CursorReceiptPayload = {
    readonly deliveryId: string;
    readonly handoffId: string;
    readonly artifactId: string;
    readonly receivedAt: number;
};
/**
 * CursorRefusedPayload — persisted by the delivery gate when Cursor responds
 * with kind: "refused_due_to_scope" or "refused_due_to_execution_error".
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 * Scope-specific fields (scopeQuestionKind, scopeCandidates, scopeSearchedFor)
 * are present only when refusalKind === "refused_due_to_scope".
 * errorCode is present only when refusalKind === "refused_due_to_execution_error".
 *
 * refs.parentId = ucp.cursor_handoff.v1 id.
 */
export type CursorRefusedPayload = {
    readonly deliveryId: string;
    readonly handoffId: string;
    readonly artifactId: string;
    readonly receivedAt: number;
    readonly refusalKind: "refused_due_to_scope" | "refused_due_to_execution_error";
    readonly scopeQuestionKind?: "need_file_path" | "need_scope_selection" | "ambiguous_old_value";
    readonly scopeCandidates?: readonly string[];
    readonly scopeSearchedFor?: string;
    readonly errorCode?: string;
};
/**
 * ClaudeHandoffPayload — persisted by the delivery gate BEFORE the artifact
 * is passed to Claude Managed Agents. This is the hard persistence gate.
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 *
 * ── Chain position ────────────────────────────────────────────────────────────
 *
 *   ucp.intent.v1 → ucp.response.v1 → ucp.claude_handoff.v1
 *     → ucp.claude_receipt.v1 → [ucp.claude_result.v1 — reserved future slot]
 *
 *   confirmedByHuman — invariant: always true; H must have confirmed
 *   confirmedAt      — epoch ms of H's confirmation
 */
export type ClaudeHandoffPayload = {
    readonly intentId: string;
    readonly responseId: string;
    readonly eligibility: "approved_for_agent";
    readonly ocdClearance: "clear" | "conflict_accepted";
    readonly executionDomain: string;
    readonly allowedFiles: readonly string[];
    readonly allowedTools: readonly string[];
    readonly confirmedByHuman: true;
    readonly confirmedAt: number;
};
/**
 * ClaudeReceiptPayload — persisted by the delivery gate AFTER Claude responds
 * with kind: "accepted". Records that Claude started a managed session.
 *
 * sessionId — the Anthropic managed agent session ID.
 *             NOT resumable in V1 (A3). If interrupted, maps to execution error.
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 * refs.parentId = ucp.claude_handoff.v1 id.
 */
export type ClaudeReceiptPayload = {
    readonly deliveryId: string;
    readonly handoffId: string;
    readonly artifactId: string;
    readonly sessionId: string;
    readonly receivedAt: number;
    /**
     * OPTIONAL (P3 Phase 1) — verbatim text content the model emitted alongside
     * its acceptance. Evidence preservation only: never classified, never
     * interpreted as a disposition signal. Omitted entirely when the model
     * emitted no text (undefined-free payload rule).
     */
    readonly modelText?: string;
};
/**
 * ClaudeRefusedPayload — persisted by the delivery gate when Claude responds
 * with kind: "refused_due_to_scope" or "refused_due_to_execution_error".
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 * Scope-specific fields are present only when refusalKind === "refused_due_to_scope".
 * errorCode is present only when refusalKind === "refused_due_to_execution_error".
 *
 * refs.parentId = ucp.claude_handoff.v1 id.
 */
export type ClaudeRefusedPayload = {
    readonly deliveryId: string;
    readonly handoffId: string;
    readonly artifactId: string;
    readonly receivedAt: number;
    readonly refusalKind: "refused_due_to_scope" | "refused_due_to_execution_error";
    readonly scopeQuestionKind?: "need_file_path" | "need_scope_selection" | "need_tool_permission" | "ambiguous_old_value";
    readonly scopeCandidates?: readonly string[];
    readonly errorCode?: string;
    /**
     * OPTIONAL (P3 Phase 1) — the model-authored explanation from the scope
     * clarification request, verbatim. This is the same string the session/shell
     * surfaces render to the human when offering candidates, so the persisted
     * record supports exact persisted-position ↔ presented-content
     * correspondence. Present only when refusalKind === "refused_due_to_scope".
     */
    readonly scopeExplanation?: string;
    /**
     * OPTIONAL (P3 Phase 1) — the human-readable message carried on the
     * execution-error refusal, verbatim. Present only when
     * refusalKind === "refused_due_to_execution_error".
     */
    readonly errorMessage?: string;
    /**
     * OPTIONAL (P3 Phase 1) — who authored errorMessage:
     *   "model"   — text actually emitted by the model
     *   "adapter" — text synthesized deterministically by the adapter, gate, or
     *               consensus layer (never model judgment)
     * Absent only for legacy producers that predate the marker.
     */
    readonly messageOrigin?: "model" | "adapter";
};
/**
 * ModelAdvisoryPayload — persisted by the delivery gate when Claude responds
 * with kind: "advisory" (P3 Phase 2). One envelope per advisory position.
 *
 * The exact model-authored position survives here as durable evidence. The
 * record is never altered by a later human supersession decision — the
 * supersession relation lives on the Portal-signed authority assertion and on
 * the workflow task record; both facts survive independently.
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 * refs.parentId = ucp.claude_handoff.v1 id.
 *
 *   modelPositionId — hashObject over the canonical advisory event
 *                     ({ artifactId, explanation, kind, model, runtime });
 *                     identical to the value embedded in this payload and to
 *                     the model_position_id surfaced to approval surfaces.
 *   receivedAt      — epoch ms of the delivery attempt (gate clock).
 */
export type ModelAdvisoryPayload = {
    readonly deliveryId: string;
    readonly handoffId: string;
    readonly artifactId: string;
    readonly modelPositionId: string;
    readonly positionKind: "warning" | "recommend_against" | "uncertainty" | "alternative";
    readonly explanation: string;
    readonly runtime: string;
    readonly model: string;
    readonly receivedAt: number;
};
/**
 * ModelEvidenceBasisPayload — persisted by the delivery gate alongside a
 * durable model challenge (P4). One envelope per challenge record.
 *
 * This is the SYSTEM's factual record of what evidence basis was actually
 * available to the model for the linked challenge — derived from the
 * deterministic execution path, NEVER from the model's prose. A model saying
 * "I inspected the file" does not change this record.
 *
 * The record is independent of the model's words: it is linked to the
 * challenge envelope via refs.parentId, not embedded in it, so the P3
 * advisory payload remains byte-stable and old records remain readable.
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 * refs.parentId = the challenge envelope id (ucp.model_advisory.v1 or
 * ucp.claude_refused.v1). refs.rootId = the intent id.
 *
 *   subjectKind — which challenge surface this basis belongs to.
 *   subjectId   — the natural join key of the challenge:
 *                 modelPositionId for "model_advisory";
 *                 the refused envelope id for "scope_refusal".
 *   evidenceBackedContradiction / comprehension — literal-only
 *                 "not_established" (compile-time enforced; see
 *                 src/evidence-basis/types.ts). Hash disagreement, API
 *                 success, and model prose NEVER upgrade these.
 */
export type ModelEvidenceBasisPayload = {
    readonly subjectKind: "model_advisory" | "scope_refusal";
    readonly subjectId: string;
    readonly deliveryId: string;
    readonly artifactId: string;
    readonly derivation: SystemStructuralDerivationV1;
    readonly sources: readonly EvidenceSourceBasis[];
    readonly evidenceBackedContradiction: EvidenceContradictionStatus;
    readonly comprehension: ModelComprehensionStatus;
    readonly derivedAt: number;
};
/**
 * ModelPositionRetirementPayload — append-only retirement relation (P5 V1).
 *
 * O --retired_by_evidence--> R. The original ucp.model_advisory.v1 is never
 * rewritten. Standing is derived from the presence of a valid R.
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 * refs.parentId = the retired ucp.model_advisory.v1 envelope id.
 * refs.rootId   = the intent id.
 *
 *   decisionRelation is the literal "retire_model_position" — never
 *   proceed_despite_model_position (that relation lives on P3 supersession).
 *   resolvingEvidenceIds must be non-empty (validated before persist).
 *   groundsId is the mechanical action-ground digest, or the literal "unknown".
 */
export type ModelPositionRetirementPayload = {
    readonly modelPositionId: string;
    readonly positionHash: string;
    readonly resolvingEvidenceIds: readonly string[];
    readonly mappedEvidence?: {
        readonly contract: "retirement_basis_relation.v1";
        readonly evidenceBasisId: string;
        readonly evidenceBasisHash: string;
    };
    readonly groundsId: string;
    readonly artifactId: string;
    readonly decisionRelation: "retire_model_position";
    readonly decidedAt: number;
    readonly authorityEvidenceStatus: "portal_signed_verified" | "self_asserted";
    readonly workflowRunId?: string;
    readonly stepIndex?: number;
    readonly authorityDecisionId?: string;
};
/**
 * RetiredPositionReassertionPayload — the model re-emitted a retired
 * objection (same identity / same grounds / unknown grounds). Persisted as
 * evidence. Does not restore standing and does not park the task.
 *
 * refs.parentId = the new advisory envelope (history of the reassertion).
 * refs.rootId   = the intent id.
 */
export type RetiredPositionReassertionPayload = {
    readonly modelPositionId: string;
    readonly positionHash: string;
    readonly retirementEnvelopeId: string;
    readonly groundsRelation: "same" | "unknown" | "no_new_ground";
    readonly receivedAt: number;
};
/**
 * ExecutorReportPayload — P6 V1 delivery/execution self-report (X).
 * Never a verified-outcome claim.
 */
export type ExecutorReportPayload = {
    readonly kind: "accepted" | "failed";
    readonly operationType: string;
    readonly targetPath: string;
    readonly workflowRunId: string;
    readonly stepIndex: number;
    readonly detail?: string;
    readonly errorCode?: string;
};
/**
 * OutcomeObservationPayload — P6 V1 independent observation (O).
 * `not_observed` is honest absence of an observer, not a negative verdict.
 */
export type OutcomeObservationPayload = {
    readonly observation: "agree" | "disagree" | "unknown" | "not_observed";
    readonly observer: "fs_reality_probe" | "none";
    readonly approvedPath: string;
    readonly workflowRunId: string;
    readonly stepIndex: number;
    readonly detail?: string;
};
/**
 * OutcomeReconciliationPayload — P6 V1 R. A new fact about X given O.
 * Binds the content-addressed X and O ids. Does not mutate X.
 */
export type OutcomeReconciliationPayload = {
    readonly executorReportId: string;
    readonly observationId: string;
    readonly executorReport: "accepted" | "failed";
    readonly observation: "agree" | "disagree" | "unknown" | "not_observed";
    readonly status: "verified" | "disagreement" | "unknown" | "unverified";
    readonly workflowRunId: string;
    readonly stepIndex: number;
    readonly realityVerdict?: "agree" | "disagree" | "unknown";
    readonly intendedVsActual?: "match" | "deviation" | "unknown";
};
/**
 * WorkflowRunPayload — the terminal record for a complete workflow run.
 *
 * Persisted ONLY when the workflow reaches "completed" or "stopped" (W5).
 * Not written for in-progress runs.
 *
 * Acts as a provenance index: sessionRefs links this envelope to every
 * individual session's UCP chain (intent + response + handoff/receipt/refused).
 *
 * CONSTRUCTION RULE: undefined-free payloads.
 *   sessionRefs entries omit intentId / responseId when absent.
 */
export type WorkflowRunPayload = {
    readonly workflowRunId: string;
    readonly workflowName: string;
    readonly finalOutcome: "completed" | "stopped";
    readonly taskCount: number;
    readonly acceptedCount: number;
    readonly skippedCount: number;
    /**
     * Task input strings from spec, ordered by task index (0-based).
     *
     * Allows the history read model to display the original task input for every
     * task without requiring session-chain resolution (D5 fix from Phase 10A).
     *
     * V1.0 records written before Phase 10B do not have this field.
     * Consumers must treat absent / undefined as [].
     */
    readonly taskInputs: readonly string[];
    /**
     * Per-task session reference records.
     * Only tasks that ran (outcome !== "pending") are included.
     * Links back to individual session UCP chains via intentId / responseId.
     */
    readonly sessionRefs: readonly {
        readonly taskIndex: number;
        readonly outcome: "accepted" | "skipped" | "skipped_by_intake" | "planning_reviewed" | "stopped" | "rejected";
        readonly retryCount: number;
        readonly intentId?: string;
        readonly responseId?: string;
        /**
         * OPTIONAL (P3 Phase 2) — content-addressed model position ids that an
         * authorized human explicitly superseded before this task executed.
         * Present only when the task's delivery path parked on a structured model
         * advisory and the human chose to proceed despite it. The referenced
         * ucp.model_advisory.v1 envelopes are never altered by the supersession;
         * both facts survive independently.
         */
        readonly supersededPositionIds?: readonly string[];
        /**
         * OPTIONAL (P5 V1) — content-addressed model position ids retired on
         * named evidence. Distinct from supersededPositionIds.
         */
        readonly retiredPositionIds?: readonly string[];
    }[];
};
/**
 * CommandPayload — normalized structured CLI command (shadow artifact).
 *
 * This mirrors JsonOp semantics for observability/parity only.
 * It does not own live execution in this phase.
 */
export type CommandPayload = {
    readonly kind: "replace" | "rename" | "create" | "delete" | "run" | "append" | "prepend";
    readonly from?: string;
    readonly to?: string;
    readonly file?: string;
};
/**
 * ExecutionResultPayload — terminal workflow result projection (shadow artifact).
 *
 * Mirrors CLI machine-result shape for drift detection, while live CLI output
 * remains unchanged and authoritative in this phase.
 */
export type ExecutionResultPayload = {
    readonly succeeded: boolean;
    readonly errorCode: string | null;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exitCode?: number;
};
export type IntentEnvelope = UCPEnvelope<IntentPayload>;
export type PRVEnvelope = UCPEnvelope<PRVPayload>;
export type SafetyEnvelope = UCPEnvelope<SafetyPayload>;
export type ContextAlignmentEnvelope = UCPEnvelope<ContextAlignmentPayload>;
export type DisambiguationEnvelope = UCPEnvelope<DisambiguationPayload>;
export type CompletionEnvelope = UCPEnvelope<CompletionPayload>;
export type IntentInterpretationEnvelope = UCPEnvelope<IntentInterpretationPayload>;
export type ChangeInterpretationEnvelope = UCPEnvelope<ChangeInterpretationPayload>;
export type ResponseEnvelope = UCPEnvelope<ResponsePayload>;
export type InteractionContractEnvelope = UCPEnvelope<InteractionContractPayload>;
export type InteractionEventEnvelope = UCPEnvelope<InteractionEventPayload>;
export type DebugTraceEnvelope = UCPEnvelope<DebugTracePayload>;
export type ArtifactEnvelope = UCPEnvelope<ArtifactPayload>;
export type ExecutionTraceEnvelope = UCPEnvelope<ExecutionTracePayload>;
export type ReplayReportEnvelope = UCPEnvelope<ReplayReportPayload>;
export type ReminderExecutionEnvelope = UCPEnvelope<ReminderExecutionPayload>;
export type CursorHandoffEnvelope = UCPEnvelope<CursorHandoffPayload>;
export type CursorReceiptEnvelope = UCPEnvelope<CursorReceiptPayload>;
export type CursorRefusedEnvelope = UCPEnvelope<CursorRefusedPayload>;
export type ClaudeHandoffEnvelope = UCPEnvelope<ClaudeHandoffPayload>;
export type ClaudeReceiptEnvelope = UCPEnvelope<ClaudeReceiptPayload>;
export type ClaudeRefusedEnvelope = UCPEnvelope<ClaudeRefusedPayload>;
export type ModelAdvisoryEnvelope = UCPEnvelope<ModelAdvisoryPayload>;
export type ModelEvidenceBasisEnvelope = UCPEnvelope<ModelEvidenceBasisPayload>;
export type ModelPositionRetirementEnvelope = UCPEnvelope<ModelPositionRetirementPayload>;
export type RetiredPositionReassertionEnvelope = UCPEnvelope<RetiredPositionReassertionPayload>;
export type ExecutorReportEnvelope = UCPEnvelope<ExecutorReportPayload>;
export type OutcomeObservationEnvelope = UCPEnvelope<OutcomeObservationPayload>;
export type OutcomeReconciliationEnvelope = UCPEnvelope<OutcomeReconciliationPayload>;
export type WorkflowRunEnvelope = UCPEnvelope<WorkflowRunPayload>;
export type CommandEnvelope = UCPEnvelope<CommandPayload>;
export type ExecutionResultEnvelope = UCPEnvelope<ExecutionResultPayload>;
//# sourceMappingURL=types.d.ts.map