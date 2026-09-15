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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join }    from "node:path";

import type { SessionController, InputPurpose } from "../../session/controller.js";

const USESTEADY_DIR = join(homedir(), ".usesteady");
const CONFIG_PATH   = join(USESTEADY_DIR, "config.json");

// ─── Key detection ────────────────────────────────────────────────────────────

function readStoredKey(): string | null {
  try {
    if (existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
      // Support both old key name (claude_api_key) and new (anthropic_api_key).
      const key = cfg["anthropic_api_key"] ?? cfg["claude_api_key"];
      if (typeof key === "string" && key) return key;
    }
  } catch { /* ignore */ }
  return null;
}

export function detectClaudeKey(): string | null {
  const fromEnv = process.env["ANTHROPIC_API_KEY"];
  if (fromEnv) return fromEnv;
  return readStoredKey();
}

// ─── Key storage ──────────────────────────────────────────────────────────────

export function saveClaudeKey(key: string): void {
  if (!existsSync(USESTEADY_DIR)) mkdirSync(USESTEADY_DIR, { recursive: true });

  let cfg: Record<string, unknown> = {};
  try {
    if (existsSync(CONFIG_PATH)) {
      cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
    }
  } catch { /* start fresh */ }

  cfg["anthropic_api_key"] = key;
  // Migrate: remove old key name if present.
  delete cfg["claude_api_key"];
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");

  // Activate in the current process immediately — no restart needed.
  process.env["ANTHROPIC_API_KEY"]    = key;
  process.env["USESTEADY_USE_CLAUDE"] = "true";
}

// ─── Output helpers ───────────────────────────────────────────────────────────

const B    = "\x1b[1m";
const DIM  = "\x1b[2m";
const R    = "\x1b[0m";
const CYAN = "\x1b[96m";

function ln(s = ""): void { process.stdout.write(s + "\n"); }

// Controller-based line read. Both entry points (the bare-run credential
// gate via runSetupPrompt, and the explicit `usesteady setup` subcommand
// via runSetupSubcommand) route every question through the single
// SessionController-owned readline.Interface. This is the structural
// guarantee behind the GH-22 fix: no second readline.Interface exists,
// so a mid-menu error cannot collapse stdin.
//
// Purpose-tagged per design §7.5 so telemetry / retry logic can locate
// each gate without string-matching prompts:
//   - "credential" — #150 first-run gate (runSetupPrompt)
//   - "setup"      — explicit `usesteady setup` subcommand
function askCtrl(rl: SessionController, q: string, purpose: InputPurpose): Promise<string> {
  return rl.requestInput({ purpose, prompt: q, until: "line" });
}

// ─── Setup prompt (first-run gate) ───────────────────────────────────────────

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
export async function runSetupPrompt(
  rl: SessionController,
): Promise<"continue" | "exit"> {
  ln();
  ln(`  ${B}UseSteady${R}`);
  ln();
  ln("  To generate execution plans, you need an Anthropic API key.");
  ln();
  ln(`  ${DIM}[1]${R} Paste API key`);
  ln(`  ${DIM}[2]${R} How to get one`);
  ln(`  ${DIM}[3]${R} Skip — show demo only`);
  ln(`  ${DIM}[exit]${R} Leave`);
  ln();

  while (true) {
    const raw    = (await askCtrl(rl, "  > ", "credential")).trim();
    const answer = raw.toLowerCase();

    // Interactive exit contract: "exit" at any interactive prompt must leave the
    // session cleanly. Pre-fix this menu accepted only 1/2/3 and silently
    // re-prompted "Enter 1, 2, or 3." on "exit", trapping the user.
    if (answer === "exit" || answer === "quit" || answer === ":q" || answer === "q") {
      return "exit";
    }

    if (answer === "1" || answer.startsWith("paste") || answer.startsWith("p")) {
      ln();
      const key = (await askCtrl(rl, "  Enter your Anthropic API key:\n  > ", "credential")).trim();
      if (!key) {
        ln();
        ln("  No key entered — try again, or choose [3] to skip.");
        ln();
        continue;
      }
      if (!key.startsWith("sk-")) {
        ln();
        ln("  That doesn't look like a valid Anthropic API key (should start with sk-).");
        ln("  Try again, or choose [3] to skip.");
        ln();
        continue;
      }
      saveClaudeKey(key);
      ln();
      ln(`  ${CYAN}✓ Anthropic API key saved${R}`);
      ln();
      ln("  Starting UseSteady...");
      ln();
      return "continue";
    }

    if (answer === "2" || answer.startsWith("how") || answer.startsWith("h")) {
      ln();
      ln("  Get your Anthropic API key from:");
      ln(`  ${CYAN}https://console.anthropic.com/${R}`);
      ln();
      ln("  Add it later with:");
      ln("    npx usesteady setup");
      ln();
      ln("  Continuing without a key — deterministic edits will still work.");
      ln();
      return "continue";
    }

    if (answer === "3" || answer === "" || answer.startsWith("skip") || answer.startsWith("s")) {
      ln();
      ln("  Continuing without a key — deterministic edits will still work.");
      ln("  Add a key later with:  npx usesteady setup");
      ln();
      return "continue";
    }

    // Unrecognised — re-prompt
    ln("  Enter 1, 2, or 3.");
    ln();
  }
}

// ─── Setup subcommand (npx usesteady setup) ───────────────────────────────────

export async function runSetupSubcommand(rl: SessionController): Promise<void> {
  ln();
  ln(`  ${B}UseSteady Setup${R}`);
  ln();

  const existing = detectClaudeKey();
  if (existing) {
    ln(`  ${CYAN}✓ Anthropic API key already configured.${R}`);
    ln();
    ln("  Run:");
    ln("    npx usesteady");
    ln();
    return;
  }

  while (true) {
    const key = (await askCtrl(rl, "  Enter your Anthropic API key (or 'exit' to leave):\n  > ", "setup")).trim();

    // Interactive exit contract: accept "exit" at the key prompt. Pre-fix the key
    // validator rejected "exit" with "doesn't look like a valid key" and
    // looped forever; Ctrl+C was the only escape and non-obvious.
    if (key.toLowerCase() === "exit" || key.toLowerCase() === "quit" ||
        key.toLowerCase() === ":q" || key.toLowerCase() === "q") {
      ln();
      ln("  No key saved. Run 'npx usesteady setup' again when you're ready.");
      ln();
      return;
    }

    if (!key) {
      ln("  No key entered — try again (or type 'exit' to leave).");
      ln();
      continue;
    }
    if (!key.startsWith("sk-")) {
      ln("  That doesn't look like a valid Anthropic API key (should start with sk-).");
      ln("  Try again (or type 'exit' to leave).");
      ln();
      continue;
    }

    saveClaudeKey(key);
    ln();
    ln(`  ${CYAN}✓ Anthropic API key saved${R}`);
    ln();
    ln("  Run:");
    ln("    npx usesteady");
    ln();
    break;
  }
}
