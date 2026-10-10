/**
 * Change Interpretation orchestrator — v1.
 *
 * CONTRACT:
 *   Interpretation is ADVISORY. It does not alter the execute/guide/refuse
 *   decision produced by the intake pipeline. It describes what the human
 *   will experience from the change.
 *
 *   Returns null when:
 *     - Input cannot be parsed as a structured change command
 *     - No rule matches the parsed change (change type is outside v1 scope)
 *
 *   v1 scope:
 *     - Tailwind / CSS color changes
 *     - Text literal changes
 *     - Simple config value changes
 *
 * Future scope (not implemented in v1):
 *   - Structural code changes
 *   - Import / dependency changes
 *   - Multi-file changes
 *   - Logic / control-flow changes
 */

import type { InterpretationResult } from "./types.js";
import { isFsChange } from "./types.js";
import { parseChange } from "./parser.js";
import { ALL_INTERPRETATION_RULES } from "./rules.js";

export function interpretChange(input: string): InterpretationResult | null {
  const parsed = parseChange(input);
  if (parsed === null) return null;

  // FS operations have no interpretation rules — their intent is fully explicit.
  if (isFsChange(parsed)) return null;

  for (const rule of ALL_INTERPRETATION_RULES) {
    if (rule.matches(parsed)) {
      const result = rule.interpret(parsed);
      if (result !== null) return result;
    }
  }

  return null;
}
