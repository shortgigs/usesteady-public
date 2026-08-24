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
import type { IntentInterpreter } from "../types.js";
export declare const workflowIntentInterpreter: IntentInterpreter;
//# sourceMappingURL=workflow-intent.interpreter.d.ts.map