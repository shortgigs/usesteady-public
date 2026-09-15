/**
 * Multi-LLM consensus types — policy kernel.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   This module is the stable center of the MultiLlmPlugin layer. It is
 *   intentionally pure: no I/O, no LLM calls, no side effects.
 *
 *   Everything in multi-llm-adapter.ts and openai-compatible-adapter.ts
 *   depends on these types. The enums and evaluatePolicy() must be stable
 *   before any adapter logic is written.
 *
 * ── Dependency order ──────────────────────────────────────────────────────────
 *
 *   1. Closed enum types  (OperationClass, RationaleCategory, QuorumState, PolicyMode)
 *   2. NormalizedDecision, MultiLlmOptions, ReviewPayload, ConsensusAuditRecord
 *   3. normalizeResponse() — maps ClaudeDeliveryResponse → NormalizedDecision
 *   4. evaluatePolicy()    — fail-closed precedence, six rules verbatim
 *
 * ── Closed enum contract ──────────────────────────────────────────────────────
 *
 *   OperationClass and RationaleCategory are CLOSED SETS. Plugins may not
 *   invent values. normalizeResponse() maps any unrecognised value to "unknown".
 *   "unknown" on the primary in evaluatePolicy() → fail closed (Rule 6).
 *
 * ── Consensus definition ──────────────────────────────────────────────────────
 *
 *   Consensus is NOT "multiple plugins returned accepted."
 *   Consensus is: all relevant plugins produced matching NormalizedDecision.hash values.
 *   Hash is SHA-256 of (disposition, artifactId, operationClass, rationaleCategory).
 *
 * ── Locked invariants (INV-ML-1 through INV-ML-6) ───────────────────────────
 *
 *   These invariants are frozen in AGENTS.md and must not be changed without
 *   a named phase. Short form:
 *
 *   INV-ML-1  Consensus = matching NormalizedDecision.hash. Not "multiple accepts."
 *   INV-ML-2  refused_due_to_scope from any plugin → immediate stop, no review.
 *   INV-ML-3  Review round only for execution disagreement. One round maximum.
 *   INV-ML-4  Unresolved disagreement → fail closed. No partial acceptance.
 *   INV-ML-5  Primary plugin's response is always returned. Never selected by position.
 *   INV-ML-6  ConsensusAuditRecord MUST be written for every receive() call.
 *
 * See: AGENTS.md — Multi-LLM consensus invariants (INV-ML-1 through INV-ML-6)
 * See: scripts/verify-consensus.ts — regression baseline for all four outcomes
 */

import { createHash } from "node:crypto";
import type {
  ClaudeDeliveryRequest,
  ClaudeDeliveryResponse,
} from "../types.js";

// ─── Closed enum types ────────────────────────────────────────────────────────

/**
 * OperationClass — the class of operation a plugin determined for the request.
 *
 * CLOSED SET. Values outside this set are not valid.
 * normalizeResponse() maps any unrecognised domain to "unknown".
 * "unknown" on the primary → fail closed (evaluatePolicy Rule 6).
 */
export type OperationClass =
  | "read_only"          // analysis_task domain — no write authority
  | "artifact_delivery"  // code_edit domain — modify source files
  | "execution_request"  // ops_task domain — deploy, restart, etc.
  | "scope_question"     // plugin raised a scope boundary
  | "execution_error"    // plugin reported a runtime error
  | "refusal"            // plugin explicitly refused without scope or error
  | "unknown";           // fallback for unrecognised plugin output ONLY

/**
 * RationaleCategory — the semantic reason behind a plugin's disposition.
 *
 * CLOSED SET. Same constraints as OperationClass.
 * Maps to the "why" axis of the normalized decision for audit purposes.
 */
export type RationaleCategory =
  | "scope"                  // scope boundary or ambiguity
  | "safety"                 // safety policy triggered
  | "execution_feasibility"  // feasibility check (accepted = feasible; error = infeasible)
  | "policy"                 // explicit policy rule triggered
  | "unknown";               // fallback ONLY

