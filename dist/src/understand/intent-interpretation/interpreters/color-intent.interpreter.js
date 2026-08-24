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
const COLOR_WORDS_RE = /\b(blue|red|green|yellow|orange|purple|pink|black|white|gray|grey|teal|indigo|violet|cyan|magenta|coral|slate|stone|zinc|neutral|amber|lime|emerald|sky|rose|darker|lighter|dark|light|colors?|colours?)\b/i;
const UI_COLOR_TARGETS_RE = /\b(button|background|header|footer|nav|sidebar|icon|badge|label|link|card|chip|tag|border|text|heading|banner|hero|modal|overlay|avatar)\b/i;
/**
 * Noun-context guard: "dark mode" is a compound noun (UI theme feature),
 * not a color/shade description. Matched exactly as a phrase to avoid
 * over-suppression of "dark background", "dark overlay", etc.
 */
const DARK_MODE_GUARD_RE = /\bdark\s+mode\b/i;
export const colorIntentInterpreter = {
    id: "color_intent",
    priority: 20,
    matches(input) {
        if (DARK_MODE_GUARD_RE.test(input))
            return false;
        return COLOR_WORDS_RE.test(input);
    },
    interpret(input) {
        if (DARK_MODE_GUARD_RE.test(input))
            return null;
        const colorMatch = COLOR_WORDS_RE.exec(input);
        if (colorMatch === null)
            return null;
        const basis = [`matched color word: ${colorMatch[1]}`];
        const targetMatch = UI_COLOR_TARGETS_RE.exec(input);
        if (targetMatch !== null) {
            basis.push(`ui target term: ${targetMatch[1]}`);
        }
        return {
            category: "visual_color",
            summary: "This appears to be a color/style change request.",
            confidence: targetMatch !== null ? "medium" : "low",
            basis,
        };
    },
};
//# sourceMappingURL=color-intent.interpreter.js.map