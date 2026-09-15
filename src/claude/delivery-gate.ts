/**
 * Claude Delivery Gate — Phase 8B.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   The delivery gate is the ONLY path through which a ClaudeAgentHandoffArtifact
 *   reaches Claude Managed Agents. It enforces these invariants before any delivery:
 *
 *     1. Eligibility: artifact.eligibility === "approved_for_agent"
 *     2. Tool policy: toolPolicy.networkAccess === "deny" (V1 lock, A2)
 *     3. Tool policy: toolPolicy.filesystemMode === "scoped_only"
 *     4. Tool policy: allowedTools is non-empty
 *     5. Persistence: ucp.claude_handoff.v1 persisted before Claude is called
 *     6. Immutability: artifact delivered === artifact persisted (same id)
 *
 *   After delivery, it persists either ucp.claude_receipt.v1 (accepted) or
 *   ucp.claude_refused.v1 (refused) based on Claude's response.
 *
 * ── Three delivery paths ──────────────────────────────────────────────────────
 *
 *   Path A (happy):  persist handoff → call Claude → accepted → persist receipt
 *   Path B (scope):  persist handoff → call Claude → refused_due_to_scope
 *                      → persist refused → surface scope question
 *   Path C (error):  persist handoff → call Claude → refused_due_to_execution_error
 *                      → persist refused → rejected
 *
 *   Unknown response kinds → treated as refused_due_to_execution_error (fail-closed).
 *
 * ── Plugin contract ───────────────────────────────────────────────────────────
 *
 *   ClaudeAgentPlugin.receive() is the only call the gate makes into Claude.
 *   The plugin must:
 *     - Accept only ClaudeDeliveryRequest
 *     - Return only ClaudeDeliveryResponse (one of three kinds)
 *     - NOT reach back into the intake pipeline (A4)
 *     - NOT call persistEnvelope (the gate owns all persistence)
 *
 * ── Persistence semantics ─────────────────────────────────────────────────────
 *
 *   ucp.claude_handoff.v1  — safety-critical (persistStrict): blocks delivery if fails
 *   ucp.claude_receipt.v1  — audit-critical (persistBestEffort): logs gap if fails
 *   ucp.claude_refused.v1  — audit-critical (persistBestEffort): logs gap if fails
 *   ucp.model_advisory.v1  — audit-critical (persistBestEffort): per advisory position
 *   ucp.model_evidence_basis.v1 — audit-critical (persistBestEffort): P4 child of
 *                            advisory / scope-refusal envelopes; system-derived
 *                            from the request BEFORE the model is called
 *
 * ── deliveryId semantics ──────────────────────────────────────────────────────
 *
 *   deliveryId is a delivery-attempt identifier, NOT a content identifier.
 *   Never use it for provenance chain links — use artifact.artifactId for those.
 *
 * See: docs/claude-agent-phase-a-architecture.md
 */

import type { UCPEnvelope }                         from "../ucp/types.js";
import { hashObject }                               from "../ucp/hashes.js";
import { persistEnvelope, persistEnvelopeOrThrow }  from "../ucp/persistence/write.js";
import {
  createClaudeHandoffEnvelope,
  createClaudeReceiptEnvelope,
  createClaudeRefusedEnvelope,
  createModelAdvisoryEnvelope,
  createModelEvidenceBasisEnvelope,
  createRetiredPositionReassertionEnvelope,
} from "../ucp/envelope.js";
import { deriveDeliveryEvidenceBasis } from "./evidence-basis.js";
import {
  classifyIncomingAdvisory,
  compareGrounds,
  groundsIdFromBasis,
  type RetiredPositionRef,
} from "./objection-retirement.js";
import type {
  ClaudeAgentHandoffArtifact,
  ClaudeDeliveryRequest,
  ClaudeDeliveryResponse,
  ClaudeRefusedDueToScope,
  ClaudeRefusedDueToExecutionError,
  ClaudeScopeQuestion,
  ModelAdvisoryPosition,
  ModelAdvisoryRecord,
  RetiredAdvisoryContext,
} from "./types.js";
import { MODEL_ADVISORY_KINDS, canonicalModelAdvisoryEvent } from "./types.js";

// ─── Plugin interface ─────────────────────────────────────────────────────────