/**
 * QuorumState — the outcome produced by evaluatePolicy().
 *
 * Records which of the six fail-closed precedence rules fired.
 * Persisted in ConsensusAuditRecord.quorumState for every call.
 */
export type QuorumState =
  | "unanimous"     // all hashes match; all dispositions "accepted"
  | "primary_only"  // non-strict: primary accepted, no scope raised, review round eligible
  | "scope_blocked" // RULE 1: any plugin raised scope — surface to human, no negotiation
  | "no_quorum"     // RULES 2/4/6: hash mismatch or malformed — fail closed
  | "timeout";      // RULE 5: round wall-clock limit exceeded before quorum

/**
 * PolicyMode — the operating mode MultiLlmPlugin was configured with.
 * Mirrors the USESTEADY_LLM_MODE environment variable values.
 */
export type PolicyMode =
  | "claude"        // single Claude only; MultiLlmPlugin not used
  | "multi"         // primary + secondary; unanimity not required
  | "multi-strict"; // primary + secondary; unanimous hash match required

// ─── Normalized decision ──────────────────────────────────────────────────────

/**
 * NormalizedDecision — the canonical, hashable representation of a plugin's response.
 *
 * Two plugins agree if and only if their `hash` values are identical.
 * "Both returned accepted" is NOT consensus. Matching hashes IS.
 *
 * Hash algorithm: SHA-256 of JSON.stringify({ disposition, artifactId,
 *   operationClass, rationaleCategory }) — deterministic, order-stable.
 */
export type NormalizedDecision = {
  readonly disposition:       "accepted" | "refused_scope" | "refused_error";
  readonly artifactId:        string;
  readonly operationClass:    OperationClass;
  readonly rationaleCategory: RationaleCategory;
  readonly hash:              string;
};

// ─── MultiLlmOptions ─────────────────────────────────────────────────────────

/**
 * MultiLlmOptions — configuration for MultiLlmPlugin.
 *
 * primary must be set explicitly. There is no default.
 * The primary's ClaudeDeliveryResponse is always the one returned to the gate.
 */
export type MultiLlmOptions = {
  /** Which plugin label is the authority. Its response is always returned. */
  readonly primary:          "claude" | "openai-compatible";
  /** Operating mode — determines which precedence rules apply. */
  readonly policyMode:       PolicyMode;
  /** Maximum consensus rounds before fail closed. Default: 3. */
  readonly maxRounds:        number;
  /** Per-plugin timeout per round in ms. Default: 15_000. */
  readonly pluginTimeoutMs:  number;
  /** Whole-round wall-clock timeout in ms. Default: 20_000. */
  readonly roundTimeoutMs:   number;
  /** true = multi-strict: unanimous hash match required across all plugins. */
  readonly requireUnanimity: boolean;
};

export const DEFAULT_MULTI_LLM_OPTIONS = {
  maxRounds:        3,
  pluginTimeoutMs:  15_000,
  roundTimeoutMs:   20_000,
  requireUnanimity: false,
} as const satisfies Partial<MultiLlmOptions>;

// ─── ReviewPayload ────────────────────────────────────────────────────────────

export const MAX_OBSERVATION_SUMMARY_CHARS = 500;

/**
 * ReviewPayload — the bounded context passed to plugins on an execution-error review round.
 *
 * Only triggered by execution disagreement (Rule 4), never by scope (Rule 1).
 * observationSummary is hard-capped at MAX_OBSERVATION_SUMMARY_CHARS.
 * No raw conversation history. No unbounded context forwarded between models.
 */
export type ReviewPayload = {
  readonly originalRequestId:      string;
  readonly priorNormalizedOutputs: readonly NormalizedDecision[];
  readonly errorCategory:          "execution_error" | "hash_mismatch";
  readonly observationSummary:     string;
};

