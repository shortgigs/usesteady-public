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
export const DEFAULT_MULTI_LLM_OPTIONS = {
    maxRounds: 3,
    pluginTimeoutMs: 15_000,
    roundTimeoutMs: 20_000,
    requireUnanimity: false,
};
// ─── ReviewPayload ────────────────────────────────────────────────────────────
export const MAX_OBSERVATION_SUMMARY_CHARS = 500;
export function buildReviewPayload(originalRequestId, priorNormalizedOutputs, errorCategory, rawObservation) {
    return {
        originalRequestId,
        priorNormalizedOutputs,
        errorCategory,
        observationSummary: rawObservation.slice(0, MAX_OBSERVATION_SUMMARY_CHARS),
    };
}
/**
 * extractRawPosition — copies a participant's actual response content into a
 * ParticipantRawPosition. Pure function; no I/O; no interpretation.
 *
 * This function MUST NOT influence normalizeResponse() or evaluatePolicy().
 * It reads the response only to preserve it.
 */
export function extractRawPosition(response) {
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
                responseKind: response.kind,
                scopeQuestionKind: response.question.questionKind,
                scopeCandidates: [...response.question.candidates],
                ...(response.question.explanation !== undefined && response.question.explanation !== ""
                    ? { scopeExplanation: response.question.explanation }
                    : {}),
            };
        case "refused_due_to_execution_error":
            return {
                responseKind: response.kind,
                errorCode: response.code,
                errorMessage: response.message,
                ...(response.messageOrigin !== undefined
                    ? { messageOrigin: response.messageOrigin }
                    : {}),
            };
        case "advisory":
            return {
                responseKind: response.kind,
                advisoryPositions: response.positions.map((p) => ({
                    kind: p.kind,
                    explanation: p.explanation,
                })),
            };
        default:
            // Unknown kind — preserve only the raw kind tag (fail-closed elsewhere).
            return { responseKind: response.kind };
    }
}
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
export function normalizeResponse(request, response) {
    const artifactId = request.artifact.artifactId;
    const domain = request.artifact.executionDomain;
    switch (response.kind) {
        case "accepted": {
            return buildDecision("accepted", artifactId, domainToOperationClass(domain), "execution_feasibility");
        }
        case "refused_due_to_scope": {
            return buildDecision("refused_scope", artifactId, "scope_question", "scope");
        }
        case "refused_due_to_execution_error": {
            return buildDecision("refused_error", artifactId, "execution_error", errorCodeToRationaleCategory(response.code));
        }
        default: {
            // Unknown response kind — unknown operationClass triggers Rule 6 fail closed on primary.
            return buildDecision("refused_error", artifactId, "unknown", "unknown");
        }
    }
}
function domainToOperationClass(domain) {
    switch (domain) {
        case "code_edit": return "artifact_delivery";
        case "ops_task": return "execution_request";
        case "analysis_task": return "read_only";
        default: return "unknown";
    }
}
function errorCodeToRationaleCategory(code) {
    if (code.startsWith("safety_"))
        return "safety";
    if (code.startsWith("policy_"))
        return "policy";
    if (code === "scope_boundary")
        return "scope";
    // session_interrupted, tool_denied, plugin_threw, unknown_response_kind → feasibility
    return "execution_feasibility";
}
function buildDecision(disposition, artifactId, operationClass, rationaleCategory) {
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
function computeDecisionHash(disposition, artifactId, operationClass, rationaleCategory) {
    const normalized = [
        disposition.trim().toLowerCase(),
        artifactId.trim(), // content-addressed id — preserve case, trim only
        operationClass.trim().toLowerCase(),
        rationaleCategory.trim().toLowerCase(),
    ];
    return createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex");
}
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
export function evaluatePolicy(decisions, primaryDecision, options, timedOut = false) {
    // RULE 5: timeout — checked first; a timeout is authoritative regardless of partial results
    if (timedOut) {
        return {
            quorumState: "timeout",
            failReason: "Round wall-clock limit exceeded before quorum was reached.",
        };
    }
    // RULE 6: malformed normalization on primary — unknown values cannot participate in consensus
    if (primaryDecision.operationClass === "unknown" ||
        primaryDecision.rationaleCategory === "unknown") {
        return {
            quorumState: "no_quorum",
            failReason: `Primary produced "unknown" ${primaryDecision.operationClass === "unknown" ? "operationClass" : "rationaleCategory"}. Malformed normalization — fail closed.`,
        };
    }
    // RULE 6b: empty agreement — all decisions unknown/unknown (agreement on ignorance)
    // Rule 6 already blocks unknown on primary; this catches the defense-in-depth case
    // where all plugins independently converged on unknown fields and therefore hash-match.
    if (decisions.length > 0 &&
        decisions.every((d) => d.operationClass === "unknown" && d.rationaleCategory === "unknown")) {
        return {
            quorumState: "no_quorum",
            failReason: "All plugins produced operationClass='unknown' and rationaleCategory='unknown'. " +
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
            failReason: `Strict mode requires unanimous hash. Non-matching decision(s): [${mismatches}].`,
        };
    }
    // RULE 3: strict mode + unanimous accepted
    if (options.requireUnanimity &&
        allHashesMatch &&
        decisions.every((d) => d.disposition === "accepted")) {
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
        failReason: `Primary disposition is "${primaryDecision.disposition}" with no scope signal ` +
            `and no accepted path available.`,
    };
}
//# sourceMappingURL=multi-llm-types.js.map