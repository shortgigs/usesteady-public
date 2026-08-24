/**
 * src/friction/reviewer.ts
 *
 * AI-powered friction report classifier.
 *
 * Calls Claude claude-haiku-4-5 (cheap, fast) with a structured prompt to decide
 * whether a submitted friction report represents genuine user friction worth
 * paying out, or should be rejected (spam, nonsense, gaming the system).
 *
 * Uses the Anthropic Messages API directly via fetch — no SDK dependency.
 * Requires ANTHROPIC_API_KEY in the environment.
 */
import type { GitHubIssue } from "./github-issues.js";
import { type SystemStructuralDerivationV1, type EvidenceSourceBasis } from "../evidence-basis/types.js";
/**
 * Load ANTHROPIC_API_KEY from multiple locations in priority order:
 *  1. process.env (already set by caller / CI)
 *  2. ~/.usesteady/.env  (ops-specific, never committed)
 *  3. <cwd>/.env.local
 */
export declare function loadAnthropicKey(): string | undefined;
export type ReviewDecision = "approved" | "rejected" | "skip";
/**
 * ReviewEvidenceBasis — the SYSTEM's factual record of what evidence basis a
 * friction-review verdict actually rested on.
 *
 * LOCAL/UNSHIPPED (P4): this type is local admin capability. It is not part
 * of the tracked P4 product closure claim. Integration callers are gitignored.
 *
 * Derived from the deterministic review path — never from the model's prose.
 * A rejection recorded here is always a judgment on a BOUNDED EXTRACT, never
 * "the human's claim contradicted by all supplied evidence": the reviewer
 * never sees attachments, media, the comment thread, or the raw issue body.
 *
 *   mode             — which classifier produced the verdict
 *   model            — the model identity, present only when mode === "ai"
 *   extractHash      — sha256 over the EXACT bounded input the classifier
 *                      consumed (the constructed user message for "ai"; the
 *                      parsed fields for "rule_based"). Content-addressed:
 *                      re-deriving the same input yields the same hash.
 *   truncatedFields  — field names whose content was length-cut or elided by
 *                      sanitization before reaching the classifier
 *   accessStatus     — "ok" (classifier consumed the extract) |
 *                      "api_error" (supply to the model failed — no model
 *                      judgment exists) | "no_api_key" (rule-based path)
 *   completeness     — literal-only "partial_bounded_extract". The reviewer
 *                      never sees the complete issue graph; no other value is
 *                      expressible.
 *   evidenceBackedContradiction / comprehension — literal-only
 *                      "not_established". API success NEVER establishes
 *                      comprehension; a verdict NEVER constitutes an
 *                      evidence-backed contradiction of the reporter's claim.
 */
export interface ReviewEvidenceBasis {
    readonly mode: "ai" | "rule_based";
    readonly model?: string;
    readonly extractHash: string;
    readonly truncatedFields: readonly string[];
    readonly accessStatus: "ok" | "api_error" | "no_api_key";
    readonly completeness: "partial_bounded_extract";
    readonly derivation: SystemStructuralDerivationV1;
    readonly sources: readonly EvidenceSourceBasis[];
    readonly evidenceBackedContradiction: "not_established";
    readonly comprehension: "not_established";
}
export interface ReviewVerdict {
    readonly decision: ReviewDecision;
    readonly reason: string;
    readonly confidence: number;
    readonly evidenceBasis: ReviewEvidenceBasis;
}
/**
 * Classify a single GitHub friction issue.
 * Uses Claude when ANTHROPIC_API_KEY is available; falls back to rule-based
 * heuristics otherwise (good for demos and offline use).
 * Returns a ReviewVerdict with decision, reason, and confidence.
 */
export declare function classifyReport(issue: GitHubIssue): Promise<ReviewVerdict>;
/**
 * Classify a batch of issues, printing progress to stderr.
 * Returns results in the same order as the input array.
 */
export declare function classifyBatch(issues: GitHubIssue[]): Promise<Array<{
    issue: GitHubIssue;
    verdict: ReviewVerdict;
}>>;
//# sourceMappingURL=reviewer.d.ts.map