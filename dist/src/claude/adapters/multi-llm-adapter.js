/**
 * MultiLlmPlugin — multi-LLM consensus adapter.
 *
 * ── Role ──────────────────────────────────────────────────────────────────────
 *
 *   Implements ClaudeAgentPlugin. Fans out a single ClaudeDeliveryRequest to
 *   multiple inner plugins, runs bounded consensus rounds under evaluatePolicy(),
 *   and returns the primary plugin's ClaudeDeliveryResponse.
 *
 *   The gate contract is unchanged. ClaudeDeliveryGate still calls plugin.receive()
 *   exactly as documented. This adapter is transparent to the gate.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────────
 *
 *   NOT a planner. Task specs are fixed at WorkflowSpec definition time.
 *   NOT an authority. Human approval is still required before delivery reaches here.
 *   NOT a conversation thread. Plugins do not share message history with each other.
 *
 * ── Consensus definition ──────────────────────────────────────────────────────
 *
 *   Consensus is NOT "multiple plugins returned accepted."
 *   Consensus is: all plugins produced matching NormalizedDecision.hash values.
 *   See evaluatePolicy() in multi-llm-types.ts — six-rule fail-closed precedence.
 *
 * ── Primary plugin ────────────────────────────────────────────────────────────
 *
 *   MultiLlmOptions.primary determines which plugin's ClaudeDeliveryResponse is
 *   returned to the gate. The primary is never selected by position.
 *   Non-primary plugins are used for consensus validation only.
 *
 * ── Audit record ──────────────────────────────────────────────────────────────
 *
 *   Every receive() call writes a ConsensusAuditRecord (INV-ML-6). P4: the
 *   record is appended to a durable JSONL sink (consensus-audit.jsonl under
 *   the resolved store dir; see consensus-audit-sink.ts) AND mirrored to
 *   process.stderr as a diagnostic line (prefixed "[consensus-audit]"). Both
 *   channels are best-effort — failures do not affect the returned
 *   ClaudeDeliveryResponse. Consensus rules and hashes are unchanged.
 *
 *   The quorumState and policyMode fields in the record are the two fields that
 *   make post-incident debugging tractable.
 *
 * See: src/claude/adapters/multi-llm-types.ts — types and evaluatePolicy()
 */
import { normalizeResponse, evaluatePolicy, buildReviewPayload, extractRawPosition, DEFAULT_MULTI_LLM_OPTIONS, } from "./multi-llm-types.js";
import { appendConsensusAuditRecord, resolveConsensusAuditDir, } from "./consensus-audit-sink.js";
// ─── MultiLlmPlugin ───────────────────────────────────────────────────────────
/**
 * MultiLlmPlugin — ClaudeAgentPlugin that runs consensus across multiple plugins.
 *
 * Construction:
 *   const multi = new MultiLlmPlugin(
 *     { name: "claude", plugin: claudeAdapter },
 *     [{ name: "openai-compatible", plugin: openAiAdapter }],
 *     { primary: "claude", policyMode: "multi", requireUnanimity: false, ... },
 *   );
 *
 * The primaryPlugin entry must match options.primary.
 * The gate calls multi.receive() exactly as it would any ClaudeAgentPlugin.
 */
