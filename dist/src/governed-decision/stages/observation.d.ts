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
import type { DecisionSection, ExecutionPayload, ObservationPayload, ScopeObservation } from "../types.js";
import type { BaseStageContext } from "../pipeline.js";
/**
 * A reality probe certifies whether reality agreed with the executed outcome.
 * Without a probe wired, reality is honestly "unknown" — the kernel does not
 * fabricate a verdict. A real probe (post-execution verification against the
 * real world) is injected by higher layers.
 *
 * The `detail` field is optional: a probe may include a human-readable
 * description of what it checked (e.g. "directory ./utils exists on disk").
 *
 * May be SYNC or ASYNC. A local probe (filesystem) verifies synchronously; a
 * probe that must independently re-query a remote (e.g. confirming a source-
 * control PR landed the expected files) returns a promise. `makeObservationPort`
 * awaits the result; awaiting a sync return is a no-op, so existing sync probes
 * remain valid without change.
 */
export type RealityProbeResult = {
    readonly realityVerdict: "agree" | "disagree" | "unknown";
    readonly detail?: string;
    /**
     * The probe's collateral account of the declared observation scope
     * (Collateral Mutation Closure V1): the post-actuation snapshot plus every
     * unauthorized in-scope delta it found. Optional — ABSENT when the execution
     * payload carried no declared scope/snapshot (gauge law: never fabricated).
     * Relayed verbatim into the observation section; it explains the verdict,
     * it does not set it (the verdict rule stays in this stage).
     */
    readonly scopeObservation?: ScopeObservation;
};
export type RealityProbe = (execution: ExecutionPayload) => RealityProbeResult | Promise<RealityProbeResult>;
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
export declare function makeObservationPort(realityProbe: RealityProbe | null): (ctx: BaseStageContext) => Promise<DecisionSection<ObservationPayload>>;
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
export declare const agreeingRealityProbe: RealityProbe;
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
export declare const observationPort: (ctx: BaseStageContext) => Promise<DecisionSection<ObservationPayload>>;
//# sourceMappingURL=observation.d.ts.map