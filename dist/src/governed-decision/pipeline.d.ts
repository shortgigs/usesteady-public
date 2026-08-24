/**
 * The kernel spine orchestrator.
 *
 * Runs ONE governed decision through every stage, in canonical order, appending
 * one gauge-tagged section per stage to a single GovernedDecisionRecord.
 *
 * Stages are injected as ports (dependency injection) so Phase C fidelity slices
 * can wire each real stage (understanding, core/k1 truth arbitration,
 * core/execution-engine certification, ...) without changing the spine. Until a
 * port is provided, the default port returns an honest `unavailable` section.
 *
 * Loop guardrail (ratified v1): prior observation feeds the NEXT cycle's Decision
 * Basis ONLY. That is enforced structurally here — only the `decisionBasis` port
 * receives `priorObservation`; the ratification and execution ports cannot see it.
 */
import type { DecisionSection, ExecutionPayload, GovernedDecisionRecord, HumanIntent, ConstitutionPayload, DecisionBasisPayload, ObservationPayload, RatificationPayload, TruthArbitrationPayload, UnderstandingPayload, Reference, ReferenceEdge } from "./types.js";
/** Sections accumulated as the spine progresses; later stages may read earlier ones. */
export type SpineAccumulator = {
    readonly understanding?: DecisionSection<UnderstandingPayload>;
    readonly constitution?: DecisionSection<ConstitutionPayload>;
    readonly decisionBasis?: DecisionSection<DecisionBasisPayload>;
    readonly truthArbitration?: DecisionSection<TruthArbitrationPayload>;
    readonly ratification?: DecisionSection<RatificationPayload>;
    readonly execution?: DecisionSection<ExecutionPayload>;
};
export type BaseStageContext = {
    readonly humanIntent: HumanIntent;
    readonly prior: SpineAccumulator;
};
/**
 * Only the Decision Basis stage may see prior observation AND the declared
 * reference edges (loop guardrail, generalized -- INV-EIL-4). Routing references
 * exclusively through this context is the STRUCTURAL enforcement that references
 * are basis-only: no other stage context carries them, so they cannot reach
 * ratification or execution. Downstream stages see references only indirectly,
 * through the Decision Basis SECTION they legitimately read.
 */
export type BasisStageContext = BaseStageContext & {
    readonly priorObservation: ObservationPayload | null;
    readonly references: readonly ReferenceEdge[];
};
export type StagePorts = {
    readonly understanding: (ctx: BaseStageContext) => Promise<DecisionSection<UnderstandingPayload>>;
    readonly constitution: (ctx: BaseStageContext) => Promise<DecisionSection<ConstitutionPayload>>;
    readonly decisionBasis: (ctx: BasisStageContext) => Promise<DecisionSection<DecisionBasisPayload>>;
    readonly truthArbitration: (ctx: BaseStageContext) => Promise<DecisionSection<TruthArbitrationPayload>>;
    readonly ratification: (ctx: BaseStageContext) => Promise<DecisionSection<RatificationPayload>>;
    readonly execution: (ctx: BaseStageContext) => Promise<DecisionSection<ExecutionPayload>>;
    readonly observation: (ctx: BaseStageContext) => Promise<DecisionSection<ObservationPayload>>;
};
export type SpineInput = {
    readonly humanIntent: HumanIntent;
    /** Automatic loop: a prior observation eligible to feed this cycle's basis. */
    readonly priorObservation?: ObservationPayload | null;
    readonly priorObservationRef?: string | null;
    /**
     * Explicit Invocation Lineage (INV-EIL-2): declared reference inputs this
     * invocation depends on. Kernel-resolved into `record.references` edges with a
     * KIND-derived authority band (the caller cannot self-certify -- INV-EIL-5).
     */
    readonly references?: readonly Reference[];
    /** Partial port set; unprovided stages fall back to honest `unavailable`. */
    readonly ports?: Partial<StagePorts>;
};
/**
 * Run the spine. Stages execute in the canonical order defined by the
 * architecture: understanding -> constitution -> decisionBasis ->
 * truthArbitration -> ratification -> execution -> observation. The result is a
 * single GovernedDecisionRecord with one section per stage.
 */
export declare function runGovernedDecisionSpine(input: SpineInput): Promise<GovernedDecisionRecord>;
//# sourceMappingURL=pipeline.d.ts.map