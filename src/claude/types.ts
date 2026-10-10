/**
 * Claude Managed Agents Integration types — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   This module defines the seam between UseSteady's authority system and
 *   Claude Managed Agents. It is the type contract for:
 *
 *     - ClaudeAgentHandoffArtifact: the approved, constrained artifact Claude receives
 *     - ClaudeDeliveryRequest: what the delivery gate sends to Claude
 *     - ClaudeDeliveryResponse: the three response kinds Claude may return
 *     - ClaudeScopeQuestion: Claude's structured scope clarification request
 *     - ClaudeToolPolicy: explicit tool + network + filesystem scope at handoff time
 *
 * ── Authority model ───────────────────────────────────────────────────────────
 *
 *   Claude Managed Agents: execute only.
 *   No upstream reach-back. No re-interpretation. No intent re-classification.
 *
 * ── Phase A locked truths (A1–A4) ────────────────────────────────────────────
 *
 *   A1 — executionDomain is mapper-derived, never reclassified downstream.
 *        The delivery gate may only validate presence and allowed values.
 *
 *   A2 — networkAccess: "allow_limited" is reserved and V1-blocked.
 *        "deny" is the only executable V1 value.
 *        The delivery gate rejects any artifact using "allow_limited".
 *
 *   A3 — Interrupted Claude sessions are non-resumable in V1.
 *        Interruption maps to refused_due_to_execution_error with
 *        code "session_interrupted". No resume path.
 *
 *   A4 — No callback loop from Claude to Intake exists in V1.
 *        The only mid-flight feedback path is structured scope clarification
 *        via ClaudeScopeQuestion, mediated by H.
 *
 * ── Key invariants ────────────────────────────────────────────────────────────
 *
 *   - ClaudeAgentHandoffArtifact never carries the original input string
 *   - eligibility === "approved_for_agent" is the only value that opens delivery
 *   - H may narrow scope only, never widen
 *   - Maximum one scope clarification per delivery attempt
 *   - toolPolicy.networkAccess must be "deny" in V1 (gate enforces)
 *   - toolPolicy.filesystemMode must be "scoped_only" (gate enforces)
 *   - Unknown response kinds are treated as refused_due_to_execution_error (fail-closed)
 *
 * ── Provenance chain ──────────────────────────────────────────────────────────
 *
 *   ucp.intent.v1 → ucp.response.v1 → ucp.claude_handoff.v1
 *     → ucp.claude_receipt.v1
 *       → [ucp.claude_result.v1 — RESERVED FUTURE SLOT]
 *         → ucp.execution_trace.v1 → ucp.replay_report.v1
 *
 *   Refusal path:
 *     ucp.claude_handoff.v1 → ucp.claude_refused.v1 (dead end or retry trigger)
 *
 *   Reserved future slots (not built in V1):
 *     ucp.claude_session.v1 — for managed session event history
 *     ucp.claude_result.v1  — for structured agent output
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */

import type { DeliveryEvidenceBasis } from "./evidence-basis.js";

// ─── Tool policy ──────────────────────────────────────────────────────────────

/**
 * ClaudeToolPolicy — explicit tool and runtime scope for a Claude delivery.
 *
 *   allowedTools    — closed set of tools Claude may use. Empty = no tools.
 *   networkAccess   — V1: always "deny". "allow_limited" is reserved but blocked by gate.
 *   filesystemMode  — always "scoped_only". No alternative in V1.
 *
 * The delivery gate enforces all three fields before delivery proceeds.
 */
export type ClaudeToolPolicy = {
  readonly allowedTools:    readonly string[];
  /**
   * V1: must be "deny". Gate rejects any artifact using "allow_limited".
   * "allow_limited" is reserved in the type for forward compatibility.
   * Its semantics (domain allowlist, egress-only, port restrictions) are deferred.
   */
  readonly networkAccess:   "deny" | "allow_limited";
  readonly filesystemMode:  "scoped_only";
};

// ─── Handoff artifact ─────────────────────────────────────────────────────────

