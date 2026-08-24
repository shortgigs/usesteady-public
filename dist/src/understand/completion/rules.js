/**
 * Completion rules registry.
 *
 * Each rule owns a named, prioritised, testable pattern.
 * Priority: lower number = runs first.
 *
 * Groups (by priority band):
 *   1–20   Context-aware complete rules (require prior session)
 *  21–50   Stateless complete rules (exact deterministic format)
 *  51–70   Incomplete rules (intent clear, field missing)
 *  71–100  Guided-recovery rules (vague intent)
 *
 * Rules MUST NOT guess or infer values.
 * Rules MUST return null if the input is outside their scope.
 */
// ─── Compound request guard ───────────────────────────────────────────────────
// Inputs like "rename X to Y and update all imports" describe more than one
// operation. Completion rules must reject them so the system never silently
// executes only the first half.
const COMPOUND_RE = /\s+(and|then|also|,\s*also|,\s*then)\s+\S/i;
function isCompound(input) {
    return COMPOUND_RE.test(input);
}
// ─── Context-aware complete rules (priority 1–20) ─────────────────────────────
/**
 * "run again" / "redo" when a prior session with a known last input exists.
 * Resolves the context-dependent request to complete — the effective command
 * is ctx.lastInput, which the caller must use for execution.
 */
