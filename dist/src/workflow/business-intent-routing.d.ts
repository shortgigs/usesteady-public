/**
 * Business-intent routing — USESTEADY_BUSINESS_INTENT_EXTRACTION_IMPL_V2.
 *
 * Single source of truth for the understand-workflow routing override.
 * server.ts imports these; cert scripts import the SAME functions so the cert
 * exercises the real routing decision.
 */
/**
 * Structural business-intent gate.
 * Returns true when the input carries a business-intent frame detectable by
 * surface structure alone. Detection is positional/structural — NOT a keyword
 * list. Extended in V2 to cover four additional frame classes:
 *
 * Original (V1):
 *   Requester frames — "I/We need/want…" or "Our/The [team] needs/want…"
 *
 * V2 additions:
 *
 * BIC-1 — Capability-naming conditional wish:
 *   "It would help/be great if SUBJECT could VERB OBJECT"
 *   "It would be great if SUBJECT got NOUN_PHRASE"
 *   Detection: "It would [help|be great] if" + any subject + "could" or "got"
 *   Boundary (s3-1): "It would help if churn was lower." — copula "was" is
 *   NOT "could" or "got" — correctly excluded (outcome-only wish).
 *
 * BIC-5/BIC-7 — Bare imperative with article-led deliverable:
 *   "Create/Build/… a NOUN [for/to …]"
 *   "Help me/us VERB a NOUN …"
 *   "Set up a NOUN …"  (phrasal verb; "up" consumed before article check)
 *   Detection: optional "Help me/us"; then any base-form word; optional " up";
 *   then article (a/an/the) + non-whitespace. Excludes WH-complements
 *   ("understand why…", "figure out how…") which lack an article-led object.
 *
 * BIC-6 — Bare proper-noun subject frame:
 *   "Sales needs visibility into…", "HR needs a dashboard…"
 *   Detection: single capitalized word + "needs"/"need" + content.
 *   Complements the existing "Our/The [team] needs" coverage.
 */
export declare function isBusinessIntentFrame(intent: string): boolean;
/**
 * USESTEADY_ANALYSIS_SURFACE_IMPL_V1 — ratified S2 doctrine.
 *
 * Directive analysis asks ("Help us understand why…", "Figure out how…",
 * "Find out why/how…") are commitments to deliver understanding — they route
 * to the certified WorkPlan engine as a specialized WorkPlan
 * (deliverableType: "analysis_findings"), never to intake.
 *
 * Two ratified ask subtypes (Analysis Completion Rule):
 *   understand_why  — completion owes findings + evidence only
 *   figure_out_how  — completion additionally owes a recommended approach
 *
 * Detection is structural head-matching, bounded to the ratified subtypes.
 * It must NOT capture:
 *   - Clarify rows (bare declaratives — no directive head)
 *   - BIC-5 business intents ("Help me build a dashboard…" — article-led object,
 *     captured by isBusinessIntentFrame before this is consulted)
 *   - "Investigate <subject>" — already certified subject-normalization behavior
 *     (FM-A/B/D lane preserves the Investigate verb); not part of the ratified
 *     S2 population and deliberately left untouched.
 */
export type AnalysisAsk = {
    readonly subtype: "understand_why" | "figure_out_how";
    /** The investigation complement, e.g. "why deals stall after the demo stage". */
    readonly complement: string;
};
export declare function parseAnalysisAsk(intent: string): AnalysisAsk | null;
export declare function isAnalysisHead(intent: string): boolean;
/**
 * The exact routing-override condition used by POST /api/portal/understand-workflow.
 * When true, server.ts attempts generateWorkPlanFromConfirmed and, on success,
 * responds with source: "workplan". When the WorkPlan engine declines
 * (GoalIsolationDeclinedError), the legacy result passes through unchanged.
 *
 * V2: business-intent frames route. S2 (ratified): analysis heads route too —
 * they produce analysis_findings WorkPlans via the same engine.
 */
export declare function shouldRouteToWorkPlanEngine(source: string, hasConfirmedUnderstanding: boolean, intent: string): boolean;
//# sourceMappingURL=business-intent-routing.d.ts.map