/**
 * ClaudeAgentHandoffArtifact — the approved, constrained artifact Claude receives.
 *
 *   artifactId      — UCP content-addressed identity (sha256 of content fields)
 *   mode            — always "execute"; only execute flows reach Claude (A1)
 *   executionDomain — mapper-derived; gate validates presence only (A1)
 *   taskSpec        — approved task description; never includes raw user input
 *   allowedFiles    — H-narrowable file set; gate-enforced; empty = open within prohibitions
 *   prohibitedPatterns — OCD-constrained; gate-enforced; takes precedence over allowedFiles
 *   allowedTools    — explicit tool allowlist; gate-enforced
 *   toolPolicy      — tool + network + filesystem constraints
 *   ocdClearance    — "clear" or "conflict_accepted"; never "conflict_detected" at delivery
 *   eligibility     — must be "approved_for_agent" for delivery to proceed
 *   intentId        — links back to ucp.intent.v1 for provenance
 *   responseId      — links back to ucp.response.v1 for provenance
 *   approvedAt      — epoch ms when H approved; set by approveArtifact()
 */
export type ClaudeAgentHandoffArtifact = {
  readonly artifactId:          string;
  readonly mode:                "execute";
  readonly executionDomain:     ClaudeExecutionDomain;
  readonly taskSpec:            ClaudeTaskSpec;
  readonly allowedFiles:        readonly string[];
  readonly prohibitedPatterns:  readonly string[];
  readonly allowedTools:        readonly string[];
  readonly toolPolicy:          ClaudeToolPolicy;
  readonly ocdClearance:        "clear" | "conflict_accepted";
  readonly eligibility:         ClaudeHandoffEligibility;
  readonly intentId:            string;
  readonly responseId:          string;
  readonly approvedAt?:         number;
};

/**
 * ClaudeExecutionDomain — the class of task Claude is being asked to perform.
 *
 *   code_edit      — modify source files within allowedFiles
 *   ops_task       — operational action (deploy, restart, etc.)
 *   analysis_task  — read/analyze; no write authority
 *
 * INVARIANT (A1): this value is derived by the artifact mapper from
 * InterpretationResult.category. It is never re-classified downstream.
 * The delivery gate validates presence and allowed values only.
 */
export type ClaudeExecutionDomain = "code_edit" | "ops_task" | "analysis_task";

/**
 * ClaudeTaskSpec — the approved task description passed to Claude.
 *
 * Never carries the raw user input string.
 * parsedChange is present only when a structured edit command was parsed.
 */
export type ClaudeTaskSpec = {
  readonly category:     string;
  readonly summary:      string;
  readonly parsedChange?: {
    readonly filePath?: string;
    readonly oldValue?: string;
    readonly newValue?: string;
    readonly approvedEffective?: import("../understand/interpretation/types.js").ApprovedEffectiveBind;
  };
};

// ─── Eligibility ──────────────────────────────────────────────────────────────

/**
 * ClaudeHandoffEligibility — the approval state of the artifact.
 *
 *   pending_confirmation — OCD cleared; awaiting H confirmation.
 *   approved_for_agent   — H confirmed. Only value that opens the delivery gate.
 *   rejected             — H rejected, timed out, or execution error occurred.
 */
export type ClaudeHandoffEligibility =
  | "pending_confirmation"
  | "approved_for_agent"
  | "rejected";

// ─── Delivery contract ────────────────────────────────────────────────────────

/**
 * ClaudeDeliveryRequest — what the delivery gate sends to the Claude plugin.
 *
 *   deliveryId — delivery-attempt identifier. NOT a content identifier.
 *                Never use for provenance chain links; use artifactId for those.
 *   sentAt     — epoch ms of the delivery attempt.
 *   artifact   — the approved ClaudeAgentHandoffArtifact.
 */
export type ClaudeDeliveryRequest = {
  readonly deliveryId: string;
  readonly sentAt:     number;
  readonly artifact:   ClaudeAgentHandoffArtifact;
  /**
   * OPTIONAL (P3 Phase 2) — advisory positions the model previously emitted
   * for THIS artifact that an authorized human has since explicitly superseded.
   * Informational re-delivery context only: carries zero authority, never
   * changes gate semantics, and the model remains free to emit a new advisory.
   * Omitted entirely when there is no prior superseded advisory.
   */
  readonly priorAdvisories?: readonly ModelAdvisoryPosition[];
  /**
   * OPTIONAL (P5 V1) — advisory positions an authorized human retired on
   * named evidence for THIS artifact. Passed separately from priorAdvisories
   * (which remain the P3 proceed-despite set). Informational re-delivery
   * context only; resurrection control lives in the delivery gate, not here.
   */
  readonly retiredAdvisories?: readonly RetiredAdvisoryContext[];
};