export const rerunPreviousRule = {
    id: "rerun_previous",
    priority: 5,
    matches(input, ctx) {
        return (/\b(run\s+again|redo|repeat\s+last)\b/i.test(input) &&
            ctx.hasPriorSession === true &&
            ctx.lastInput !== undefined &&
            ctx.lastInput.length > 0);
    },
    evaluate(_input, ctx) {
        if (!ctx.hasPriorSession || !ctx.lastInput)
            return null;
        return { kind: "complete" };
    },
};
// ─── Stateless complete rules (priority 21–50) ────────────────────────────────
export const runTestsRule = {
    id: "run_tests",
    priority: 21,
    matches(input) {
        return /^\s*(run\s+(?:the\s+)?(?:tests?|test\s+suite|unit\s+tests?|specs?|vitest)|vitest)\s*$/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
export const readFileRule = {
    id: "read_file",
    priority: 22,
    matches(input) {
        return /^\s*read\s+["']?[^\s"']+/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
export const replaceExactRule = {
    id: "replace_exact",
    priority: 23,
    matches(input) {
        if (isCompound(input))
            return false;
        // Mirror all variants that matchReplace() in intent.ts supports:
        //   replace "X" with "Y" in file    (double quotes)
        //   replace 'X' with 'Y' in file    (single quotes)
        //   change  "X" to   "Y" in file    (double quotes, natural phrasing)
        //   change  'X' to   'Y' in file    (single quotes)
        return (/^\s*replace\s+"[^"]+"\s+with\s+"[^"]+"\s+in\s+/i.test(input) ||
            /^\s*replace\s+'[^']+'\s+with\s+'[^']+'\s+in\s+/i.test(input) ||
            /^\s*change\s+"[^"]+"\s+to\s+"[^"]+"\s+in\s+/i.test(input) ||
            /^\s*change\s+'[^']+'\s+to\s+'[^']+'\s+in\s+/i.test(input));
    },
    evaluate() {
        return { kind: "complete" };
    },
};
export const commitWithMessageRule = {
    id: "commit_with_message",
    priority: 24,
    matches(input) {
        return /^\s*(commit|git\s+commit)\s+"[^"]+"\s*$/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
export const patchStructuredRule = {
    id: "patch_structured",
    priority: 25,
    matches(input) {
        if (isCompound(input))
            return false;
        return /^\s*patch\s+\S+\s+search="[^"]+"\s+replace="[^"]+"/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
export const gitOpsRule = {
    id: "git_ops",
    priority: 26,
    matches(input) {
        return /^\s*(git\s+status|show\s+git\s+status|git\s+log\b|git\s+show\b|show\s+last\s+commit|show\s+(recent|last|latest)\s+commits?|show\s+commit\b|list\s*$|ls\b|stat\b|info\b)/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
// ─── P0: Direct-capable family complete rules (priority 27–35) ───────────────
//
// These rules close the gap between the declared DIRECT_CAPABLE_FAMILIES
// (rename / create / delete / run) and actual deterministic completion.
//
// Each rule mirrors the parser.ts regex precisely so that parseChange()
// and completion agree on what is executable.
//
// CONTRACT: parser.ts and these rules use the same structural patterns.
// A parseable input MUST have a matching complete rule, and vice versa.
/**
 * rename <oldPath> to <newPath>
 * Both tokens must be present and non-whitespace.
 */
export const renameExactRule = {
    id: "rename_exact",
    priority: 27,
    matches(input) {
        if (isCompound(input))
            return false;
        // Mirrors normalizer's matchRename: supports "rename", "move",
        // optional "the file|folder|directory" article noise, and quoted paths.
        return (/^\s*(?:rename|move)\s+(?:the\s+(?:file|folder|directory)\s+)?\S+\s+to\s+\S+/i.test(input) ||
            /^\s*(?:rename|move)\s+"[^"]+"\s+to\s+"[^"]+"/i.test(input) ||
            /^\s*(?:rename|move)\s+'[^']+'\s+to\s+'[^']+'/i.test(input));
    },
    evaluate() {
        return { kind: "complete" };
    },
};
/**
 * create file <path>
 * Explicit "file" keyword + path token required.
 */
export const createFileRule = {
    id: "create_file",
    priority: 28,
    matches(input) {
        if (isCompound(input))
            return false;
        return /^\s*create\s+file\s+\S+/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
/**
 * create folder|directory <path>
 */
export const createDirRule = {
    id: "create_dir",
    priority: 29,
    matches(input) {
        if (isCompound(input))
            return false;
        return /^\s*create\s+(?:folder|directory)\s+\S+/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
/**
 * delete/remove file|folder|directory <path>   — explicit type keyword
 * delete/remove <path>                          — bare path with slash or extension
 *
 * Both forms require a path token that looks like a real file system path
 * (slash-separated or has an extension). Bare nouns ("delete cache",
 * "delete everything") fall through to deleteBareNounRule.
 */
export const deleteExactRule = {
    id: "delete_exact",
    priority: 30,
    matches(input) {
        if (isCompound(input))
            return false;
        return (/^\s*(?:delete|remove)\s+(?:file|folder|directory)\s+\S+/i.test(input) ||
            /^\s*(?:delete|remove)\s+(?:\S+\/\S+|\S+\.\S+)/i.test(input));
    },
    evaluate() {
        return { kind: "complete" };
    },
};
/**
 * run <command>
 *
 * Any "run <token>" input that is NOT already handled by runTestsRule
 * (priority 21) is complete. runTestsRule runs first — so "run tests",
 * "run vitest", etc. never reach this rule.
 *
 * Examples: run npm install, run npx tsx src/main.ts, run ./build.sh
 *
 * Exclusions:
 *   - "run" alone → falls through to runNoCommandRule (priority 56).
 *   - Compound workflow sentences ("run tests and then commit", "run X then Y")
 *     contain multi-step intent and must NOT be treated as a single run op.
 *     Those stay in guided mode so the workflow interpreter can handle them.
 */
export const runCommandRule = {
    id: "run_command",
    priority: 33,
    matches(input) {
        // Compound workflow ("run tests and then commit") → stays in guide mode
        if (/\b(and\s+then|then\s+\w|followed\s+by)\b/i.test(input))
            return false;
        // Context-dependent re-run phrases ("run again", "run it") → handled by rerunPreviousRule
        if (/^\s*run\s+(?:again|that|it|this|same)\s*$/i.test(input))
            return false;
        // Article/pronoun-prefixed domain actions ("run the migrations", "run my pipeline")
        // are domain concepts, not shell commands — they should stay in guide mode.
        if (/^\s*run\s+(?:the|a|an|my|our|all)\s/i.test(input))
            return false;
        return /^\s*run\s+\S/i.test(input);
    },
    evaluate() {
        return { kind: "complete" };
    },
};
// ─── Incomplete rules (priority 51–70) ────────────────────────────────────────
// Intent is clear; a specific required field is absent.
/**
 * "change bg-blue-500 to bg-red-500" — both old and new values are explicit
 * (CSS class-name tokens), but a file path is missing. This is incomplete,
 * not vague: the user has specified what to change but not where.
 *
 * Pattern: change / set <css-class> to <css-class>
 * The CSS class token regex matches e.g. bg-red-500, text-blue-700, p-4, etc.
 * Both sides of "to" must look like CSS tokens; otherwise falls through.
 */
export const changeCssClassMissingFileRule = {
    id: "change_css_class_missing_file",
    priority: 51,
    matches(input) {
        return /\b(change|set)\s+[a-z][\w-]*-\d+\s+to\s+[a-z][\w-]*-\d+\b/i.test(input);
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "The old and new values are clear, but a file path is required.",
            missing: ["file path"],
            nextSteps: [
                { type: "read_first", label: "Open the file first to find the exact class you want to change." },
                { type: "use_exact_format", label: 'replace "<old class>" with "<new class>" in <file>' },
            ],
        };
    },
};
/**
 * "commit my changes", "commit everything", "commit this" — intent is commit,
 * message is missing. Not vague; just incomplete.
 */
export const commitMissingMessageRule = {
    id: "commit_missing_message",
    priority: 55,
    matches(input) {
        // Commit intent without a quoted message string
        return /\b(commit|git\s+commit)\b(?!\s*")/i.test(input);
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "A commit message is required.",
            missing: ["commit message"],
            nextSteps: [
                { type: "use_exact_format", label: 'commit ""' },
            ],
        };
    },
};
/**
 * "show latest change", "show recent change" — intent is show git history,
 * but the exact target is underspecified. Missing: what specifically to show.
 */
export const showLatestChangeRule = {
    id: "show_latest_change",
    priority: 60,
    matches(input) {
        return /\bshow\s+(latest|recent|last)\s+change\b/i.test(input);
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "'show latest change' requires a specific target.",
            missing: ["specific target"],
            nextSteps: [
                { type: "use_exact_format", label: "show last commit" },
            ],
        };
    },
};
// ─── P0: Incomplete rules for direct-capable families (priority 52–58) ────────
//
// Intent family is clear (rename / delete / run), but a required slot is absent.
// These run AFTER the complete rules so they only fire when the full form is missing.
/**
 * rename <path>  (source present, target absent)
 * "rename Button.tsx" — user knows the source but forgot the destination.
 */
export const renameMissingTargetRule = {
    id: "rename_missing_target",
    priority: 52,
    matches(input) {
        // Has "rename <something>" but NOT "to <something>"
        return /^\s*rename\s+\S+/i.test(input) && !/\bto\s+\S+/i.test(input);
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "The source path is present but the target name is missing.",
            missing: ["target path"],
            nextSteps: [
                { type: "use_exact_format", label: "rename <old-path> to <new-path>" },
            ],
        };
    },
};
/**
 * delete/remove <bare noun>  (path has no slash or extension → not file-like)
 * "delete the old component", "delete cache" — intent is delete but path is vague.
 */
export const deleteBareNounRule = {
    id: "delete_bare_noun",
    priority: 54,
    matches(input) {
        // Matches delete/remove verb but is NOT caught by deleteExactRule
        return (/^\s*(?:delete|remove)\b/i.test(input) &&
            !/(?:file|folder|directory)\s+\S+/i.test(input) &&
            !/(?:\S+\/\S+|\S+\.\S+)/.test(input));
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "A specific file path is required — bare nouns are not sufficient.",
            missing: ["exact file path"],
            nextSteps: [
                { type: "use_exact_format", label: "delete file <path>" },
                { type: "use_exact_format", label: "delete <path/with/extension>" },
            ],
        };
    },
};
/**
 * run (with no command token)
 * "run" alone — intent is clear, specific command is missing.
 */
export const runNoCommandRule = {
    id: "run_no_command",
    priority: 56,
    matches(input) {
        return /^\s*run\s*$/i.test(input);
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "A specific command is required.",
            missing: ["command to run"],
            nextSteps: [
                { type: "use_exact_format", label: "run npm install" },
                { type: "use_exact_format", label: "run npx tsx <file>" },
            ],
        };
    },
};
/**
 * create <noun> without a recognizable path
 * "create a component", "create something" — intent is create but path is vague.
 */
export const createNoPathRule = {
    id: "create_no_path",
    priority: 58,
    matches(input) {
        // Has "create" verb but NOT the specific file|folder|directory keyword + path
        return (/^\s*create\b/i.test(input) &&
            !/create\s+(?:file|folder|directory)\s+\S+/i.test(input));
    },
    evaluate() {
        return {
            kind: "incomplete",
            reason: "A specific file or directory path is required.",
            missing: ["exact path"],
            nextSteps: [
                { type: "use_exact_format", label: "create file <path>" },
                { type: "use_exact_format", label: "create folder <path>" },
            ],
        };
    },
};
// ─── Guided-recovery rules (priority 71–100) ──────────────────────────────────
// Intent is vague; the system provides a safe path without guessing values.
/**
 * "make button blue", "change color to dark", "set header red" — vague visual
 * change. File path, current value, and new value are all unknown.
 *
 * Exclusions (must not fire):
 *   1. "dark mode" compound noun — config concept, not a shade change.
 *      Consistent with the dark-mode guard in color-intent.interpreter.ts.
 *   2. Inputs whose values are explicit CSS class-name tokens (e.g., bg-red-500,
 *      text-blue-700). These have exact values but are missing only a file path;
 *      they should fall through to the completionFallback or a more specific
 *      incomplete rule — not be labelled "values unknown".
 */
const DARK_MODE_COMPOUND_RE = /\bdark\s+mode\b/i;
const CSS_CLASS_TOKEN_RE = /\b[a-z]+-[a-z0-9]+-\d{2,3}\b/i; // e.g. bg-red-500, text-blue-700
export const vagueStyleChangeRule = {
    id: "vague_style_change",
    priority: 75,
    matches(input) {
        if (DARK_MODE_COMPOUND_RE.test(input))
            return false;
        if (CSS_CLASS_TOKEN_RE.test(input))
            return false;
        return /\b(make|change|set|update)\b.{0,40}\b(blue|red|green|dark|light|white|black|color)\b/i.test(input);
    },
    evaluate() {
        return {
            kind: "guided_recovery",
            reason: "Visual style changes require an exact file path and search/replace values.",
            missing: ["file path", "current value", "new value"],
            nextSteps: [
                { type: "read_first", label: "Open the file first to find the exact current style value." },
                { type: "use_exact_format", label: 'replace "<current style>" with "<new style>" in <file>' },
            ],
        };
    },
};
/**
 * "patch the file", "apply the patch" without structured params.
 * Patch intent is present, but required fields are absent.
 */
export const vaguePatchRule = {
    id: "vague_patch",
    priority: 80,
    matches(input) {
        return /\b(patch|apply\s+patch)\b(?!\s+\S+\s+search=)/i.test(input);
    },
    evaluate() {
        return {
            kind: "guided_recovery",
            reason: "Patch requires a file path and exact search/replace values.",
            missing: ["file path", "search value", "replace value"],
            nextSteps: [
                { type: "read_first", label: "Open the file first to find the exact text you want to change." },
                { type: "use_exact_format", label: 'replace "<old text>" with "<new text>" in <file>' },
            ],
        };
    },
};
/**
 * "update the styles", "improve the performance" — generic imperative
 * with no concrete target. The intent verb is known but the target is vague.
 *
 * Note: "fix" is handled separately below with richer guidance (P2).
 */
export const vagueTaskRule = {
    id: "vague_task",
    priority: 90,
    matches(input) {
        return /^\s*(update|improve|refactor|clean\s+up)\b/i.test(input);
    },
    evaluate() {
        return {
            kind: "guided_recovery",
            reason: "The request is too vague to prepare a deterministic action.",
            missing: ["exact target", "specific change"],
            nextSteps: [
                { type: "read_first", label: "Open the file first to find the exact text and value you want to change." },
                { type: "use_exact_format", label: 'replace "<current text>" with "<new text>" in <file>' },
            ],
        };
    },
};
// ─── P2: Fix family — deepened guided-recovery (priority 91) ─────────────────
//
// "fix" is the strongest guided family from probe batch 1. Preserve and deepen
// the model: identify area, surface symptom, narrow to one concrete change.
/**
 * "fix the bug", "fix the login error", "fix the auth module" — intent is
 * fix, but the location and symptom are absent or underspecified.
 *
 * This rule produces the diagnostic-first guidance pattern:
 *   1. Identify where the issue occurs (area / file)
 *   2. Observe the symptom before changing anything
 *   3. Use a concrete replace operation once the values are known
 */
export const fixVagueRule = {
    id: "fix_vague",
    priority: 91,
    matches(input) {
        return /^\s*fix\b/i.test(input);
    },
    evaluate() {
        return {
            kind: "guided_recovery",
            reason: "Fix requires a specific file or symptom before a deterministic change can be prepared.",
            missing: ["exact target", "specific change"],
            nextSteps: [
                { type: "read_first", label: "Identify where the issue occurs and gather observable evidence before making any change." },
                { type: "add_missing_field", label: "Provide the exact symptom, test name, or failure condition so the change can be targeted." },
                { type: "use_exact_format", label: 'replace "" with "" in ""' },
            ],
        };
    },
};
// ─── P1: Deterministic boundary recognizer (priority 95) ─────────────────────
//
// Inputs that describe multi-step feature development, architectural work, or
// tasks that are fundamentally outside UseSteady's five frozen operations.
//
// These are sent to guided_recovery with a boundary-specific message that
// tells the user what IS supported — not just a generic "too vague" reply.
//
// Scope (deliberately narrow — only patterns that are clearly out of scope):
//   redesign / rewrite the X      → architectural work
//   write/add tests/specs for     → test authoring (not a file op)
//   implement a new X             → feature development
//   add a new page/service/module → new feature development
//   make X faster/better/smarter  → performance/quality improvement
//   build a X / set up a X        → project scaffolding
export const boundaryRule = {
    id: "boundary",
    priority: 95,
    matches(input) {
        return (
        // Architectural / rewrite
        /\b(redesign|rearchitect|rewrite\s+(?:the|all|everything|from\s+scratch))\b/i.test(input) ||
            // Test authoring
            /\b(write|add|generate)\s+(?:unit\s+)?(?:tests?|specs?|test\s+cases?)\s+(?:for|in|to)\b/i.test(input) ||
            // Feature development
            /\b(implement|build|set\s+up|scaffold)\s+(?:a|an|the)\b/i.test(input) ||
            // Add a new X (page / service / module / feature / endpoint / component)
            /\badd\s+a\s+new\s+\w+/i.test(input) ||
            // Performance / quality improvement
            /\bmake\s+(?:it|the|my|everything)\s+(?:faster|better|smarter|more\s+efficient|more\s+performant)\b/i.test(input));
    },
    evaluate() {
        return {
            kind: "guided_recovery",
            reason: "This request describes work outside UseSteady's eight supported operations.",
            missing: [],
            // Governance: lists every op in OPERATION_REGISTRY at least once.
            // tests/governance/input-surface-integrity.test.ts asserts this.
            nextSteps: [
                { type: "use_exact_format", label: "Supported: replace \"old\" with \"new\" in <file>" },
                { type: "use_exact_format", label: "Supported: append \"<text>\" to <file>  |  prepend \"<text>\" to <file>" },
                { type: "use_exact_format", label: "Supported: rename <old-path> to <new-path>" },
                { type: "use_exact_format", label: "Supported: create file <path>  |  mkdir <path>  |  delete file <path>  |  run <command>" },
            ],
        };
    },
};
// ─── Ordered registry ─────────────────────────────────────────────────────────
export const ALL_COMPLETION_RULES = [
    // Context-aware complete (1–20)
    rerunPreviousRule,
    // Stateless complete (21–35)
    runTestsRule,
    readFileRule,
    replaceExactRule,
    commitWithMessageRule,
    patchStructuredRule,
    gitOpsRule,
    renameExactRule,
    createFileRule,
    createDirRule,
    deleteExactRule,
    runCommandRule,
    // Incomplete — missing field (51–70)
    changeCssClassMissingFileRule,
    renameMissingTargetRule,
    deleteBareNounRule,
    runNoCommandRule,
    createNoPathRule,
    commitMissingMessageRule,
    showLatestChangeRule,
    // Guided-recovery — vague intent (71–100)
    vagueStyleChangeRule,
    vaguePatchRule,
    vagueTaskRule,
    fixVagueRule,
    boundaryRule,
].sort((a, b) => a.priority - b.priority);
//# sourceMappingURL=rules.js.map