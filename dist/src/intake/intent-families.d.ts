/**
 * Intent Families — Intake v2.
 *
 * ── Classification contract ────────────────────────────────────────────────────
 *
 *   Intent families are classification categories only.
 *   They do NOT all map to executable operations.
 *
 *   DIRECT_CAPABLE_FAMILIES: may translate directly to executable DraftTasks.
 *   GUIDED_ONLY_FAMILIES:    must resolve to rewrite, clarification, or boundary.
 *
 * ── Hard rule (non-negotiable) ────────────────────────────────────────────────
 *
 *   Guided-only families may NEVER emit executable DraftTasks directly.
 *   They may only produce: suggested_rewrite, clarification_question, or boundary_reason.
 *
 *   A suggested_rewrite for a guided-only family is a contract violation and
 *   must be stripped by the post-parse validator in llm-classifier.ts.
 *
 * ── The five frozen execution operations ─────────────────────────────────────
 *
 *   rename / replace / create / delete / run
 *
 *   These are the only operations UseSteady executes. Nothing outside this set
 *   may be introduced via LLM rewrite or any other classification mechanism.
 *   LLM may widen understanding. It may not widen execution.
 */
/**
 * Families that may produce executable DraftTasks.
 * Maps 1-to-1 with the five frozen execution operations.
 */
export declare const DIRECT_CAPABLE_FAMILIES: readonly ["rename", "replace", "create", "delete", "run"];
/**
 * Families that must never produce executable DraftTasks.
 * Output must always be: suggested_rewrite (toward a direct-capable op),
 * clarification_question, or boundary_reason.
 */
export declare const GUIDED_ONLY_FAMILIES: readonly ["find", "clean_up", "fix", "config", "artifact", "boundary"];
export type DirectCapableFamily = (typeof DIRECT_CAPABLE_FAMILIES)[number];
export type GuidedOnlyFamily = (typeof GUIDED_ONLY_FAMILIES)[number];
export type IntentFamily = DirectCapableFamily | GuidedOnlyFamily;
/** Runtime guard — true iff the family can produce an executable DraftTask. */
export declare function isDirectCapable(f: IntentFamily): f is DirectCapableFamily;
/**
 * Slots the LLM extracts from user input.
 * Only fields explicitly stated in the input are populated — never guessed.
 */
export type IntentSlots = {
    readonly source_path?: string;
    readonly target_path?: string;
    readonly old_value?: string;
    readonly new_value?: string;
    readonly command?: string;
};
/**
 * Required slots that must ALL be present before a direct-capable family
 * may produce a suggested_rewrite. If any are missing, the classifier
 * must emit a clarification_question instead.
 */
export declare const REQUIRED_SLOTS: Record<DirectCapableFamily, readonly string[]>;
/**
 * Structured output from the LLM classifier.
 *
 * POST-PARSE ENFORCEMENT (applied by llm-classifier.ts validator):
 *   1. suggested_rewrite is stripped if intent_family is guided-only.
 *   2. suggested_rewrite is stripped if any required slot is missing.
 *   3. confidence is clamped to [0, 1].
 *   4. boundary_reason must be present when intent_family === "boundary".
 */
export type LLMClassification = {
    readonly intent_family: IntentFamily;
    readonly confidence: number;
    readonly slots: IntentSlots;
    readonly missing_slots: readonly string[];
    /**
     * Only set for DIRECT_CAPABLE families when ALL required slots are present.
     * NEVER set for guided-only families — strip it if the LLM emits it.
     */
    readonly suggested_rewrite?: string;
    /** One question only — present when slots are missing or intent is ambiguous. */
    readonly clarification_question?: string;
    /** Present when intent_family === "boundary". */
    readonly boundary_reason?: string;
};
//# sourceMappingURL=intent-families.d.ts.map