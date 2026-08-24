/**
 * Canonical record for the UseSteady constitutional execution kernel.
 *
 * See docs/architecture/USESTEADY_KERNEL_CANONICAL_ARCHITECTURE_V1.md (FROZEN v1).
 *
 * One governed decision accretes exactly one typed, gauge-tagged section per
 * pipeline stage. No stage invents a private object that dies in memory: every
 * stage appends to THIS record, and the projection layer reads only this record.
 *
 * Gauge law (encoded in the type system): a section is `connected` (wired to a
 * real runtime source), `derived` (explicitly computed from connected sections),
 * or `unavailable` (no sensor yet — stated honestly). There is no fourth state;
 * "invented" is unrepresentable.
 */
/** The canonical stage order. The spine MUST run stages in exactly this order. */
export const STAGE_ORDER = [
    "understanding",
    "constitution",
    "decisionBasis",
    "truthArbitration",
    "ratification",
    "execution",
    "observation",
];
/**
 * Reserved approver namespace for synthetic (persona) ratifier seats.
 * A persona seat MUST identify as `persona:<id>`; the namespace is refused to
 * human seats. The ratification stage enforces agreement between this
 * namespace and `approverKind` in both directions (no casting path).
 */
export const PERSONA_APPROVER_PREFIX = "persona:";
/**
 * Map a reference KIND (+ whether the kernel re-verified it in THIS invocation)
 * to its entry authority band, in core/k1's vocabulary. Pure and total.
 *
 * INV-EIL-5: a `verified_artifact` reaches `verified_system_state` ONLY when a
 * kernel sensor re-verified it in the current invocation. Until such a sensor is
 * wired, `verified` is always false and the artifact honestly degrades to the
 * `unverified` band (no inherited or self-asserted authority).
 */
export function referenceAuthorityBand(kind, verifiedInThisInvocation) {
    switch (kind) {
        case "certified_decision":
            // A prior human ratification is a human-judgment-grade claim -- still
            // re-arbitrated, never auto-trusted.
            return "human_judgment";
        case "verified_artifact":
            return verifiedInThisInvocation ? "verified_system_state" : "unverified";
        case "prior_observation":
        case "asserted_artifact":
            return "unverified";
        default: {
            const _exhaustive = kind;
            void _exhaustive;
            return "unverified";
        }
    }
}
//# sourceMappingURL=types.js.map