/**
 * Workflow intent interpreter.
 *
 * Scope: detect inputs that appear to be development lifecycle / operational
 * workflow requests — commit actions, sequential multi-step flows, and
 * simple operational cleanup tasks.
 *
 * Priority 5 — runs first (before config, color, text) because commit verbs
 * are unambiguous and must not be misclassified as config or text changes.
 *
 * Two signal families (either alone is sufficient to classify):
 *
 *   1. Commit signals
 *      "commit", "git commit", "save changes", "save my changes"
 *      → clearly a dev-lifecycle intent regardless of surrounding words
 *
 *   2. Sequential workflow signals
 *      Patterns like "and then <verb>", "build and deploy", "test and commit"
 *      → two-step or multi-step operational chains
 *
 * Language contract:
 *   Summary says "appears to be a development workflow request" — medium confidence.
 *   basis[] records the exact matched token so results are inspectable.
 *   Never guesses the target branch, file, or working directory.
 *
 * Out of scope (v1):
 *   "push to production", "merge branch", "rebase" — too broad for v1;
 *   these fall back to the generic fallback guidance.
 *
 * ── Hard invariant ────────────────────────────────────────────────────────────
 *   Interpretation can improve guidance, but it can never manufacture executability.
 */
/**
 * Commit-intent signal: the user clearly wants to perform a commit action.
 * Requires "commit" / "git commit" / "save changes" in the input.
 *
 * "commit" must not be in a noun-reference context.
 * Noun exclusion pattern catches: "show last commit", "view recent commits",
 * "latest commit", "previous commit", "check commit history", etc.
 * In these cases, "commit" refers to a past recorded commit, not an action.
 */
const COMMIT_SIGNAL_RE = /\b(git\s+commit|save\s+(?:my\s+)?changes|commit)\b/i;
/**
 * Noun-context guard: "commit" is being used as a noun (reference to a
 * past/existing commit object), NOT as a verb (the action of committing).
 *
 * If this matches, the commit signal must be suppressed.
 */
const COMMIT_NOUN_CONTEXT_RE = /\b(?:show|view|see|check|inspect|display|list|log)\b.{0,30}\bcommits?\b|\b(?:last|latest|recent|previous|prior|earliest|newest|oldest)\s+commits?\b|\bcommit\s+(?:history|log|message|hash|id|sha|diff)\b/i;
/**
 * Sequential workflow signal: two named actions chained together.
 * Matches "and then <verb>", common two-step chains (build+deploy, test+commit, etc.).
 */
const SEQUENTIAL_SIGNAL_RE = /\b(?:and\s+then|then\s+(?:commit|deploy|push|build|test)|(?:build|test|run|compile|check|verify|clean|lint)\s+and\s+(?:then\s+)?(?:commit|deploy|push|build|test|clean|remove|delete))\b/i;
export const workflowIntentInterpreter = {
    id: "workflow_intent",
    priority: 5,
    matches(input) {
        const hasSequential = SEQUENTIAL_SIGNAL_RE.test(input);
        if (hasSequential)
            return true;
        // Suppress commit match when "commit" is in a noun-reference context
        const hasCommit = COMMIT_SIGNAL_RE.test(input) && !COMMIT_NOUN_CONTEXT_RE.test(input);
        return hasCommit;
    },
    interpret(input) {
        const basis = [];
        const sequentialMatch = SEQUENTIAL_SIGNAL_RE.exec(input);
        if (sequentialMatch !== null) {
            basis.push(`matched sequential workflow pattern: ${sequentialMatch[0].trim()}`);
        }
        // Only add commit basis when not in noun-reference context
        if (!COMMIT_NOUN_CONTEXT_RE.test(input)) {
            const commitMatch = COMMIT_SIGNAL_RE.exec(input);
            if (commitMatch !== null) {
                basis.push(`matched commit signal: ${commitMatch[1]}`);
            }
        }
        if (basis.length === 0)
            return null;
        return {
            category: "workflow_operation",
            summary: "This appears to be a development workflow request.",
            confidence: "medium",
            basis,
        };
    },
};
//# sourceMappingURL=workflow-intent.interpreter.js.map