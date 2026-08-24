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
import { newActivationSession, captureActivation, } from "../../friction/activation.js";
// ─── ANSI helpers (brand-safe subset) ────────────────────────────────────────
const C = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    // Bright cyan — closest safe terminal approximation of brand #00D4FF
    cyan: "\x1b[96m",
    green: "\x1b[92m",
    yellow: "\x1b[93m",
};
function styled(color, text) {
    return `${color}${text}${C.reset}`;
}
// ─── I/O helpers ──────────────────────────────────────────────────────────────
function sanitizeForConsole(line) {
    let out = line;
    const replacements = [
        ["â†’", "->"],
        ["â€™", "'"],
        ["â€œ", "\""],
        ["â€\u009d", "\""],
        ["â€”", "-"],
        ["â€“", "-"],
        ["→", "->"],
        ["—", "-"],
        ["–", "-"],
        ["✓", "ok"],
        ["✔", "ok"],
        ["✅", "ok"],
        ["❌", "x"],
        ["⚠", "warn"],
        ["ℹ", "i"],
        ["•", "-"],
        ["·", "-"],
        ["─", "-"],
    ];
    for (const [from, to] of replacements) {
        out = out.split(from).join(to);
    }
    return out.replace(/[^\x00-\x7F]/g, "");
}
function print(lines) {
    for (const line of lines)
        process.stdout.write(sanitizeForConsole(line) + "\n");
}
// Controller-based line read. Every prompt in the onboarding flow is
// purpose-tagged "onboarding_step" per design §7.5 so telemetry can
// differentiate onboarding reads from credential / NL / approval reads.
function ask(rl, prompt) {
    return rl.requestInput({ purpose: "onboarding_step", prompt, until: "line" });
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
const DIV = "  " + "─".repeat(51);
/**
 * Case-insensitive recogniser for the canonical exit keywords at every
 * interactive prompt the CLI owns. Kept here (rather than a shared module)
 * to avoid a circular-import risk; mirrored verbatim in claude-setup.ts and
 * main.ts for the same reason.
 *
 * Accepts: exit | quit | :q | q
 */
function isExitInput(raw) {
    const t = raw.trim().toLowerCase();
    return t === "exit" || t === "quit" || t === ":q" || t === "q";
}
/**
 * Render the SYSTEM WILL block and prompt for approval.
 * Accepts:  a | Enter = Approve,  r = Reject, exit = leave onboarding.
 * On reject — re-prompts so the user can still approve and complete the loop.
 * Fires example_approved metric on approval.
 */
async function runExample(rl, sessionId, startedAt) {
    // Tweak #5 — keep the "Generating" hint, sets expectation
    process.stdout.write(sanitizeForConsole("\n  Generating execution plan..."));
    await sleep(700);
    process.stdout.write(sanitizeForConsole("\n"));
    // Tweak #1 — FILES AFFECTED + more believable WHY ("used across 3 pages")
    print([
        "",
        DIV,
        "",
        `  ${styled(C.bold + C.cyan, "SYSTEM WILL")}`,
        "  - Change button color in src/components/Button.tsx",
        "",
        "  FILES AFFECTED: 1",
        "",
        `  RISK: ${styled(C.green, "LOW")}`,
        "  This only changes styling. No logic or behavior is affected.",
        "",
        `  ${styled(C.dim, "WHY:")}`,
        "  The Button component is used across 3 pages.",
        "  This will update its appearance consistently.",
        "",
        DIV,
        "",
        "  [a] Approve   [r] Reject   [exit] Leave",
        "",
    ]);
    while (true) {
        const raw = (await ask(rl, "  > ")).trim().toLowerCase();
        if (raw === "a" || raw === "approve" || raw === "") {
            // Metric 2: example_approved (with ms elapsed since onboarding_started)
            captureActivation("example_approved", sessionId, Date.now() - startedAt);
            return "approved";
        }
        if (isExitInput(raw)) {
            // Interactive exit contract: accept "exit" at every interactive prompt.
            // Propagate up to runOnboarding, which signals main() to exit cleanly.
            return "exit";
        }
        if (raw === "r" || raw === "reject") {
            print([
                "",
                `  ${styled(C.yellow, "✓")} Step rejected`,
                "",
                "  Nothing was changed.",
                "",
                "  Approve once to see how execution works:",
                "",
                "  [a] Approve   [r] Reject   [exit] Leave",
                "",
            ]);
            continue;
        }
        print(["  Press Enter or [a] to approve, [r] to reject, or type 'exit' to leave."]);
    }
}
// ─── Completion screen ────────────────────────────────────────────────────────
async function showApproved() {
    print(["", `  ${styled(C.green, "✓")} Step approved`]);
    process.stdout.write("\n  Applying change...");
    await sleep(800);
    // Tweak #3 — concrete example inline to remove blank-page anxiety
    print([
        "",
        `  ${styled(C.green, "✓")} Button.tsx updated`,
        "",
        DIV,
        "",
        "  Done.",
        "",
        `  You saw ${styled(C.cyan, "SYSTEM WILL")}.`,
        "  You approved.",
        "  Then it ran.",
        "",
        DIV,
        "",
        `  Try a change (e.g. rename Header.tsx to NavBar.tsx):`,
        "",
    ]);
}
// ─── Public API ───────────────────────────────────────────────────────────────
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
export async function runOnboarding(rl) {
    const sessionId = newActivationSession();
    const startedAt = Date.now();
    // Metric 1: onboarding_started
    captureActivation("onboarding_started", sessionId);
    print([
        "",
        "  UseSteady",
        "",
        "  Describe what you want to change.",
        "  UseSteady translates it into a safe, structured change.",
        "  You approve before anything runs.",
        "",
        DIV,
        "",
        "  [1] Try a quick example  (recommended)",
        "  [2] Describe your own change",
        "  [exit] Leave",
        "",
    ]);
    const raw = (await ask(rl, "  > ")).trim();
    if (isExitInput(raw)) {
        // Interactive exit contract: "exit" at the first-run menu must leave the
        // session. Pre-fix this silently fell through to the example branch.
        return null;
    }
    if (raw === "2") {
        print([
            "",
            "  Describe what you want to change:",
            "  (e.g. rename Button.tsx to PrimaryButton.tsx)",
            "",
        ]);
        return sessionId;
    }
    // [1] or Enter → run the example
    const exampleOutcome = await runExample(rl, sessionId, startedAt);
    if (exampleOutcome === "exit") {
        return null;
    }
    await showApproved();
    return sessionId;
}
//# sourceMappingURL=onboarding.js.map