/**
 * The interface the delivery gate uses to communicate with Claude Managed Agents.
 *
 * This is the mechanism-agnostic seam. Implementations may use:
 *   - Direct Anthropic API calls (real Claude adapter)
 *   - Stub responses (test adapter)
 *
 * The plugin must NOT:
 *   - Re-derive intent from context (A1)
 *   - Reach back to the intake pipeline (A4)
 *   - Execute outside allowedFiles (gate-enforced upstream)
 *   - Use tools not in allowedTools (gate-enforced upstream)
 *   - Call persistEnvelope (the gate owns all persistence)
 */
export interface ClaudeAgentPlugin {
  receive(request: ClaudeDeliveryRequest): Promise<ClaudeDeliveryResponse>;
}

// ─── Gate result ──────────────────────────────────────────────────────────────

export type ClaudeDeliveryGateResult =
  | {
      readonly outcome:            "accepted";
      readonly deliveryId:         string;
      readonly handoffEnvelopeId:  string;
      readonly receiptEnvelopeId:  string;
      readonly sessionId:          string;
    }
  | {
      readonly outcome:            "refused_due_to_scope";
      readonly deliveryId:         string;
      readonly handoffEnvelopeId:  string;
      readonly refusedEnvelopeId:  string;
      readonly scopeQuestion:      ClaudeScopeQuestion;
    }
  | {
      /**
       * P3 Phase 2: the model emitted structured advisory position(s) and did
       * NOT execute. Each position was validated and persisted as
       * ucp.model_advisory.v1 (best-effort); the records carry the durable
       * content-addressed modelPositionId and the evidence envelope id.
       */
      readonly outcome:            "advisory";
      readonly deliveryId:         string;
      readonly handoffEnvelopeId:  string;
      readonly positions:          readonly ModelAdvisoryRecord[];
    }
  | {
      /**
       * P5 V1: every returned advisory was a reassertion of a retired
       * position (same identity / same or unknown grounds). Recorded as
       * ucp.retired_position_reassertion.v1. Does not park.
       */
      readonly outcome:            "retired_reassertion";
      readonly deliveryId:         string;
      readonly handoffEnvelopeId:  string;
      readonly reassertions:       readonly ModelAdvisoryRecord[];
    }
  | {
      readonly outcome:            "refused_due_to_execution_error";
      readonly deliveryId:         string;
      readonly handoffEnvelopeId:  string;
      readonly refusedEnvelopeId:  string;
      readonly errorCode:          string;
      readonly message:            string;
    }
  | {
      readonly outcome: "blocked_ineligible";
      readonly reason:  string;
    }
  | {
      readonly outcome: "blocked_tool_policy";
      readonly reason:  string;
    }
  | {
      readonly outcome: "blocked_persistence_failure";
      readonly reason:  string;
    };

// ─── Injectable deps (for testing) ───────────────────────────────────────────

export type ClaudeGateDeps = {
  /**
   * Persistence function for the critical handoff envelope.
   * MUST throw on failure — a failure blocks delivery entirely.
   */
  persistStrict?:     (envelope: UCPEnvelope<unknown>) => void;
  /**
   * Persistence function for non-critical envelopes (receipt, refused).
   * Must NOT throw — errors are swallowed.
   */
  persistBestEffort?: (envelope: UCPEnvelope<unknown>) => void;
};

// ─── Delivery gate ────────────────────────────────────────────────────────────

export class ClaudeDeliveryGate {
  private readonly persistStrict:     (envelope: UCPEnvelope<unknown>) => void;
  private readonly persistBestEffort: (envelope: UCPEnvelope<unknown>) => void;

  constructor(
    private readonly plugin:   ClaudeAgentPlugin,
    private readonly storeDir: string,
    deps: ClaudeGateDeps = {},
  ) {
    this.persistStrict     = deps.persistStrict
      ?? ((e) => persistEnvelopeOrThrow(storeDir, e));
    this.persistBestEffort = deps.persistBestEffort
      ?? ((e) => persistEnvelope(storeDir, e));
  }

