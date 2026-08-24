/**
 * Interpretation rules — v1.
 *
 * Three categories are implemented:
 *   1. Tailwind color change  (priority 10) — most specific, deterministic
 *   2. CSS color change       (priority 20) — hex / rgb / hsl / CSS property
 *   3. Config value change    (priority 30) — config files or value patterns
 *   4. Text literal change    (priority 40) — human-readable UI copy
 *
 * Priority order matters: a Tailwind class could also look like a text literal
 * if rule ordering were reversed. The most specific rule must run first.
 */
import type { InterpretationRule } from "./types.js";
export declare const tailwindColorRule: InterpretationRule;
export declare const cssColorRule: InterpretationRule;
export declare const configValueRule: InterpretationRule;
export declare const textLiteralRule: InterpretationRule;
export declare const ALL_INTERPRETATION_RULES: ReadonlyArray<InterpretationRule>;
//# sourceMappingURL=rules.d.ts.map