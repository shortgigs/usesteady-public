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
// ─── Family constants ─────────────────────────────────────────────────────────
/**
 * Families that may produce executable DraftTasks.
 * Maps 1-to-1 with the five frozen execution operations.
 */
export const DIRECT_CAPABLE_FAMILIES = [
    "rename",
    "replace",
    "create",
    "delete",
    "run",
];
/**
 * Families that must never produce executable DraftTasks.
 * Output must always be: suggested_rewrite (toward a direct-capable op),
 * clarification_question, or boundary_reason.
 */
export const GUIDED_ONLY_FAMILIES = [
    "find", // locate / search — must clarify into a concrete op
    "clean_up", // vague improvement — needs scope and concrete op
    "fix", // fix issue — needs specific target and change
    "config", // configuration change — needs target file and values
    "artifact", // generate something — needs type and destination
    "boundary", // outside UseSteady scope entirely
];
/** Runtime guard — true iff the family can produce an executable DraftTask. */
export function isDirectCapable(f) {
    return DIRECT_CAPABLE_FAMILIES.includes(f);
}
/**
 * Required slots that must ALL be present before a direct-capable family
 * may produce a suggested_rewrite. If any are missing, the classifier
 * must emit a clarification_question instead.
 */
export const REQUIRED_SLOTS = {
    rename: ["source_path", "target_path"],
    replace: ["source_path", "old_value", "new_value"],
    create: ["source_path"],
    delete: ["source_path"],
    run: ["command"],
};
//# sourceMappingURL=intent-families.js.map