/** P5 V1 — retired position carried into re-delivery (prompt + gate check). */
export type RetiredAdvisoryContext = {
  readonly position: ModelAdvisoryPosition;
  readonly modelPositionId: string;
  readonly resolvingEvidenceIds: readonly string[];
  readonly mappedEvidence?: {
    readonly evidenceBasisId: string;
    readonly evidenceBasisHash: string;
  };
};

/**
 * ClaudeAccepted — Claude accepted and started a managed session.
 *
 *   sessionId — the Anthropic managed agent session ID.
 *               Persisted in ucp.claude_receipt.v1 for audit.
 *               Not resumable in V1 (A3): if interrupted, maps to execution error.
 *   modelText — OPTIONAL. The verbatim text content the model emitted alongside
 *               its acceptance (e.g. commentary, warnings, recommendations).
 *               Preserved as evidence only: never classified, never interpreted,
 *               never re-read as a disposition signal. Absent when the model
 *               emitted no text content.
 *
 *               (P3 Phase 1 — model position preservation. Additive; no
 *               authority or disposition semantics change.)
 */
export type ClaudeAccepted = {
  readonly kind:       "accepted";
  readonly sessionId:  string;
  readonly modelText?: string;
};

/**
 * ClaudeRefusedDueToScope — Claude encountered a scope ambiguity before starting.
 *
 *   question — structured clarification request. H must answer from candidates.
 *
 * Rules:
 *   - One clarification round maximum per delivery.
 *   - H may choose only from question.candidates (candidate-bounded).
 *   - H may narrow only, never widen.
 *   - Second refusal ends the flow as rejected.
 */
export type ClaudeRefusedDueToScope = {
  readonly kind:     "refused_due_to_scope";
  readonly question: ClaudeScopeQuestion;
};

/**
 * ClaudeRefusedDueToExecutionError — Claude refused due to a runtime error.
 *
 *   code          — machine-readable error code (e.g. "session_interrupted", "tool_denied")
 *   message       — human-readable description
 *   messageOrigin — OPTIONAL. Who authored `message`:
 *                     "model"   — the text was actually emitted by the model
 *                     "adapter" — the text was synthesized deterministically by
 *                                 the adapter / gate / consensus layer
 *                   The marker exists so deterministic text is never later
 *                   mistaken for model judgment. Absent on legacy producers.
 *
 * Special code: "session_interrupted" maps to A3 (non-resumable session).
 *
 * (P3 Phase 1 — model position preservation. Additive; no authority or
 * disposition semantics change.)
 */
export type ClaudeRefusedDueToExecutionError = {
  readonly kind:           "refused_due_to_execution_error";
  readonly code:           string;
  readonly message:        string;
  readonly messageOrigin?: "model" | "adapter";
};

/**
 * ClaudeDeliveryResponse — the closed set of responses Claude may return.
 *
 * INVARIANT: unknown response kinds must be treated as refused_due_to_execution_error
 * by the delivery gate (fail-closed). This is identical to the Cursor seam rule.
 *
 * P3 Phase 2: "advisory" is a fourth known kind — a non-terminal model position
 * that parks the task for an explicit human supersession decision. It is NOT a
 * refusal, NOT an acceptance, and carries zero authority.
 */
export type ClaudeDeliveryResponse =
  | ClaudeAccepted
  | ClaudeRefusedDueToScope
  | ClaudeRefusedDueToExecutionError
  | ClaudeAdvisoryPositions;

// ─── Model advisory positions (P3 Phase 2) ────────────────────────────────────

/**
 * ModelAdvisoryKind — the CLOSED enum of advisory position kinds a model may
 * emit. Model-selected through the structured `model_advisory_position` tool
 * contract only; UseSteady NEVER infers advisory/warning/objection content
 * from free text (free text remains preserved-but-unclassified, Phase 1).
 */
export type ModelAdvisoryKind =
  | "warning"
  | "recommend_against"
  | "uncertainty"
  | "alternative";

/** Closed-enum membership list for runtime validation. */
export const MODEL_ADVISORY_KINDS: readonly ModelAdvisoryKind[] = [
  "warning",
  "recommend_against",
  "uncertainty",
  "alternative",
];

/**
 * ModelAdvisoryPosition — one canonical model advisory event.
 *
 *   kind        — model-selected advisory kind (closed enum)
 *   explanation — model-authored, verbatim. Never rewritten.
 *   artifactId  — the action/artifact basis this position is ABOUT. Stamped by
 *                 the ADAPTER from the delivered artifact — the model never
 *                 supplies it (it cannot know the content-addressed id).
 *   runtime     — runtime identity ("claude"), adapter-stamped
 *   model       — model identity (e.g. "claude-opus-4-5"), adapter-stamped
 *
 * Zero authority: an advisory does not approve, refuse, change a plan, execute,
 * weaken any gate, or alter refusal / consensus / safety semantics.
 */