export class MultiLlmPlugin {
    primaryEntry;
    secondaryPlugins;
    options;
    constructor(primaryEntry, secondaryPlugins, options) {
        this.primaryEntry = primaryEntry;
        this.secondaryPlugins = secondaryPlugins;
        this.options = { ...DEFAULT_MULTI_LLM_OPTIONS, ...options };
    }
    async receive(request) {
        const allPlugins = [this.primaryEntry, ...this.secondaryPlugins];
        const rounds = [];
        let finalResponse;
        let finalEvaluation;
        // Snapshot of hashes from the last completed round — carried through to every audit write.
        let lastHashPrimary;
        let lastHashesAll = {};
        for (let roundNum = 1; roundNum <= this.options.maxRounds; roundNum++) {
            const { results, timedOut } = await this.runRound(allPlugins, request, roundNum, rounds);
            const primaryResult = results.get(this.primaryEntry.name);
            if (primaryResult === undefined) {
                // Primary plugin failed or timed out — fail closed
                const failRecord = {
                    requestId: request.deliveryId,
                    primaryPlugin: this.primaryEntry.name,
                    policyMode: this.options.policyMode,
                    rounds,
                    finalDisposition: "none",
                    quorumState: timedOut ? "timeout" : "no_quorum",
                    strictUnanimityMet: false,
                    failedClosedReason: timedOut
                        ? "Primary plugin did not respond before round wall-clock limit."
                        : "Primary plugin failed to return a response this round.",
                    ...hashAuditFields(lastHashPrimary, lastHashesAll),
                };
                writeAudit(failRecord);
                return {
                    kind: "refused_due_to_execution_error",
                    code: timedOut ? "consensus_timeout" : "primary_plugin_failed",
                    message: failRecord.failedClosedReason,
                    messageOrigin: "adapter",
                };
            }
            const allDecisions = Array.from(results.entries()).map(([, r]) => normalizeResponse(request, r.response));
            const primaryDecision = normalizeResponse(request, primaryResult.response);
            // Update hash snapshot for this round
            lastHashPrimary = primaryDecision.hash;
            lastHashesAll = extractHashMap(results, (r) => normalizeResponse(request, r.response).hash);
            const evaluation = evaluatePolicy(allDecisions, primaryDecision, this.options, timedOut);
            finalResponse = primaryResult.response;
            finalEvaluation = evaluation;
            // ── RULE 1: scope_blocked — stop immediately, surface to human ────────
            if (evaluation.quorumState === "scope_blocked") {
                // Find and return the original scope response (not the primary's)
                const scopeResponse = this.findScopeResponse(results);
                const record = {
                    requestId: request.deliveryId,
                    primaryPlugin: this.primaryEntry.name,
                    policyMode: this.options.policyMode,
                    rounds,
                    finalDisposition: "refused_scope",
                    quorumState: "scope_blocked",
                    strictUnanimityMet: false,
                    failedClosedReason: "Scope question raised — surfaced to human without model negotiation.",
                    ...hashAuditFields(lastHashPrimary, lastHashesAll),
                };
                writeAudit(record);
                return scopeResponse ?? primaryResult.response;
            }
            // ── RULES 2/5/6: fail closed ──────────────────────────────────────────
            if (evaluation.quorumState === "no_quorum" ||
                evaluation.quorumState === "timeout") {
                if (roundNum < this.options.maxRounds) {
                    // Not the last round — continue to next round
                    continue;
                }
                const record = {
                    requestId: request.deliveryId,
                    primaryPlugin: this.primaryEntry.name,
                    policyMode: this.options.policyMode,
                    rounds,
                    finalDisposition: primaryDecision.disposition,
                    quorumState: evaluation.quorumState,
                    strictUnanimityMet: false,
                    failedClosedReason: evaluation.failReason,
                    ...hashAuditFields(lastHashPrimary, lastHashesAll),
                };
                writeAudit(record);
                return {
                    kind: "refused_due_to_execution_error",
                    code: evaluation.quorumState === "timeout"
                        ? "consensus_timeout"
                        : "consensus_no_quorum",
                    message: evaluation.failReason,
                    messageOrigin: "adapter",
                };
            }
            // ── RULE 3 / unanimous RULE 4 ─────────────────────────────────────────
            if (evaluation.quorumState === "unanimous") {
                const record = {
                    requestId: request.deliveryId,
                    primaryPlugin: this.primaryEntry.name,
                    policyMode: this.options.policyMode,
                    rounds,
                    finalDisposition: primaryDecision.disposition,
                    quorumState: "unanimous",
                    strictUnanimityMet: this.options.requireUnanimity,
                    ...hashAuditFields(lastHashPrimary, lastHashesAll),
                };
                writeAudit(record);
                return primaryResult.response;
            }
            // ── RULE 4 (primary_only) — one bounded review round allowed ─────────
            if (evaluation.quorumState === "primary_only") {
                const reviewRequest = buildReviewRequest(request, allDecisions, "hash_mismatch");
                const { results: reviewResults, timedOut: reviewTimedOut } = await this.runRound(allPlugins, reviewRequest, roundNum + 0.5, rounds);
                const reviewPrimaryResult = reviewResults.get(this.primaryEntry.name);
                if (reviewPrimaryResult === undefined || reviewTimedOut) {
                    const record = {
                        requestId: request.deliveryId,
                        primaryPlugin: this.primaryEntry.name,
                        policyMode: this.options.policyMode,
                        rounds,
                        finalDisposition: primaryDecision.disposition,
                        quorumState: reviewTimedOut ? "timeout" : "no_quorum",
                        strictUnanimityMet: false,
                        failedClosedReason: "Review round failed — primary did not respond.",
                        ...hashAuditFields(lastHashPrimary, lastHashesAll),
                    };
                    writeAudit(record);
                    return {
                        kind: "refused_due_to_execution_error",
                        code: "consensus_review_failed",
                        message: record.failedClosedReason,
                        messageOrigin: "adapter",
                    };
                }
                const reviewDecisions = Array.from(reviewResults.values()).map((r) => normalizeResponse(reviewRequest, r.response));
                const reviewPrimaryDecision = normalizeResponse(reviewRequest, reviewPrimaryResult.response);
                const reviewHashPrimary = reviewPrimaryDecision.hash;
                const reviewHashesAll = extractHashMap(reviewResults, (r) => normalizeResponse(reviewRequest, r.response).hash);
                const reviewEval = evaluatePolicy(reviewDecisions, reviewPrimaryDecision, this.options, reviewTimedOut);
                if (reviewEval.quorumState === "unanimous") {
                    const record = {
                        requestId: request.deliveryId,
                        primaryPlugin: this.primaryEntry.name,
                        policyMode: this.options.policyMode,
                        rounds,
                        finalDisposition: reviewPrimaryDecision.disposition,
                        quorumState: "unanimous",
                        strictUnanimityMet: false,
                        ...hashAuditFields(reviewHashPrimary, reviewHashesAll),
                    };
                    writeAudit(record);
                    return reviewPrimaryResult.response;
                }
                // Review round did not resolve — fail closed
                // Detect capability split: primary accepted, secondary had execution errors (not scope/safety)
                const capSplit = isCapabilitySplit(rounds, this.primaryEntry.name);
                const failedClosedReason = "failReason" in reviewEval
                    ? reviewEval.failReason
                    : "Review round did not produce unanimous consensus.";
                const record = {
                    requestId: request.deliveryId,
                    primaryPlugin: this.primaryEntry.name,
                    policyMode: this.options.policyMode,
                    rounds,
                    finalDisposition: reviewPrimaryDecision.disposition,
                    quorumState: "no_quorum",
                    strictUnanimityMet: false,
                    failedClosedReason,
                    ...hashAuditFields(reviewHashPrimary, reviewHashesAll),
                };
                writeAudit(record);
                return {
                    kind: "refused_due_to_execution_error",
                    code: capSplit ? "consensus_capability_split" : "consensus_no_quorum",
                    message: failedClosedReason,
                    messageOrigin: "adapter",
                };
            }
        }
        // Exhausted all rounds without a terminal state — fail closed
        const record = {
            requestId: request.deliveryId,
            primaryPlugin: this.primaryEntry.name,
            policyMode: this.options.policyMode,
            rounds,
            finalDisposition: finalEvaluation !== undefined && "decision" in finalEvaluation
                ? finalEvaluation.decision.disposition
                : "none",
            quorumState: "no_quorum",
            strictUnanimityMet: false,
            ...hashAuditFields(lastHashPrimary, lastHashesAll),
            failedClosedReason: `Exhausted ${this.options.maxRounds} round(s) without quorum.`,
        };
        writeAudit(record);
        return {
            kind: "refused_due_to_execution_error",
            code: "consensus_no_quorum",
            message: record.failedClosedReason,
            messageOrigin: "adapter",
        };
    }
    // ─── Round execution ───────────────────────────────────────────────────────
    async runRound(plugins, request, roundNum, rounds) {
        const roundAbort = new AbortController();
        const roundTimer = setTimeout(() => roundAbort.abort(), this.options.roundTimeoutMs);
        const calls = plugins.map((named) => this.callWithTimeout(named, request, roundNum, rounds, roundAbort.signal));
        const settled = await Promise.allSettled(calls);
        clearTimeout(roundTimer);
        const results = new Map();
        let timedOut = false;
        for (const outcome of settled) {
            if (outcome.status === "rejected") {
                // callWithTimeout caught and recorded the error — timeout or plugin threw
                if (outcome.reason.isTimeout === true) {
                    timedOut = true;
                }
                continue;
            }
            if (outcome.value !== null) {
                results.set(outcome.value.name, {
                    response: outcome.value.response,
                    durationMs: outcome.value.durationMs,
                });
            }
        }
        return { results, timedOut };
    }
    async callWithTimeout(named, request, roundNum, rounds, roundSignal) {
        const start = Date.now();
        const pluginAbort = new AbortController();
        const pluginTimer = setTimeout(() => pluginAbort.abort(), this.options.pluginTimeoutMs);
        // Abort the per-plugin timeout if the round-level abort fires first
        roundSignal.addEventListener("abort", () => pluginAbort.abort(), { once: true });
        try {
            const responsePromise = named.plugin.receive(request);
            // Race the plugin against the per-plugin abort
            const response = await Promise.race([
                responsePromise,
                new Promise((_, reject) => pluginAbort.signal.addEventListener("abort", () => {
                    const err = new Error(`Plugin "${named.name}" did not respond within ${this.options.pluginTimeoutMs} ms.`);
                    err.isTimeout = true;
                    reject(err);
                }, { once: true })),
            ]);
            clearTimeout(pluginTimer);
            const durationMs = Date.now() - start;
            const decision = normalizeResponse(request, response);
            rounds.push({
                roundNumber: Math.floor(roundNum),
                pluginName: named.name,
                disposition: decision.disposition,
                operationClass: decision.operationClass,
                rationaleCategory: decision.rationaleCategory,
                normalizedHash: decision.hash,
                // P3 Phase 1: preserve the participant's actual position verbatim,
                // alongside (never inside) the normalized consensus inputs.
                rawPosition: extractRawPosition(response),
                durationMs,
            });
            return { name: named.name, response, durationMs };
        }
        catch (err) {
            clearTimeout(pluginTimer);
            const durationMs = Date.now() - start;
            const isTimeout = err.isTimeout === true ||
                roundSignal.aborted;
            rounds.push({
                roundNumber: Math.floor(roundNum),
                pluginName: named.name,
                disposition: "refused_error",
                operationClass: "execution_error",
                rationaleCategory: "execution_feasibility",
                normalizedHash: "",
                disagreementReason: isTimeout
                    ? `Timed out after ${durationMs} ms`
                    : `Plugin threw: ${err instanceof Error ? err.message : String(err)}`,
                durationMs,
            });
            const tagged = new Error(isTimeout ? "Plugin timed out" : String(err));
            tagged.isTimeout = isTimeout;
            throw tagged;
        }
    }
    // ─── Helpers ───────────────────────────────────────────────────────────────
    findScopeResponse(results) {
        for (const { response } of results.values()) {
            if (response.kind === "refused_due_to_scope")
                return response;
        }
        return undefined;
    }
}
// ─── Review request builder ───────────────────────────────────────────────────
/**
 * Build a review-round ClaudeDeliveryRequest from the original request.
 *
 * The review payload is embedded in the taskSpec.summary to stay within the
 * existing ClaudeDeliveryRequest shape (the type is frozen).
 * The observationSummary is bounded at MAX_OBSERVATION_SUMMARY_CHARS.
 */
