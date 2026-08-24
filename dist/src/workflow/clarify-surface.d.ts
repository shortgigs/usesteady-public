/**
 * Clarify surface — USESTEADY_CLARIFY_SURFACE_IMPL_V1 (ratified S1 doctrine).
 *
 * Clarify is the certified commitment for inputs where the system understood a
 * statement but found no makeable or investigable commitment: bare declarative
 * problem statements ("Deals stall after the demo stage."), metric complaints
 * ("Follow-up rate is too low."), and outcome-only conditional wishes
 * ("It would help if churn was lower.").
 *
 * The ratified four-element commitment (binding):
 *   understood — extractive restatement; metric rows echo the stated comparative
 *                as a success measure
 *   missing    — the named uncertainty (no deliverable or change was stated)
 *   ask        — interrogative, create/change framing, references the problem
 *   reentry    — the answer re-enters understanding as the clarified intent
 *
 * Governance: pre-commitment. No approval gate. UCP-recorded exactly as intake
 * is today. Never carries a workPlan or a synthesized goal.
 *
 * Shared-module discipline: server.ts and scripts/cert-clarify-surface.ts import
 * THESE functions — the cert exercises the real decision.
 */
export type ClarifyCommitment = {
    /** What the system understood — extractive restatement of the problem. */
    readonly understood: string;
    /** What uncertainty remains. */
    readonly missing: string;
    /** What answer is required from the user. */
    readonly ask: string;
    /** What happens after the user answers. */
    readonly reentry: {
        readonly hint: string;
    };
};
/**
 * Structural clarify-class detection.
 *
 * Evaluated ONLY at the intake fall-through (after IR grammar, skill matching,
 * business-intent frames, and analysis heads have all declined). By construction
 * the remaining population is non-directive; clarify fires for sentence-shaped
 * statements and leaves fragments to legacy intake.
 *
 *   - not interrogative (questions are out of scope for this lane)
 *   - not a business-intent frame (those route to WorkPlan)
 *   - not a directive analysis head (those route to analysis_findings)
 *   - sentence-shaped: at least three words, starts with a letter
 *
 * This is deliberately a structural absence-of-commitment test, not a domain
 * keyword list (contract boundary).
 */
export declare function isClarifyClass(intent: string): boolean;
export declare function generateClarify(intent: string): ClarifyCommitment;
//# sourceMappingURL=clarify-surface.d.ts.map