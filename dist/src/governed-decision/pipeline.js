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
import { createHash } from "node:crypto";
import { referenceAuthorityBand } from "./types.js";
const unwired = (stage) => ({
    status: "unavailable",
    reason: `stage not yet wired (Phase C: ${stage})`,
});
function defaultPorts() {
    return {
        understanding: async () => unwired("understanding"),
        constitution: async () => unwired("constitution"),
        decisionBasis: async () => unwired("decisionBasis"),
        truthArbitration: async () => unwired("truthArbitration"),
        ratification: async () => unwired("ratification"),
        execution: async () => unwired("execution"),
        observation: async () => unwired("observation"),
    };
}
function computeRecordId(humanIntent, createdAt, sections) {
    const canonical = JSON.stringify({ humanIntent, createdAt, sections });
    return createHash("sha256").update(canonical).digest("hex");
}
/**
 * Resolve declared reference inputs into recorded lineage edges (INV-EIL-2/5/6).
 *
 * Deterministic and pure: the authority band is derived from KIND alone, and
 * `verifiedInThisInvocation` is always `false` in v1 because no in-invocation
 * re-verification sensor is wired yet -- so no reference can reach
 * `verified_system_state`/`source_of_record` (honesty over convenience). A
 * caller-supplied reference can never self-certify authority.
 *
 * The single existing loop input (an eligible prior observation) is also recorded
 * here as a `prior_observation` edge, so `references` is the complete lineage from
 * day one and `priorObservationRef` is simply its projection.
 */
function resolveReferenceEdges(references, priorObservationRef) {
    const edges = [];
    // Back-compat: the existing --from loop input becomes the first lineage edge.
    if (priorObservationRef !== null) {
        edges.push({
            kind: "prior_observation",
            ref: priorObservationRef,
            authorityBand: referenceAuthorityBand("prior_observation", false),
            verifiedInThisInvocation: false,
        });
    }
    for (const r of references ?? []) {
        // v1: no re-verification sensor exists, so verified is always false.
        const verified = false;
        edges.push({
            kind: r.kind,
            ref: r.ref,
            authorityBand: referenceAuthorityBand(r.kind, verified),
            verifiedInThisInvocation: verified,
        });
    }
    return edges;
}
/**
 * Run the spine. Stages execute in the canonical order defined by the
 * architecture: understanding -> constitution -> decisionBasis ->
 * truthArbitration -> ratification -> execution -> observation. The result is a
 * single GovernedDecisionRecord with one section per stage.
 */
export async function runGovernedDecisionSpine(input) {
    const ports = { ...defaultPorts(), ...(input.ports ?? {}) };
    const createdAt = new Date().toISOString();
    // Loop guardrail (ratified v1): an observation may feed the next cycle's
    // Decision Basis ONLY if it is explicitly eligible (`feedsNextCycle === true`).
    // An ineligible or absent observation feeds `null`, and the record makes no
    // claim of having been fed (honest `priorObservationRef`).
    const eligiblePrior = input.priorObservation && input.priorObservation.feedsNextCycle
        ? input.priorObservation
        : null;
    const priorObservationRef = eligiblePrior ? (input.priorObservationRef ?? null) : null;
    let acc = {};
    const understanding = await ports.understanding({ humanIntent: input.humanIntent, prior: acc });
    acc = { ...acc, understanding };
    const constitution = await ports.constitution({ humanIntent: input.humanIntent, prior: acc });
    acc = { ...acc, constitution };
    // Explicit Invocation Lineage (INV-EIL-2/4/5/6): resolve the declared reference
    // inputs into kernel-banded edges BEFORE the basis runs, so they can be threaded
    // into the basis as kind-banded claims. The SAME resolved array is recorded at
    // `record.references` (lineage, INV-EIL-6) and threaded into the basis context
    // (basis-only, INV-EIL-4) -- one resolution, no drift between the two views.
    const references = resolveReferenceEdges(input.references, priorObservationRef);
    // Loop guardrail: prior observation AND references are injected ONLY here, as
    // basis input. No downstream stage context carries them (INV-EIL-4).
    const decisionBasis = await ports.decisionBasis({
        humanIntent: input.humanIntent,
        prior: acc,
        priorObservation: eligiblePrior,
        references,
    });
    acc = { ...acc, decisionBasis };
    const truthArbitration = await ports.truthArbitration({ humanIntent: input.humanIntent, prior: acc });
    acc = { ...acc, truthArbitration };
    const ratification = await ports.ratification({ humanIntent: input.humanIntent, prior: acc });
    acc = { ...acc, ratification };
    // Invariant (fail-closed): nothing runs without human ratification. The
    // execution port is invoked ONLY when ratification is present and approved;
    // otherwise execution is honestly `unavailable`. Models propose, humans
    // ratify, the SDK executes only what was approved.
    const ratificationApproved = ratification.status !== "unavailable" && ratification.value.decision === "approved";
    const execution = ratificationApproved
        ? await ports.execution({ humanIntent: input.humanIntent, prior: acc })
        : {
            status: "unavailable",
            reason: ratification.status === "unavailable"
                ? `execution blocked: decision not ratified (${ratification.reason})`
                : `execution blocked: ratification decision is "${ratification.value.decision}", not "approved"`,
        };
    acc = { ...acc, execution };
    const observation = await ports.observation({ humanIntent: input.humanIntent, prior: acc });
    // `references` was resolved before the basis stage (above) and recorded here as
    // the declared dependency edges (INV-EIL-6). References reach ONLY the basis
    // context; they are never passed to ratification/execution (INV-EIL-4).
    const sections = {
        createdAt,
        humanIntent: input.humanIntent,
        understanding,
        constitution,
        decisionBasis,
        truthArbitration,
        ratification,
        execution,
        observation,
        priorObservationRef,
        references,
    };
    return { recordId: computeRecordId(input.humanIntent, createdAt, sections), ...sections };
}
//# sourceMappingURL=pipeline.js.map