/**
 * Deterministic proposal copy per observation code (no LLM).
 */
import type { DiagnosticClass } from "../diagnostics/types.js";
export declare const PROPOSAL_VERSION = "proposal-v1";
export type ProposalCopy = {
    readonly title: string;
    readonly reason: string;
    readonly expected_effect: string;
    readonly rollback_guidance: string;
    readonly action_class: DiagnosticClass;
};
export declare function proposalCopyForCode(code: string): ProposalCopy | undefined;
//# sourceMappingURL=proposal-copy.d.ts.map