export function buildReviewPayload(
  originalRequestId:      string,
  priorNormalizedOutputs: readonly NormalizedDecision[],
  errorCategory:          ReviewPayload["errorCategory"],
  rawObservation:         string,
): ReviewPayload {
  return {
    originalRequestId,
    priorNormalizedOutputs,
    errorCategory,
    observationSummary: rawObservation.slice(0, MAX_OBSERVATION_SUMMARY_CHARS),
  };
}

// ─── ConsensusAuditRecord ─────────────────────────────────────────────────────

/**
 * ParticipantRawPosition — a participating plugin's actual response content,
 * preserved verbatim alongside the normalized/hash fields (P3 Phase 1).
 *
 * The normalized fields (disposition, operationClass, rationaleCategory,
 * normalizedHash) remain the ONLY inputs to consensus. This record is
 * evidence-only: it exists so a later reader can reconstruct what each
 * participant actually returned, without the position being reduced to a hash.
 *
 * NO classification is performed: fields are copied verbatim from the
 * participant's ClaudeDeliveryResponse. Fields absent on the response are
 * omitted entirely (undefined-free rule).
 */
export type ParticipantRawPosition = {
  /** The exact response.kind the participant returned. */
  readonly responseKind:       ClaudeDeliveryResponse["kind"];
  /** accepted: verbatim model text emitted alongside the acceptance. */
  readonly modelText?:         string;
  /** refused_due_to_scope: the scope question kind as returned. */
  readonly scopeQuestionKind?: string;
  /** refused_due_to_scope: the candidate list as returned. */
  readonly scopeCandidates?:   readonly string[];
  /** refused_due_to_scope: the model-authored explanation, verbatim. */
  readonly scopeExplanation?:  string;
  /** refused_due_to_execution_error: the error code as returned. */
  readonly errorCode?:         string;
  /** refused_due_to_execution_error: the message text, verbatim. */
  readonly errorMessage?:      string;
  /** refused_due_to_execution_error: "model" if model-authored, "adapter" if synthesized. */
  readonly messageOrigin?:     "model" | "adapter";
  /**
   * advisory (P3 Phase 2): the structured advisory positions, verbatim.
   * Evidence-only. Multi-LLM consensus still fails closed on advisory kinds;
   * this field preserves what was actually said for the audit trail.
   */
  readonly advisoryPositions?: readonly { readonly kind: string; readonly explanation: string }[];
};

/**
 * extractRawPosition — copies a participant's actual response content into a
 * ParticipantRawPosition. Pure function; no I/O; no interpretation.
 *
 * This function MUST NOT influence normalizeResponse() or evaluatePolicy().
 * It reads the response only to preserve it.
 */
export function extractRawPosition(
  response: ClaudeDeliveryResponse,
): ParticipantRawPosition {
  switch (response.kind) {
    case "accepted":
      return {
        responseKind: response.kind,
        ...(response.modelText !== undefined && response.modelText !== ""
          ? { modelText: response.modelText }
          : {}),
      };
    case "refused_due_to_scope":
      return {
        responseKind:      response.kind,
        scopeQuestionKind: response.question.questionKind,
        scopeCandidates:   [...response.question.candidates],
        ...(response.question.explanation !== undefined && response.question.explanation !== ""
          ? { scopeExplanation: response.question.explanation }
          : {}),
      };
    case "refused_due_to_execution_error":
      return {
        responseKind: response.kind,
        errorCode:    response.code,
        errorMessage: response.message,
        ...(response.messageOrigin !== undefined
          ? { messageOrigin: response.messageOrigin }
          : {}),
      };
    case "advisory":
      return {
        responseKind:      response.kind,
        advisoryPositions: response.positions.map((p) => ({
          kind:        p.kind,
          explanation: p.explanation,
        })),
      };
    default:
      // Unknown kind — preserve only the raw kind tag (fail-closed elsewhere).
      return { responseKind: (response as { kind: string }).kind as ClaudeDeliveryResponse["kind"] };
  }
}

