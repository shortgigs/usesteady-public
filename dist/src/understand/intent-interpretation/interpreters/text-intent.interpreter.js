/**
 * Text intent interpreter.
 *
 * Scope: detect inputs that appear to be UI text/copy changes.
 * Priority 30 — runs last; requires BOTH a text-change verb AND a text target.
 * This tighter match prevents generic verbs ("change") alone from triggering.
 *
 * Text change verbs: change, update, rename, edit, modify, rewrite, replace
 * Text target terms: heading, headline, text, label, copy, title, caption,
 *                    paragraph, message, description, placeholder, content,
 *                    wording, phrase
 *
 * "change the heading text" → text_change  (verb + target both present)
 * "change the background"   → not matched  (no text target → falls through to color)
 * "rename the title"        → text_change  (rename is a strong text verb)
 * "update button label"     → text_change  (update + label)
 *
 * Language contract:
 *   Summary says "appears to be a text/content change request."
 *   Does NOT say "heading label" or infer element type from the target word.
 *   basis[] records both matched tokens.
 */
const TEXT_VERBS_RE = /\b(change|update|rename|edit|modify|rewrite|replace)\b/i;
const TEXT_TARGETS_RE = /\b(heading|headline|label|copy|title|caption|paragraph|message|description|placeholder|content|wording|phrase|sentence|text)\b/i;
export const textIntentInterpreter = {
    id: "text_intent",
    priority: 30,
    matches(input) {
        return TEXT_VERBS_RE.test(input) && TEXT_TARGETS_RE.test(input);
    },
    interpret(input) {
        const verbMatch = TEXT_VERBS_RE.exec(input);
        const targetMatch = TEXT_TARGETS_RE.exec(input);
        if (verbMatch === null || targetMatch === null)
            return null;
        return {
            category: "text_change",
            summary: "This appears to be a text/content change request.",
            confidence: "medium",
            basis: [
                `matched text change verb: ${verbMatch[1]}`,
                `matched text target: ${targetMatch[1]}`,
            ],
        };
    },
};
//# sourceMappingURL=text-intent.interpreter.js.map