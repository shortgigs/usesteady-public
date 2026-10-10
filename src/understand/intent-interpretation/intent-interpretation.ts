/**
 * Intent Interpretation Bridge — main entry point.
 *
 * ── What this layer is ────────────────────────────────────────────────────────
 *
 * The Intent Interpretation Bridge sits between Completion and Response Planner.
 * It runs ONLY when CompletionResult.kind === "guided_recovery" — i.e. the input
 * is safe, not executable yet, but a safe next-step path exists.
 *
 * Its job is to make guided recovery feel more helpful without guessing.
 * It classifies the broad category of what the user appears to be trying to do,
 * then rewrites guidance labels to be context-aware.
 *
 * ── Pipeline position ─────────────────────────────────────────────────────────
 *
 *   Completion
 *       ↓  (guided_recovery only)
 *   Intent Interpretation Bridge      ← this module
 *       ↓
 *   Response Planner
 *
 * ── Hard invariant (locked) ──────────────────────────────────────────────────
 *
 *   Interpretation can improve guidance, but it can never manufacture executability.
 *
 *   This means the bridge:
 *     MAY  → classify broad intent (visual_color, text_change, config_change, workflow_operation)
 *     MAY  → rewrite step labels with category-aware language
 *     MAY  → add rationale for "read first" steps
 *     MAY  → run for both guided_recovery and incomplete completions (both become guide mode)
 *     MUST NOT → guess file paths
 *     MUST NOT → guess current or new values
 *     MUST NOT → turn guided_recovery or incomplete into complete
 *     MUST NOT → change the mode decision
 *     MUST NOT → downgrade safety
 *
 * ── Two interpretation families (keep separate) ───────────────────────────────
 *
 *   Change Interpretation (src/understand/interpretation/)
 *     → For executable, structured patch commands: replace "X" with "Y" in <file>
 *     → Runs when mode === "execute", describes what the change means after the fact
 *
 *   Intent Interpretation Bridge (this module)
 *     → For vague, incomplete requests: "make the button blue"
 *     → Runs when mode === "guide" (guided_recovery), describes what the user
 *       appears to be trying to do
 */

import type { IntentInterpretation, GuidancePayload } from "./types.js";
import type { CompletionResult, CompletionNextStep } from "../completion/types.js";
import type { UnderstandContext } from "../shared/types.js";
import { ALL_INTENT_INTERPRETERS } from "./registry.js";

// ─── runIntentInterpretation ──────────────────────────────────────────────────

/**
 * Run the interpreter registry against the input.
 *
 * Returns the first safe, non-null interpretation (registry is priority-ordered).
 * Returns null if no interpreter claims the input.
 *
 * CONTRACT: null means "no safe classification exists" — not "unknown".
 * The `unknown` category exists in the type system but the registry never
 * returns it; callers should treat null as "no interpretation available."
 */
export function runIntentInterpretation(input: string): IntentInterpretation | null {
  for (const interpreter of ALL_INTENT_INTERPRETERS) {
    if (interpreter.matches(input)) {
      const result = interpreter.interpret(input);
      if (result !== null) return result;
    }
  }
  return null;
}

// ─── Enriched step labels ──────────────────────────────────────────────────────
// Category-specific label templates using descriptive placeholders.
// These replace the generic empty-string labels from completion rules.
// The placeholder form ("<file>", "<current color>") communicates intent
// without inventing any actual value.

type StepLabels = Partial<Record<CompletionNextStep["type"], string>>;

const ENRICHED_STEP_LABELS: Readonly<Record<string, StepLabels>> = {
  visual_color: {
    read_first:
      'Open the component file first to find the current color value: "<file>"',
    use_exact_format:
      'Then patch it: replace "<current color>" with "<new color>" in "<file>"',
    add_missing_field:
      "Add the specific color value that should change.",
  },
  text_change: {
    read_first:
      'Open the file first to find the current text value: "<file>"',
    use_exact_format:
      'Then patch it: replace "<current text>" with "<new text>" in "<file>"',
    add_missing_field:
      "Add the specific text string that should change.",
  },
  config_change: {
    read_first:
      'Open the config file first to find the current setting: "<file>"',
    use_exact_format:
      'Then update the config: replace "<current value>" with "<new value>" in "<file>"',
    add_missing_field:
      "Add the specific configuration value that should change.",
  },
  workflow_operation: {
    read_first:
      "Open the file first to check the current state before making changes.",
    use_exact_format:
      'To commit, use the run format: run git commit -m "<your message here>"',
    add_missing_field:
      "Add the specific commit message that describes the change.",
  },
};

function enrichNextSteps(
  steps: readonly CompletionNextStep[],
  interpretation: IntentInterpretation,
): readonly CompletionNextStep[] {
  const labels = ENRICHED_STEP_LABELS[interpretation.category];
  if (labels === undefined) return steps;
  return steps.map((step) => {
    const enriched = labels[step.type];
    return enriched !== undefined ? { ...step, label: enriched } : step;
  });
}

// ─── enrichGuidance ────────────────────────────────────────────────────────────

/**
 * Bridge function: call after completion returns guided_recovery or incomplete.
 *
 * Both guided_recovery and incomplete lead to `guide` response mode, so both
 * can benefit from interpretation-enriched step labels.
 *
 * @param input      Original user input string
 * @param completion The completion result — acts on guided_recovery and incomplete
 * @param _ctx       UnderstandContext — reserved for future context-aware enrichment
 * @returns          GuidancePayload for guided_recovery / incomplete; null for all other kinds
 *
 * When interpretation is found:
 *   → attaches interpretation to guidance
 *   → rewrites nextSteps labels to be category-aware
 *   → never fills in missing[] values
 *
 * When no interpretation is found:
 *   → returns original guidance unchanged (no interpretation field attached)
 *
 * Hard invariant:
 *   Interpretation can improve guidance, but it can never manufacture executability.
 *   This function MUST NOT return complete or change the mode decision.
 */
export function enrichGuidance(
  input: string,
  completion: CompletionResult,
  _ctx: UnderstandContext,
): GuidancePayload | null {
  if (completion.kind !== "guided_recovery" && completion.kind !== "incomplete") return null;

  const interpretation = runIntentInterpretation(input);

  if (interpretation === null) {
    return {
      missing:   completion.missing,
      nextSteps: completion.nextSteps,
    };
  }

  return {
    missing:        completion.missing,
    nextSteps:      enrichNextSteps(completion.nextSteps, interpretation),
    interpretation,
  };
}