export type ConsensusRoundEntry = {
  readonly roundNumber:         number;
  readonly pluginName:          string;
  readonly disposition:         NormalizedDecision["disposition"];
  readonly operationClass:      OperationClass;
  readonly rationaleCategory:   RationaleCategory;
  readonly normalizedHash:      string;
  readonly disagreementReason?: string;
  readonly durationMs:          number;
  /**
   * OPTIONAL (P3 Phase 1) — the participant's actual response content for this
   * round, preserved verbatim. Evidence-only; never an input to consensus.
   * Absent when the plugin threw or timed out (no response exists to preserve;
   * disagreementReason already captures that failure mode).
   */
  readonly rawPosition?:        ParticipantRawPosition;
};

/**
 * ConsensusAuditRecord — the complete record of a MultiLlmPlugin.receive() call.
 *
 * Not attached to ClaudeDeliveryResponse (that contract is frozen).
 * Written by MultiLlmPlugin to the UCP/friction audit pipeline after every call.
 *
 * Fields for post-incident debugging:
 *   policyMode            — which mode was active
 *   quorumState           — which of the six precedence rules fired
 *   decisionHashPrimary   — primary plugin's NormalizedDecision hash
 *   decisionHashesAll     — per-plugin hash map (plugin name → hash)
 *
 * decisionHashPrimary + decisionHashesAll let you see at a glance whether
 * disagreement was a hash mismatch, a scope signal, or a normalization failure,
 * without re-running the round.
 */
export type ConsensusAuditRecord = {
  readonly requestId:             string;
  readonly primaryPlugin:         string;
  readonly policyMode:            PolicyMode;
  readonly rounds:                readonly ConsensusRoundEntry[];
  readonly finalDisposition:      NormalizedDecision["disposition"] | "none";
  readonly quorumState:           QuorumState;
  readonly strictUnanimityMet:    boolean;
  readonly failedClosedReason?:   string;
  readonly decisionHashPrimary?:  string;
  readonly decisionHashesAll?:    Readonly<Record<string, string>>;
};

// ─── normalizeResponse() ──────────────────────────────────────────────────────

/**
 * normalizeResponse — maps a ClaudeDeliveryResponse to a NormalizedDecision.
 *
 * OperationClass derivation (from artifact.executionDomain):
 *   "code_edit"     → "artifact_delivery"
 *   "ops_task"      → "execution_request"
 *   "analysis_task" → "read_only"
 *   anything else   → "unknown"  (triggers Rule 6 fail closed on primary)
 *
 * RationaleCategory derivation:
 *   accepted              → "execution_feasibility" (task was determined feasible)
 *   refused_due_to_scope  → "scope"
 *   refused_due_to_*_error → inferred from error code prefix where possible,
 *                            else "execution_feasibility"
 *
 * Any value that cannot map to a closed-set member becomes "unknown".
 */
export function normalizeResponse(
  request:  ClaudeDeliveryRequest,
  response: ClaudeDeliveryResponse,
): NormalizedDecision {
  const artifactId = request.artifact.artifactId;
  const domain     = request.artifact.executionDomain;

  switch (response.kind) {
    case "accepted": {
      return buildDecision(
        "accepted",
        artifactId,
        domainToOperationClass(domain),
        "execution_feasibility",
      );
    }

    case "refused_due_to_scope": {
      return buildDecision("refused_scope", artifactId, "scope_question", "scope");
    }

    case "refused_due_to_execution_error": {
      return buildDecision(
        "refused_error",
        artifactId,
        "execution_error",
        errorCodeToRationaleCategory(response.code),
      );
    }

    default: {
      // Unknown response kind — unknown operationClass triggers Rule 6 fail closed on primary.
      return buildDecision("refused_error", artifactId, "unknown", "unknown");
    }
  }
}