function buildReviewRequest(original, priorOutputs, errorCategory) {
    const payload = buildReviewPayload(original.deliveryId, priorOutputs, errorCategory, `Prior dispositions: ${priorOutputs.map((d) => d.disposition).join(", ")}. ` +
        `Hash agreement: ${new Set(priorOutputs.map((d) => d.hash)).size === 1 ? "yes" : "no"}.`);
    return {
        ...original,
        artifact: {
            ...original.artifact,
            taskSpec: {
                ...original.artifact.taskSpec,
                summary: `[REVIEW ROUND] ${original.artifact.taskSpec.summary}\n` +
                    `Review context: ${payload.observationSummary}`,
            },
        },
    };
}
// ─── Capability split detector ───────────────────────────────────────────────
/**
 * Returns true when the round data indicates a capability split:
 *   - primary plugin accepted in round 1
 *   - all secondary plugins had execution_error (not scope, not safety refusal)
 *
 * This signals a feasibility/capability gap in the secondary model, not a
 * governance disagreement. It changes the user-facing failure message so
 * they understand it is not a safety veto.
 */
function isCapabilitySplit(rounds, primaryPlugin) {
    const primaryRound1 = rounds.find(r => r.pluginName === primaryPlugin && r.roundNumber === 1);
    if (!primaryRound1 || primaryRound1.disposition !== "accepted")
        return false;
    const secondaryRound1 = rounds.filter(r => r.pluginName !== primaryPlugin && r.roundNumber === 1);
    if (secondaryRound1.length === 0)
        return false;
    return secondaryRound1.every(r => r.operationClass === "execution_error" || r.disposition === "refused_error");
}
// ─── Audit helpers ────────────────────────────────────────────────────────────
function writeAudit(record) {
    // P4: durable first — append the record to the append-only JSONL sink so the
    // INV-ML-6 record survives process exit. Best-effort: a sink failure never
    // affects the response path. Consensus semantics are unchanged; this is the
    // same record previously written to stderr only.
    try {
        appendConsensusAuditRecord(resolveConsensusAuditDir(), record);
    }
    catch {
        // Best-effort — do not throw, do not affect response
    }
    // Diagnostic side channel (retained): the same record as a stderr line.
    try {
        process.stderr.write(`[consensus-audit] ${JSON.stringify(record)}\n`);
    }
    catch {
        // Best-effort — do not throw, do not affect response
    }
}
/**
 * extractHashMap — builds a pluginName → hash map from a results snapshot.
 *
 * Used to populate ConsensusAuditRecord.decisionHashesAll so that disagreements
 * can be diagnosed directly from the audit record without re-running the round.
 */
function extractHashMap(results, getHash) {
    const map = {};
    for (const [name, result] of results.entries()) {
        map[name] = getHash(result);
    }
    return map;
}
/**
 * hashAuditFields — returns optional hash fields for a ConsensusAuditRecord.
 *
 * Uses exactOptionalPropertyTypes-safe conditional object construction:
 * fields are only present when they have a meaningful value. Spreading `undefined`
 * or an empty map would conflict with exactOptionalPropertyTypes = true.
 */
function hashAuditFields(primary, all) {
    const out = {};
    if (primary !== undefined && primary !== "")
        out.decisionHashPrimary = primary;
    if (Object.keys(all).length > 0)
        out.decisionHashesAll = all;
    return out;
}
//# sourceMappingURL=multi-llm-adapter.js.map