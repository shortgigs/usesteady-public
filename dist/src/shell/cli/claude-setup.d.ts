/**
 * src/shell/cli/claude-setup.ts
 *
 * Anthropic API key detection, storage, and setup flow.
 *
 * Principles:
 *   - No silent failure: always tell the user what's missing and what to do.
 *   - No restart friction: after pasting a key, continue immediately.
 *   - Minimal surface: no OAuth, no provider abstraction, just key → run.
 *
 * Key resolution order:
 *   1. ANTHROPIC_API_KEY environment variable
 *   2. ~/.usesteady/config.json → anthropic_api_key
 */
import type { SessionController } from "../../session/controller.js";
export declare function detectClaudeKey(): string | null;
export declare function saveClaudeKey(key: string): void;
/**
 * Shown when no Anthropic API key is detected on bare `npx usesteady`.
 *
 * M5 §13 commit 5 migrates this function from `readline.Interface` to
 * `SessionController`. It is the documented GH-22 fix point: previously,
 * the gate took the outer `rl` and called `rl.question(...)` directly,
 * which meant any `rl.close()` upstream — or any second `createInterface`
 * call later in the session — could race the gate's listener registration
 * and kill the session mid-read. With the controller owning stdin, this
 * class of failure is no longer expressible.
 *
 * Returns:
 *   "continue" — proceed to onboarding + REPL. Covers three sub-cases:
 *                  • [1] valid key was pasted and saved (process.env is live);
 *                  • [2] user asked for instructions — URL was printed;
 *                  • [3] user picked demo / no key.
 *                In all three, the caller continues into runOnboarding +
 *                runCursorLoop so the REPL persists. Deterministic NL
 *                operations (replace / rename / append / prepend / create /
 *                delete) work without an API key; LLM-assisted plans
 *                surface their own setup hint.
 *   "exit"     — user explicitly typed exit / quit / :q / q at the menu.
 */
export declare function runSetupPrompt(rl: SessionController): Promise<"continue" | "exit">;
export declare function runSetupSubcommand(rl: SessionController): Promise<void>;
//# sourceMappingURL=claude-setup.d.ts.map