/**
 * Observation & Certification stage — spine port v1.
 *
 * ── Design principle: honesty over optimism ────────────────────────────────
 *
 *   There is NO real-world reality sensor wired into the kernel. A port that
 *   claimed `realityVerdict: "agree"` without a real probe would be
 *   fabricating a verdict — a governance violation of the gauge law:
 *   "invented is unrepresentable."
 *
 *   Therefore `realityVerdict` is ALWAYS "unknown" unless a RealityProbe is
 *   explicitly injected. The default export (`observationPort`) uses
 *   `makeObservationPort(null)` — honest: no sensor, reality unknown.
 *
 * ── Gauge law ───────────────────────────────────────────────────────────────
 *
 *   "connected"   → not used here; observation is a derivation from execution,
 *                   not a direct sensor result.
 *   "derived"     → a connected execution section was found and observed.
 *                   `derivedFrom: ["execution"]` makes the provenance explicit.
 *   "unavailable" → one of: no execution section in prior, or execution not
 *                   connected (nothing happened to observe), or unexpected
 *                   error. Reason is explicit in each case.
 *
 * ── feedsNextCycle rule (precisely documented) ──────────────────────────────
 *
 *   `feedsNextCycle === true` IFF:
 *     1. `intendedVsActual === "match"`  (execution ran what was approved), AND
 *     2. `realityVerdict === "agree"`    (reality was independently verified
 *                                         to agree with the outcome)
 *
 *   A deviation, a reality disagreement, OR an UNRESOLVED reality verdict MUST
 *   set `feedsNextCycle = false`. Feeding a divergent, reality-contradicted,
 *   or reality-unverified observation into the next cycle's Decision Basis as
 *   a low-authority claim would pollute the basis with potentially false prior
 *   information.
 *
 *   `realityVerdict === "unknown"` (no probe wired, stale read, observer
 *   unavailable, exhausted read budget) BLOCKS feeding — an unresolved
 *   observation must not become a verified factual basis for the next governed
 *   cycle. Absence of contradiction is silence, not verification
 *   (docs/architecture/TRUTH_ARBITRATION.md: "Verification means the
 *   higher-authority source was consulted and its value matches the claim. It
 *   does not mean the higher-authority source did not contradict.").
 *
 *   (Spine-semantics correction, USESTEADY_EXTERNAL_API_WRITE_CERTIFICATION_V1
 *   section 0: the prior rule fed on `realityVerdict !== "disagree"`, treating
 *   probe silence as sufficient basis. Over an external authority boundary
 *   "unknown" is a normal transient state, so silence-as-feed would launder
 *   uncertainty into the next cycle's basis. The correction is surface-
 *   agnostic: it names no adapter, provider, or transport.)
 *
 * ── Loop guardrail (enforced upstream, NOT here) ───────────────────────────
 *
 *   This stage sets `feedsNextCycle` honestly. The enforcement of the loop
 *   guardrail — that the observation feeds the NEXT cycle's Decision Basis
 *   ONLY (never authority or execution), and is arbitrated as a CLAIM, not a
 *   truth — is enforced structurally in:
 *
 *     pipeline.ts  → `eligiblePrior` gate (feedsNextCycle check); only the
 *                    `decisionBasis` port receives `priorObservation`.
 *     truth-arbitration.ts → records the "unarbitrated CLAIM" conflict when
 *                    basis evidence is "derived" from a prior observation.
 *
 *   This stage does not and must not re-implement that enforcement. Its
 *   responsibility is accurate, honest observation only.
 *
 * ── Never throws ────────────────────────────────────────────────────────────
 *
 *   Unexpected errors are caught and degrade the section to unavailable so
 *   the spine is never thrown into.
 */
// ─── whatHappened builder ─────────────────────────────────────────────────────
/**
 * Produce a concise, factual summary of the execution result.
 * Does not editorialize. States count, approval alignment, and determinism flag.
 */