function domainToOperationClass(domain: string): OperationClass {
  switch (domain) {
    case "code_edit":     return "artifact_delivery";
    case "ops_task":      return "execution_request";
    case "analysis_task": return "read_only";
    default:              return "unknown";
  }
}

function errorCodeToRationaleCategory(code: string): RationaleCategory {
  if (code.startsWith("safety_"))            return "safety";
  if (code.startsWith("policy_"))            return "policy";
  if (code === "scope_boundary")             return "scope";
  // session_interrupted, tool_denied, plugin_threw, unknown_response_kind → feasibility
  return "execution_feasibility";
}

function buildDecision(
  disposition:       NormalizedDecision["disposition"],
  artifactId:        string,
  operationClass:    OperationClass,
  rationaleCategory: RationaleCategory,
): NormalizedDecision {
  const hash = computeDecisionHash(disposition, artifactId, operationClass, rationaleCategory);
  return { disposition, artifactId, operationClass, rationaleCategory, hash };
}

/**
 * computeDecisionHash — deterministic SHA-256 over the four normalized fields.
 *
 * Uses a positional array (not an object) so key ordering can never vary.
 * All string values are trimmed and lowercased before hashing so that
 * superficial casing or whitespace differences never produce false mismatches.
 *
 * Fixed field order:
 *   [0] disposition
 *   [1] artifactId
 *   [2] operationClass
 *   [3] rationaleCategory
 *
 * No undefined fields. Every element is a non-empty string after normalization.
 */
function computeDecisionHash(
  disposition:       string,
  artifactId:        string,
  operationClass:    string,
  rationaleCategory: string,
): string {
  const normalized = [
    disposition.trim().toLowerCase(),
    artifactId.trim(),                   // content-addressed id — preserve case, trim only
    operationClass.trim().toLowerCase(),
    rationaleCategory.trim().toLowerCase(),
  ];
  return createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");
}

// ─── evaluatePolicy() ─────────────────────────────────────────────────────────

export type PolicyEvaluation =
  | { readonly quorumState: "unanimous" | "primary_only"; readonly decision: NormalizedDecision }
  | { readonly quorumState: "scope_blocked";               readonly decision: NormalizedDecision }
  | { readonly quorumState: "no_quorum" | "timeout";       readonly failReason: string };

/**
 * evaluatePolicy — evaluates normalized decisions under the configured policy options.
 *
 * FAIL-CLOSED PRECEDENCE (evaluated in order — first match wins):
 *
 *   RULE 1: any refused_scope from any plugin
 *     → quorumState = "scope_blocked"
 *     → return scope decision for human to surface
 *     → no review round, no model negotiation
 *     → scope is a governance signal, not a disagreement for models to resolve
 *
 *   RULE 2: strict mode (requireUnanimity = true) + hashes do not match
 *     → quorumState = "no_quorum"
 *     → fail closed
 *
 *   RULE 3: strict mode + all hashes match + all dispositions = "accepted"
 *     → quorumState = "unanimous"
 *     → return primary decision
 *
 *   RULE 4: non-strict mode + primary accepted + no scope raised
 *     (other plugins may have execution errors or hash mismatches)
 *     → if all hashes match: quorumState = "unanimous" → return primary
 *     → if hashes differ:    quorumState = "primary_only" → caller runs one review round
 *     → if review round resolves to unanimous: quorumState = "unanimous"
 *     → if review round does not resolve: quorumState = "no_quorum" → fail closed
 *
 *   RULE 5: timeout (timedOut = true passed by caller)
 *     → quorumState = "timeout"
 *     → fail closed
 *     → checked before partial results to be authoritative
 *
 *   RULE 6: malformed normalization — "unknown" operationClass or rationaleCategory on primary
 *     → quorumState = "no_quorum"
 *     → fail closed
 *     → unknown on non-primary does not trigger this rule alone
 *
 *   RULE 6b: empty agreement — ALL decisions hash-match but every decision has
 *     operationClass = "unknown" AND rationaleCategory = "unknown"
 *     → quorumState = "no_quorum"
 *     → fail closed
 *     → "agreement on ignorance" is not valid consensus
 *     → Rule 6 catches unknown on primary; Rule 6b catches the case where
 *       primary somehow passed Rule 6 but all plugins converged on unknown
 *
 * This precedence is the only valid reading. It must not be inferable differently
 * from the code or the comments above.
 */
