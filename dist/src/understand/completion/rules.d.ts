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
import type { CompletionRule } from "./types.js";
/**
 * "run again" / "redo" when a prior session with a known last input exists.
 * Resolves the context-dependent request to complete — the effective command
 * is ctx.lastInput, which the caller must use for execution.
 */
export declare const rerunPreviousRule: CompletionRule;
export declare const runTestsRule: CompletionRule;
export declare const readFileRule: CompletionRule;
export declare const replaceExactRule: CompletionRule;
export declare const commitWithMessageRule: CompletionRule;
export declare const patchStructuredRule: CompletionRule;
export declare const gitOpsRule: CompletionRule;
/**
 * rename <oldPath> to <newPath>
 * Both tokens must be present and non-whitespace.
 */
export declare const renameExactRule: CompletionRule;
/**
 * create file <path>
 * Explicit "file" keyword + path token required.
 */
export declare const createFileRule: CompletionRule;
/**
 * create folder|directory <path>
 */
export declare const createDirRule: CompletionRule;
/**
 * delete/remove file|folder|directory <path>   — explicit type keyword
 * delete/remove <path>                          — bare path with slash or extension
 *
 * Both forms require a path token that looks like a real file system path
 * (slash-separated or has an extension). Bare nouns ("delete cache",
 * "delete everything") fall through to deleteBareNounRule.
 */
export declare const deleteExactRule: CompletionRule;
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
export declare const runCommandRule: CompletionRule;
/**
 * "change bg-blue-500 to bg-red-500" — both old and new values are explicit
 * (CSS class-name tokens), but a file path is missing. This is incomplete,
 * not vague: the user has specified what to change but not where.
 *
 * Pattern: change / set <css-class> to <css-class>
 * The CSS class token regex matches e.g. bg-red-500, text-blue-700, p-4, etc.
 * Both sides of "to" must look like CSS tokens; otherwise falls through.
 */
export declare const changeCssClassMissingFileRule: CompletionRule;
/**
 * "commit my changes", "commit everything", "commit this" — intent is commit,
 * message is missing. Not vague; just incomplete.
 */
export declare const commitMissingMessageRule: CompletionRule;
/**
 * "show latest change", "show recent change" — intent is show git history,
 * but the exact target is underspecified. Missing: what specifically to show.
 */
export declare const showLatestChangeRule: CompletionRule;
/**
 * rename <path>  (source present, target absent)
 * "rename Button.tsx" — user knows the source but forgot the destination.
 */
export declare const renameMissingTargetRule: CompletionRule;
/**
 * delete/remove <bare noun>  (path has no slash or extension → not file-like)
 * "delete the old component", "delete cache" — intent is delete but path is vague.
 */
export declare const deleteBareNounRule: CompletionRule;
/**
 * run (with no command token)
 * "run" alone — intent is clear, specific command is missing.
 */
export declare const runNoCommandRule: CompletionRule;
/**
 * create <noun> without a recognizable path
 * "create a component", "create something" — intent is create but path is vague.
 */
export declare const createNoPathRule: CompletionRule;
export declare const vagueStyleChangeRule: CompletionRule;
/**
 * "patch the file", "apply the patch" without structured params.
 * Patch intent is present, but required fields are absent.
 */
export declare const vaguePatchRule: CompletionRule;
/**
 * "update the styles", "improve the performance" — generic imperative
 * with no concrete target. The intent verb is known but the target is vague.
 *
 * Note: "fix" is handled separately below with richer guidance (P2).
 */
export declare const vagueTaskRule: CompletionRule;
/**
 * "fix the bug", "fix the login error", "fix the auth module" — intent is
 * fix, but the location and symptom are absent or underspecified.
 *
 * This rule produces the diagnostic-first guidance pattern:
 *   1. Identify where the issue occurs (area / file)
 *   2. Observe the symptom before changing anything
 *   3. Use a concrete replace operation once the values are known
 */
export declare const fixVagueRule: CompletionRule;
export declare const boundaryRule: CompletionRule;
export declare const ALL_COMPLETION_RULES: ReadonlyArray<CompletionRule>;
//# sourceMappingURL=rules.d.ts.map