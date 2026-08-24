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
import type { CompletionResult } from "../completion/types.js";
import type { UnderstandContext } from "../shared/types.js";
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
export declare function runIntentInterpretation(input: string): IntentInterpretation | null;
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
export declare function enrichGuidance(input: string, completion: CompletionResult, _ctx: UnderstandContext): GuidancePayload | null;
//# sourceMappingURL=intent-interpretation.d.ts.map