export type ModelAdvisoryPosition = {
  readonly kind:        ModelAdvisoryKind;
  readonly explanation: string;
  readonly artifactId:  string;
  readonly runtime:     string;
  readonly model:       string;
};

/**
 * canonicalModelAdvisoryEvent — the exact canonical object whose hashObject
 * digest is the durable content-addressed `modelPositionId`. Field set and
 * value casing are protocol-fixed; do not extend without a named revision.
 */
export function canonicalModelAdvisoryEvent(position: ModelAdvisoryPosition): {
  readonly artifactId:  string;
  readonly explanation: string;
  readonly kind:        ModelAdvisoryKind;
  readonly model:       string;
  readonly runtime:     string;
} {
  return {
    artifactId:  position.artifactId,
    explanation: position.explanation,
    kind:        position.kind,
    model:       position.model,
    runtime:     position.runtime,
  };
}

/**
 * ModelAdvisoryRecord — a validated advisory position plus its durable
 * evidence identity, produced by the delivery gate.
 *
 *   modelPositionId     — hashObject over canonicalModelAdvisoryEvent(position)
 *   evidenceEnvelopeId  — id of the persisted ucp.model_advisory.v1 envelope
 *   evidenceBasis       — OPTIONAL (P4). The system-derived evidence basis for
 *                         this challenge, derived from the delivery request
 *                         BEFORE the model was called. Never reverse-derived
 *                         from the model's response. Carried in-memory so the
 *                         Portal bridge can present the evidence boundary
 *                         truthfully; the durable form is the linked
 *                         ucp.model_evidence_basis.v1 envelope.
 */
export type ModelAdvisoryRecord = {
  readonly position:            ModelAdvisoryPosition;
  readonly modelPositionId:     string;
  readonly evidenceEnvelopeId:  string;
  readonly evidenceBasis?:      DeliveryEvidenceBasis;
  /**
   * OPTIONAL (P4/P5) — id of the persisted ucp.model_evidence_basis.v1
   * envelope. Named resolving evidence for a P5 retirement when the human
   * cites the system basis record. Absent on legacy records.
   */
  readonly evidenceBasisEnvelopeId?: string;
  readonly evidenceBasisEnvelopeHash?: string;
};

/**
 * P5 V1 — in-memory retirement relation for one advisory. The durable form
 * is ucp.model_position_retirement.v1. The advisory record is never mutated.
 */
export type ModelRetirementRecord = {
  readonly record: ModelAdvisoryRecord;
  readonly groundsId: string;
  readonly resolvingEvidenceIds: readonly string[];
  readonly retirementEnvelopeId: string;
  readonly authorityEvidenceStatus: "portal_signed_verified" | "self_asserted";
  readonly mappedRelation?: {
    readonly modelPositionId: string;
    readonly positionHash: string;
    readonly evidenceBasisId: string;
    readonly evidenceBasisHash: string;
  };
};

/**
 * ClaudeAdvisoryPositions — Claude emitted one or more structured advisory
 * positions about the delivered action WITHOUT executing it.
 *
 * Semantics (locked):
 *   - Advisory-only responses must NOT count as task execution or acceptance.
 *   - The coordinator parks the task in "task_advisory"; execution of the
 *     advised action happens only after an explicit human decision.
 *   - The delivery gate persists each position as ucp.model_advisory.v1
 *     (best-effort, audit-critical) and returns the durable ids.
 */
export type ClaudeAdvisoryPositions = {
  readonly kind:      "advisory";
  readonly positions: readonly ModelAdvisoryPosition[];
};

// ─── Scope clarification ──────────────────────────────────────────────────────

/**
 * ClaudeScopeQuestion — structured clarification request from Claude.
 *
 *   questionKind  — semantic kind of the ambiguity Claude encountered
 *   candidates    — the complete set of valid choices (H must pick from these only)
 *   explanation   — human-readable description of what Claude needs
 *
 * Claude may NOT generate a scope question that expands file or tool scope
 * beyond what was in the approved artifact.
 */
export type ClaudeScopeQuestion = {
  readonly questionKind:
    | "need_file_path"
    | "need_scope_selection"
    | "need_tool_permission"
    | "ambiguous_old_value";
  readonly candidates:   readonly string[];
  readonly explanation:  string;
};
