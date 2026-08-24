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
export declare function interpretChange(input: string): InterpretationResult | null;
//# sourceMappingURL=interpretation.d.ts.map