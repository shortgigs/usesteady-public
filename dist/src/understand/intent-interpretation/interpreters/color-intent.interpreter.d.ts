/**
 * Color intent interpreter.
 *
 * Scope: detect inputs that appear to be visual/color style changes.
 * Priority 20 — runs after config (which owns toggle/enable verbs).
 *
 * Color signal words: named colors, comparative terms (darker/lighter), and
 * the generic words "color" / "colour".
 *
 * UI target terms: component names that contextualize the color signal and
 * raise confidence from "low" (color word only) to "medium" (color + target).
 *
 * Noun-context guard — DARK MODE:
 *   "dark mode" as a compound noun refers to a UI theme variant, not a shade/color
 *   change. The word "dark" alone would otherwise trigger this interpreter (false
 *   positive). If the input contains the phrase "dark mode", the interpreter returns
 *   null and yields to the config interpreter or bridge silence.
 *
 *   Examples of the guard in action:
 *     "I want to add dark mode"   → null  (feature request, not color change)
 *     "add a dark mode option"    → null  (same: feature request)
 *     "make the background dark"  → visual_color  (shade change — guard does NOT fire)
 *     "darker shade of blue"      → visual_color  (no "dark mode" phrase — guard OK)
 *     "enable dark mode"          → config_change (config fires first at priority 10)
 *
 * Language contract:
 *   Summary says "appears to be a color/style change request" — medium confidence.
 *   Never says "background becomes blue" or infers the component type.
 *   basis[] reports the exact matched token so the result is inspectable.
 */
import type { IntentInterpreter } from "../types.js";
export declare const colorIntentInterpreter: IntentInterpreter;
//# sourceMappingURL=color-intent.interpreter.d.ts.map