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

import { isAnalysisHead, isBusinessIntentFrame } from "./business-intent-routing.js";

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
export function isClarifyClass(intent: string): boolean {
  const t = intent.trim();
  if (t.length === 0) return false;
  if (/\?\s*$/.test(t)) return false;
  if (!/^[A-Za-z]/.test(t)) return false;
  if (isBusinessIntentFrame(t)) return false;
  if (isAnalysisHead(t)) return false;

  const words = t.split(/\s+/).filter(w => w.length > 0);
  return words.length >= 3;
}

/**
 * F7 success-measure echo — the only permitted synthesis in `understood`.
 * Derives mechanically from the direction of the stated comparative:
 *   "too low"            → the measure should rise
 *   "too high/many/much" → the measure should fall
 *   "over <amount>"      → the measure should come down / get faster
 *   trailing "late"      → fewer late outcomes
 * Returns null when no comparative is stated (no fabrication).
 */
function successMeasureEcho(statement: string): string | null {
  if (/\btoo\s+low\b/i.test(statement)) {
    return "success measure: this rises";
  }
  if (/\btoo\s+(?:high|many|much)\b/i.test(statement) || /\blate\b/i.test(statement)) {
    return "success measure: fewer of these";
  }
  if (/\b(?:is|are)\s+over\s+\S/i.test(statement)) {
    return "success measure: this comes down";
  }
  return null;
}

/** Extractive restatement: the input minus terminal punctuation. */
function restate(intent: string): string {
  return intent.trim().replace(/[.\s]+$/, "");
}

export function generateClarify(intent: string): ClarifyCommitment {
  const statement = restate(intent);
  const echo = successMeasureEcho(statement);
  const understood = echo === null ? statement : `${statement} (${echo})`;

  return {
    understood,
    missing: "No deliverable or change was stated.",
    ask: `What would you like to create or change to address this: "${statement}"?`,
    reentry: {
      hint: "Your answer becomes the clarified intent and re-enters understanding.",
    },
  };
}
