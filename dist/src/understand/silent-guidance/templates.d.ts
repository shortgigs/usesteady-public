/**
 * Silent Guidance Templates.
 *
 * Maps each SilentGuidanceMode to a set of generic, domain-appropriate
 * CompletionNextStep entries.  These replace the code-patch default
 * for bridge-silent flows.
 *
 * ── Template contracts ────────────────────────────────────────────────────────
 *
 *   - Every template has exactly 3 steps (read_first, use_exact_format,
 *     add_missing_field) — the same structural shape as the code-patch default.
 *   - No template invents specifics (file names, tool names, table names, etc.).
 *   - No template implies executability.  All remain in guide mode territory.
 *   - Templates use angle-bracket placeholders for values the user must supply.
 *
 * ── Why 3 steps ──────────────────────────────────────────────────────────────
 *
 *   read_first       — orients the user: gather information before acting
 *   use_exact_format — shows the deterministic format to express the change
 *   add_missing_field — names what the user must provide to make it actionable
 */
import type { CompletionNextStep } from "../completion/types.js";
import type { SilentGuidanceMode } from "./types.js";
/**
 * Return the generic next-step template for a given silent guidance mode.
 *
 * Returns a read-only array with exactly 3 steps.
 * The array is a module-level constant — no allocation on each call.
 */
export declare function getSilentGuidanceSteps(mode: SilentGuidanceMode): readonly CompletionNextStep[];
//# sourceMappingURL=templates.d.ts.map