function buildWhatHappened(execution) {
    const stepCount = execution.steps.length;
    const approvedLabel = execution.ranWhatWasApproved ? "yes" : "no";
    const deterministicLabel = execution.deterministic ? "yes" : "no";
    return (`Executed ${stepCount} step(s); ` +
        `ranWhatWasApproved: ${approvedLabel}; ` +
        `deterministic: ${deterministicLabel}.`);
}
// ─── Factory ──────────────────────────────────────────────────────────────────
/**
 * Create an observation port from an optional reality probe.
 *
 * Why a factory?
 *   The reality probe is an external seam (like the executor in execution.ts
 *   and the human decision in ratification.ts). Capturing it at construction
 *   time keeps the port signature
 *   `(ctx: BaseStageContext) => Promise<DecisionSection<ObservationPayload>>`
 *   without leaking probe wiring into the spine.
 *
 * Port behavior:
 *
 *   1. `ctx.prior.execution` is absent or not "connected"
 *      → unavailable: "cannot observe: no connected execution to observe"
 *      Nothing happened — there is nothing to observe.
 *
 *   2. Execution is connected
 *      → derived (derivedFrom ["execution"]):
 *        • `whatHappened`      — factual summary (steps, approval, determinism)
 *        • `intendedVsActual`  — "match" when ranWhatWasApproved, else "deviation"
 *        • `realityVerdict`    — if probe is null → "unknown" (honest default);
 *                                else the probe's verdict (never fabricated)
 *        • `feedsNextCycle`    — TRUE when intendedVsActual === "match" AND
 *                                realityVerdict === "agree" (see rule above)
 *
 *   3. Any unexpected error → unavailable with the error message.
 */
export function makeObservationPort(realityProbe) {
    return async (ctx) => {
        try {
            // ── Guard: execution must be connected ──────────────────────────────────
            const execution = ctx.prior.execution;
            if (execution === undefined || execution.status !== "connected") {
                return {
                    status: "unavailable",
                    reason: "cannot observe: no connected execution to observe",
                };
            }
            const executionValue = execution.value;
            // ── whatHappened: factual summary, no editorialising ──────────────────
            const whatHappened = buildWhatHappened(executionValue);
            // ── intendedVsActual: structural derivation from ranWhatWasApproved ───
            const intendedVsActual = executionValue.ranWhatWasApproved
                ? "match"
                : "deviation";
            // ── realityVerdict: honest "unknown" unless a probe is wired ──────────
            // Never fabricate: if no probe is injected, we have no sensor for reality.
            // When a probe IS wired we capture both its verdict AND its explanation —
            // the detail explains the verdict, it does not set it (gauge law).
            // Await supports both sync (filesystem) and async (remote/REST source-
            // control) probes; awaiting a sync return value is a no-op.
            const probeResult = realityProbe === null ? null : await realityProbe(executionValue);
            const realityVerdict = probeResult === null ? "unknown" : probeResult.realityVerdict;
            const realityDetail = probeResult !== null && typeof probeResult.detail === "string"
                ? probeResult.detail
                : undefined;
            // Collateral account (Collateral Mutation Closure V1): relayed verbatim
            // when the probe produced one; absent otherwise — never fabricated here.
            const scopeObservation = probeResult !== null && probeResult.scopeObservation !== undefined
                ? probeResult.scopeObservation
                : undefined;
            // ── feedsNextCycle: precise rule (see file header) ────────────────────
            // TRUE IFF execution matched the approved plan AND reality was verified
            // to agree. A deviation, a disagreement, or an UNRESOLVED verdict must
            // NOT feed the next cycle: silence is not verification, so "unknown"
            // reality (no probe / stale read / observer unavailable) blocks feeding.
            const feedsNextCycle = intendedVsActual === "match" && realityVerdict === "agree";
            return {
                status: "derived",
                value: {
                    whatHappened,
                    intendedVsActual,
                    realityVerdict,
                    // ABSENT (not "") when no probe / no detail — gauge law: never fabricate.
                    ...(realityDetail !== undefined ? { realityDetail } : {}),
                    ...(scopeObservation !== undefined ? { scopeObservation } : {}),
                    feedsNextCycle,
                },
                derivedFrom: ["execution"],
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                status: "unavailable",
                reason: `observation stage failed unexpectedly: ${message}`,
            };
        }
    };
}
// ─── Reference probe ──────────────────────────────────────────────────────────
/**
 * Reference probe that always agrees.
 *
 * For tests and illustration only. In production, inject a real probe that
 * actually verifies the expected post-execution state against the real world
 * (e.g. confirms the filesystem reflects what was executed).
 *
 * This probe carries no authority: it is injected, not built into the kernel.
 * A calling layer that uses this probe in production is making an explicit
 * decision to skip real verification — the kernel records it faithfully.
 */
export const agreeingRealityProbe = () => ({ realityVerdict: "agree" });
// ─── Default export (honest: reality unknown) ─────────────────────────────────
/**
 * The honest default: no reality probe wired → realityVerdict is "unknown".
 *
 * The spine already produces a fully-executed record when the execution section
 * is connected. The observation section is derived from that execution with an
 * honest admission that we cannot certify whether reality agreed — because no
 * probe has been injected to verify it.
 *
 * `feedsNextCycle` is `false` whenever `realityVerdict === "unknown"` — an
 * unresolved observation is not a verified basis for the next cycle. See the
 * feedsNextCycle rule in the file header for the precise conditions.
 */
export const observationPort = makeObservationPort(null);
//# sourceMappingURL=observation.js.map