  /**
   * Deliver a ClaudeAgentHandoffArtifact to Claude Managed Agents.
   *
   * CONTRACT — callers must ensure:
   *   - artifact.eligibility === "approved_for_agent" (gate re-checks and blocks if not)
   *   - artifact.toolPolicy.networkAccess === "deny" (gate re-checks, A2)
   *   - artifact.approvedAt is set (H has confirmed)
   *
   * CONTRACT — this function guarantees:
   *   - ucp.claude_handoff.v1 persisted BEFORE Claude is called
   *   - If persistence fails, Claude is NOT called (blocked_persistence_failure)
   *   - ucp.claude_receipt.v1 persisted when Claude returns "accepted"
   *   - ucp.claude_refused.v1 persisted when Claude returns any refusal
   *   - ucp.model_advisory.v1 persisted (per position) when Claude returns "advisory"
   *   - Receipt/refusal/advisory persistence failures do not block the state transition
   *   - Unknown response kinds map to refused_due_to_execution_error (fail-closed)
   *
   * P3 Phase 2: `opts.priorAdvisories` carries advisory positions a human has
   * explicitly superseded for THIS artifact into the re-delivery request as
   * informational context. Zero authority; never changes gate semantics.
   */
  async deliver(
    artifact: ClaudeAgentHandoffArtifact,
    opts?:    {
      readonly priorAdvisories?: readonly ModelAdvisoryPosition[];
      readonly retiredPositions?: readonly RetiredPositionRef[];
      readonly retiredAdvisories?: readonly RetiredAdvisoryContext[];
    },
  ): Promise<ClaudeDeliveryGateResult> {
    // ── Eligibility check ─────────────────────────────────────────────────────
    if (artifact.eligibility !== "approved_for_agent") {
      return {
        outcome: "blocked_ineligible",
        reason:  `Artifact eligibility is "${artifact.eligibility}", not "approved_for_agent".`,
      };
    }

    // ── Tool policy checks (A2: networkAccess must be "deny" in V1) ───────────
    if (artifact.toolPolicy.networkAccess !== "deny") {
      return {
        outcome: "blocked_tool_policy",
        reason:  `toolPolicy.networkAccess is "${artifact.toolPolicy.networkAccess}". ` +
                 `Only "deny" is executable in V1. "allow_limited" is reserved and blocked.`,
      };
    }
    if (artifact.toolPolicy.filesystemMode !== "scoped_only") {
      return {
        outcome: "blocked_tool_policy",
        reason:  `toolPolicy.filesystemMode is "${artifact.toolPolicy.filesystemMode}". ` +
                 `Only "scoped_only" is allowed.`,
      };
    }
    if (artifact.allowedTools.length === 0) {
      return {
        outcome: "blocked_tool_policy",
        reason:  "allowedTools is empty. Claude must have at least one tool to execute.",
      };
    }

    const sentAt     = Date.now();
    const deliveryId = computeDeliveryId(artifact.artifactId, sentAt);

    // ── Point 1: Persist handoff BEFORE calling Claude ────────────────────────
    const handoffEnvelope = createClaudeHandoffEnvelope(
      {
        intentId:          artifact.intentId,
        responseId:        artifact.responseId,
        eligibility:       "approved_for_agent",
        ocdClearance:      artifact.ocdClearance,
        executionDomain:   artifact.executionDomain,
        allowedFiles:      [...artifact.allowedFiles],
        allowedTools:      [...artifact.allowedTools],
        confirmedByHuman:  true,
        confirmedAt:       artifact.approvedAt ?? sentAt,
      },
      { parentId: artifact.responseId, rootId: artifact.intentId },
    );

    try {
      this.persistStrict(handoffEnvelope);
    } catch (err) {
      return {
        outcome: "blocked_persistence_failure",
        reason:  `Failed to persist ucp.claude_handoff.v1 before delivery: ${String(err)}`,
      };
    }

    // ── Call Claude ───────────────────────────────────────────────────────────
    const request: ClaudeDeliveryRequest = {
      deliveryId,
      sentAt,
      artifact,
      ...(opts?.priorAdvisories !== undefined && opts.priorAdvisories.length > 0
        ? { priorAdvisories: opts.priorAdvisories }
        : {}),
      ...(opts?.retiredAdvisories !== undefined && opts.retiredAdvisories.length > 0
        ? { retiredAdvisories: opts.retiredAdvisories }
        : {}),
    };

    // ── P4: derive the evidence basis BEFORE the model is called ─────────────
    // The basis is a fact about what the SYSTEM supplies to the constructed
    // model input. Deriving it pre-call makes it structurally impossible for
    // the basis to be reverse-derived from — or contaminated by — the model's
    // response. "available_and_corresponded" asserts supply/correspondence at
    // the application boundary only; never comprehension, reliance, or
    // provider-side consumption.
    const evidenceBasis  = deriveDeliveryEvidenceBasis(request);
    const basisDerivedAt = Date.now();

    let response: ClaudeDeliveryResponse;

    try {
      response = await this.plugin.receive(request);
    } catch (err) {
      // Plugin threw — treat as execution error (fail-closed)
      response = {
        kind:          "refused_due_to_execution_error",
        code:          "plugin_threw",
        message:       String(err),
        messageOrigin: "adapter",
      };
    }

    // ── Normalize unknown response kinds (fail-closed) ────────────────────────
    if (
      response.kind !== "accepted" &&
      response.kind !== "refused_due_to_scope" &&
      response.kind !== "refused_due_to_execution_error" &&
      response.kind !== "advisory"
    ) {
      response = {
        kind:          "refused_due_to_execution_error",
        code:          "unknown_response_kind",
        message:       `Unknown Claude response kind received. Treating as execution error.`,
        messageOrigin: "adapter",
      };
    }

    // ── Point 2a′: advisory (P3 Phase 2) ──────────────────────────────────────
    // The model emitted structured advisory position(s) and did NOT execute.
    // Validate defensively, persist each position as ucp.model_advisory.v1
    // (best-effort), and return the durable evidence records. When no position
    // survives validation the response is fail-closed to an execution error.
    if (response.kind === "advisory") {
      const validPositions = validateAdvisoryPositions(response.positions, artifact);
      if (validPositions.length === 0) {
        response = {
          kind:          "refused_due_to_execution_error",
          code:          "malformed_advisory",
          message:       "Claude returned kind \"advisory\" with no valid positions (kind, non-empty explanation, and matching artifactId are required).",
          messageOrigin: "adapter",
        };
        // Fall through to the execution-error branch below.
      } else {
        const incomingGroundsId = groundsIdFromBasis(artifact.artifactId, evidenceBasis);
        const retiredRefs = opts?.retiredPositions ?? [];
        const standing: ModelAdvisoryRecord[] = [];
        const reassertions: ModelAdvisoryRecord[] = [];

        const records: ModelAdvisoryRecord[] = [];
        const seenPairs = new Set<string>();
        const envelopeByPositionId = new Map<string, string>();
        for (const position of validPositions) {
          const modelPositionId = hashObject(canonicalModelAdvisoryEvent(position));
          const advisoryEnvelope = createModelAdvisoryEnvelope(
            {
              deliveryId,
              handoffId:       handoffEnvelope.id,
              artifactId:      artifact.artifactId,
              modelPositionId,
              positionKind:    position.kind,
              explanation:     position.explanation,
              runtime:         position.runtime,
              model:           position.model,
              receivedAt:      sentAt,
            },
            { parentId: handoffEnvelope.id, rootId: artifact.intentId },
          );
          const basisEnvelope = createModelEvidenceBasisEnvelope(
            {
              subjectKind:                "model_advisory",
              subjectId:                  modelPositionId,
              deliveryId,
              artifactId:                 artifact.artifactId,
              derivation:                 evidenceBasis.derivation,
              sources:                    evidenceBasis.sources,
              evidenceBackedContradiction: evidenceBasis.evidenceBackedContradiction,
              comprehension:              evidenceBasis.comprehension,
              derivedAt:                  basisDerivedAt,
            },
            { parentId: advisoryEnvelope.id, rootId: artifact.intentId },
          );
          const previousEnvelope = envelopeByPositionId.get(modelPositionId);
          if (
            previousEnvelope !== undefined &&
            previousEnvelope !== advisoryEnvelope.id
          ) {
            const refusedEnvelope = createClaudeRefusedEnvelope(
              {
                deliveryId,
                handoffId: handoffEnvelope.id,
                artifactId: artifact.artifactId,
                receivedAt: sentAt,
                refusalKind: "refused_due_to_execution_error",
                errorCode: "conflicting_advisory_identity",
                errorMessage:
                  "One advisory content identity resolved to conflicting envelope identities.",
                messageOrigin: "adapter",
              },
              { parentId: handoffEnvelope.id, rootId: artifact.intentId },
            );
            this.tryPersistBestEffort(refusedEnvelope);
            return {
              outcome: "refused_due_to_execution_error",
              deliveryId,
              handoffEnvelopeId: handoffEnvelope.id,
              refusedEnvelopeId: refusedEnvelope.id,
              errorCode: "conflicting_advisory_identity",
              message:
                "One advisory content identity resolved to conflicting envelope identities.",
            };
          }
          envelopeByPositionId.set(modelPositionId, advisoryEnvelope.id);
          const pairKey = `${modelPositionId}:${advisoryEnvelope.id}`;
          if (seenPairs.has(pairKey)) continue;
          seenPairs.add(pairKey);
          this.tryPersistBestEffort(advisoryEnvelope);
          this.tryPersistBestEffort(basisEnvelope);
          const record: ModelAdvisoryRecord = {
            position,
            modelPositionId,
            evidenceEnvelopeId: advisoryEnvelope.id,
            evidenceBasis,
            evidenceBasisEnvelopeId: basisEnvelope.id,
            evidenceBasisEnvelopeHash: basisEnvelope.hash,
          };
          records.push(record);

          const classification = classifyIncomingAdvisory(
            { modelPositionId, groundsId: incomingGroundsId },
            retiredRefs,
          );
          if (classification === "retired_reassertion") {
            const match = retiredRefs.find((r) => r.modelPositionId === modelPositionId)
              ?? retiredRefs.find((r) => compareGrounds(r.groundsId, incomingGroundsId) === "same")
              ?? retiredRefs[0];
            const groundsRelation =
              match === undefined
                ? "unknown"
                : compareGrounds(match.groundsId, incomingGroundsId) === "same"
                  ? "same"
                  : "no_new_ground";
            if (match?.retirementEnvelopeId !== undefined) {
              this.tryPersistBestEffort(createRetiredPositionReassertionEnvelope(
                {
                  modelPositionId,
                  positionHash:         advisoryEnvelope.id,
                  retirementEnvelopeId: match.retirementEnvelopeId,
                  groundsRelation,
                  receivedAt:           sentAt,
                },
                { parentId: advisoryEnvelope.id, rootId: artifact.intentId },
              ));
            }
            reassertions.push(record);
          } else {
            standing.push(record);
          }
        }

        if (standing.length === 0 && reassertions.length > 0) {
          return {
            outcome:           "retired_reassertion",
            deliveryId,
            handoffEnvelopeId: handoffEnvelope.id,
            reassertions,
          };
        }

        return {
          outcome:           "advisory",
          deliveryId,
          handoffEnvelopeId: handoffEnvelope.id,
          positions:         standing.length > 0 ? standing : reassertions,
        };
      }
    }

    // ── Point 2a: accepted ────────────────────────────────────────────────────
    if (response.kind === "accepted") {
      const receiptEnvelope = createClaudeReceiptEnvelope(
        {
          deliveryId,
          handoffId:  handoffEnvelope.id,
          artifactId: artifact.artifactId,
          sessionId:  response.sessionId,
          receivedAt: sentAt,
          // P3 Phase 1: preserve the model's verbatim emitted text, when any.
          // Evidence only — never classified, never re-read as a signal.
          ...(response.modelText !== undefined && response.modelText !== ""
            ? { modelText: response.modelText }
            : {}),
        },
        { parentId: handoffEnvelope.id, rootId: artifact.intentId },
      );
      this.tryPersistBestEffort(receiptEnvelope);

      return {
        outcome:           "accepted",
        deliveryId,
        handoffEnvelopeId: handoffEnvelope.id,
        receiptEnvelopeId: receiptEnvelope.id,
        sessionId:         response.sessionId,
      };
    }

    // ── Point 2b: refused_due_to_scope ────────────────────────────────────────
    if (response.kind === "refused_due_to_scope") {
      const refusedEnvelope = createClaudeRefusedEnvelope(
        {
          deliveryId,
          handoffId:        handoffEnvelope.id,
          artifactId:       artifact.artifactId,
          receivedAt:       sentAt,
          refusalKind:      "refused_due_to_scope",
          scopeQuestionKind: response.question.questionKind,
          scopeCandidates:  [...response.question.candidates],
          // P3 Phase 1: preserve the model's verbatim scope explanation.
          // This is the same string the session/shell surfaces render when
          // offering candidates, so persisted ↔ presented correspondence holds.
          ...(response.question.explanation !== undefined && response.question.explanation !== ""
            ? { scopeExplanation: response.question.explanation }
            : {}),
        },
        { parentId: handoffEnvelope.id, rootId: artifact.intentId },
      );
      this.tryPersistBestEffort(refusedEnvelope);
      // P4: evidence basis for the scope-refusal challenge surface — child of
      // the refusal envelope, derived pre-call from the delivery contract.
      this.tryPersistBestEffort(createModelEvidenceBasisEnvelope(
        {
          subjectKind:                "scope_refusal",
          subjectId:                  refusedEnvelope.id,
          deliveryId,
          artifactId:                 artifact.artifactId,
          derivation:                 evidenceBasis.derivation,
          sources:                    evidenceBasis.sources,
          evidenceBackedContradiction: evidenceBasis.evidenceBackedContradiction,
          comprehension:              evidenceBasis.comprehension,
          derivedAt:                  basisDerivedAt,
        },
        { parentId: refusedEnvelope.id, rootId: artifact.intentId },
      ));

      return {
        outcome:           "refused_due_to_scope",
        deliveryId,
        handoffEnvelopeId: handoffEnvelope.id,
        refusedEnvelopeId: refusedEnvelope.id,
        scopeQuestion:     response.question,
      };
    }

    // ── Point 2c: refused_due_to_execution_error ──────────────────────────────
    const execError = response as ClaudeRefusedDueToExecutionError;
    const refusedEnvelope = createClaudeRefusedEnvelope(
      {
        deliveryId,
        handoffId:   handoffEnvelope.id,
        artifactId:  artifact.artifactId,
        receivedAt:  sentAt,
        refusalKind: "refused_due_to_execution_error",
        errorCode:   execError.code,
        // P3 Phase 1: preserve the refusal message verbatim, with an explicit
        // origin marker so adapter/gate-synthesized text is never later
        // mistaken for model judgment.
        errorMessage: execError.message,
        ...(execError.messageOrigin !== undefined
          ? { messageOrigin: execError.messageOrigin }
          : {}),
      },
      { parentId: handoffEnvelope.id, rootId: artifact.intentId },
    );
    this.tryPersistBestEffort(refusedEnvelope);

    return {
      outcome:           "refused_due_to_execution_error",
      deliveryId,
      handoffEnvelopeId: handoffEnvelope.id,
      refusedEnvelopeId: refusedEnvelope.id,
      errorCode:         execError.code,
      message:           execError.message,
    };
  }

