/**
 * Guided first-run onboarding.
 *
 * ── Goal ──────────────────────────────────────────────────────────────────────
 *
 *   Get the user to this state in <60 seconds:
 *     "I asked → I saw SYSTEM WILL → I approved → it ran."
 *
 *   No features. No settings. No explanations. One proven behavior.
 *
 * ── Flow ──────────────────────────────────────────────────────────────────────
 *
 *   Entry (A): npx usesteady            → guided (default: this file)
 *   Entry (B): npx usesteady "sentence" → direct cursor; skip onboarding
 *
 *   Guided path:
 *     1. First-run screen — [1] Try example  [2] Type my own
 *     2. "Generating execution plan..." delay (~700ms)
 *     3. SYSTEM WILL — 1 step, FILES AFFECTED: 1, LOW risk
 *     4. [a / Enter] Approve   [r] Reject
 *        - Reject → re-prompt (still teaches the loop, doesn't lose the user)
 *     5. Approve → simulate execution → name the loop explicitly
 *     6. Hand off → real cursor loop with concrete example hint
 *
 * ── Constraints ───────────────────────────────────────────────────────────────
 *
 *   - No multi-step example
 *   - No config, auth, settings, docs link, "learn more"
 *   - This is not onboarding to a system — it is proving a behavior
 */
import type { SessionController } from "../../session/controller.js";
/**
 * runOnboarding — guided first-run flow.
 *
 * Shows the first-run screen, runs the example or skips it,
 * then returns the session ID so the caller can pass it to runCursorLoop
 * for the second_prompt_entered event.
 *
 * @returns sessionId — UUID linking all activation events for this run.
 * @returns null      — user typed "exit" at any interactive prompt; caller
 *                      should short-circuit (main()'s finally handles the
 *                      "Goodbye." line and rl.close()). Part of the
 *                      interactive-exit contract ("interactive session exits").
 */
export declare function runOnboarding(rl: SessionController): Promise<string | null>;
//# sourceMappingURL=onboarding.d.ts.map