export function evaluatePolicy(
  decisions:       readonly NormalizedDecision[],
  primaryDecision: NormalizedDecision,
  options:         Pick<MultiLlmOptions, "requireUnanimity">,
  timedOut:        boolean = false,
): PolicyEvaluation {

  // RULE 5: timeout — checked first; a timeout is authoritative regardless of partial results
  if (timedOut) {
    return {
      quorumState: "timeout",
      failReason:  "Round wall-clock limit exceeded before quorum was reached.",
    };
  }

  // RULE 6: malformed normalization on primary — unknown values cannot participate in consensus
  if (
    primaryDecision.operationClass    === "unknown" ||
    primaryDecision.rationaleCategory === "unknown"
  ) {
    return {
      quorumState: "no_quorum",
      failReason:
        `Primary produced "unknown" ${
          primaryDecision.operationClass === "unknown" ? "operationClass" : "rationaleCategory"
        }. Malformed normalization — fail closed.`,
    };
  }

  // RULE 6b: empty agreement — all decisions unknown/unknown (agreement on ignorance)
  // Rule 6 already blocks unknown on primary; this catches the defense-in-depth case
  // where all plugins independently converged on unknown fields and therefore hash-match.
  if (
    decisions.length > 0 &&
    decisions.every(
      (d) => d.operationClass === "unknown" && d.rationaleCategory === "unknown",
    )
  ) {
    return {
      quorumState: "no_quorum",
      failReason:
        "All plugins produced operationClass='unknown' and rationaleCategory='unknown'. " +
        "Agreement on ignorance is not valid consensus — fail closed.",
    };
  }

  // RULE 1: any refused_scope from any plugin — immediate stop, surface to human
  const scopeDecision = decisions.find((d) => d.disposition === "refused_scope");
  if (scopeDecision !== undefined) {
    return { quorumState: "scope_blocked", decision: scopeDecision };
  }

  const allHashesMatch = decisions.length > 0 &&
    decisions.every((d) => d.hash === primaryDecision.hash);

  // RULE 2: strict mode + hash mismatch
  if (options.requireUnanimity && !allHashesMatch) {
    const mismatches = decisions
      .filter((d) => d.hash !== primaryDecision.hash)
      .map((d) => `${d.operationClass}/${d.rationaleCategory}`)
      .join(", ");
    return {
      quorumState: "no_quorum",
      failReason:
        `Strict mode requires unanimous hash. Non-matching decision(s): [${mismatches}].`,
    };
  }

  // RULE 3: strict mode + unanimous accepted
  if (
    options.requireUnanimity &&
    allHashesMatch &&
    decisions.every((d) => d.disposition === "accepted")
  ) {
    return { quorumState: "unanimous", decision: primaryDecision };
  }

  // RULE 4: non-strict + primary accepted + no scope raised (Rule 1 already cleared)
  if (!options.requireUnanimity && primaryDecision.disposition === "accepted") {
    if (allHashesMatch) {
      return { quorumState: "unanimous", decision: primaryDecision };
    }
    // Hashes differ — signal caller to run one bounded review round
    return { quorumState: "primary_only", decision: primaryDecision };
  }

  // Catch-all: primary did not accept, no scope signal, no accepted path open
  return {
    quorumState: "no_quorum",
    failReason:
      `Primary disposition is "${primaryDecision.disposition}" with no scope signal ` +
      `and no accepted path available.`,
  };
}