  private tryPersistBestEffort(envelope: UCPEnvelope<unknown>): void {
    try {
      this.persistBestEffort(envelope);
    } catch {
      // Best-effort: do not throw, do not block
    }
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function computeDeliveryId(artifactId: string, sentAt: number): string {
  return hashObject({ artifactId, sentAt });
}

/**
 * Defensive validation for advisory positions (P3 Phase 2). A position is
 * valid only when: kind is in the closed enum, explanation is a non-empty
 * string, runtime/model are non-empty strings, and artifactId matches the
 * delivered artifact exactly (an advisory is always ABOUT the delivered
 * action — a position stamped for another artifact is never actionable here).
 */
function validateAdvisoryPositions(
  positions: readonly ModelAdvisoryPosition[],
  artifact:  ClaudeAgentHandoffArtifact,
): readonly ModelAdvisoryPosition[] {
  if (!Array.isArray(positions)) return [];
  const kinds = new Set<string>(MODEL_ADVISORY_KINDS);
  return positions.filter(
    (p): p is ModelAdvisoryPosition =>
      p !== null &&
      typeof p === "object" &&
      kinds.has(p.kind) &&
      typeof p.explanation === "string" &&
      p.explanation.trim().length > 0 &&
      typeof p.artifactId === "string" &&
      p.artifactId === artifact.artifactId &&
      typeof p.runtime === "string" &&
      p.runtime.length > 0 &&
      typeof p.model === "string" &&
      p.model.length > 0,
  );
}
