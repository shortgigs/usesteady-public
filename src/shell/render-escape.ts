/**
 * Shared escape + lifecycle-glyph primitives for every adjacent
 * render surface that displays user-authored content before
 * approval.
 *
 * ── Why this module exists ────────────────────────────────────────────────────
 *
 *   The alpha.55 walkthrough exposed a real trust-clarity gap: the
 *   SYSTEM WILL `Preview:` block escaped multi-line content correctly
 *   (so a `\n` inside an appended string never forged a new visual
 *   line), but two ADJACENT surfaces rendering the same content did
 *   not:
 *
 *     1. The pre-approval intake echo ("I translated your request
 *        into safe steps:"  -> `[ok] Step N: Append "<value>" to
 *        <file>`). Multi-line `<value>` produced a visually broken
 *        echo where the closing quote and the rest of the step
 *        landed on a second visual line.
 *
 *     2. The `You asked:` line inside `task_ready` and
 *        `task_conflict` frames. Same root cause: the canonical
 *        input string carries the user's content verbatim, including
 *        embedded newlines, and was rendered without inline
 *        escaping.
 *
 *   First-time users reading these three surfaces side-by-side saw
 *   three different representations of the same content. That is
 *   exactly the dissonance alpha.55 was designed to eliminate, just
 *   one surface short of the goal.
 *
 *   This module is the single source of truth for the escape rule
 *   AND for the lifecycle-stage glyphs every adjacent surface uses.
 *   Importing this module costs no runtime cycles and pulls in no
 *   dependencies.
 *
 * ── What this module is NOT ───────────────────────────────────────────────────
 *
 *   * Not a rendering engine. Output is still plain strings; callers
 *     own their layout.
 *   * Not a semantic interpreter. The escape rule is mechanical:
 *     `\t` / `\r` / `\n` become the C-style escape sequences `\\t`
 *     / `\\r` / `\\n`. Nothing else.
 *   * Not an authority surface. No execution, no approval, no
 *     planner influence. Pure functions.
 *   * Not a paraphrase. Content bytes survive escape unchanged
 *     except where a control character would forge a visual line.
 *
 * ── Determinism ───────────────────────────────────────────────────────────────
 *
 *   `escapeControlForInline` is a pure function. Identical input
 *   produces identical bytes across every call, in every process,
 *   on every platform.
 */

/**
 * Escape the control characters that forge new visual lines when a
 * user-authored string is rendered inline.
 *
 * Replaces, in order:
 *
 *   `\t` -> `\\t`
 *   `\r` -> `\\r`
 *   `\n` -> `\\n`
 *
 * Does NOT escape `"` or `\` — both surfaces that call this primitive
 * already embed user content inside a quoted grammar token (`append
 * "<value>" to <file>`), and altering `"` or `\` would change the
 * canonical-form bytes downstream consumers (including the intake
 * parser via `draftTaskToInput`) depend on. The Preview block, which
 * needs full disambiguation because it ADDS quotes around the
 * content itself, applies the additional `\` and `"` escape on top
 * of this primitive (see `previewInline` in
 * `src/shell/workflow-render.ts`).
 *
 * Pure. Deterministic. Always produces a single visual line of
 * output for any input string.
 */
export function escapeControlForInline(raw: string): string {
  return raw
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

// ── Lifecycle stage glyphs ────────────────────────────────────────────────────
//
// Stage vocabulary (alpha.56 trust-consistency refinement):
//
//   * `[parsed]`  — pre-approval intake echo. The CLI has parsed
//                   the request and produced a draft. NOT executed.
//   * `[ ? ]`     — needs_confirmation: the parser produced an
//                   uncertain clause that the operator must rewrite
//                   before any approval is offered.
//   * `[done]`    — terminal: the executor accepted the step.
//   * `->`        — approval-time anchor inside SYSTEM WILL.
//
// Pre-alpha.56 the parsed stage used `[ok]`, which read as
// "completed successfully" — the same semantic shape `[done]`
// already owned. A first-time user reading `[ok] Step 1: Append ...`
// BEFORE any approval prompt could legitimately conclude the step
// had already run. The new `[parsed]` glyph removes that ambiguity
// without altering any state-machine behavior.

export const LIFECYCLE_PARSED            = "[parsed]";
export const LIFECYCLE_NEEDS_CONFIRMATION = "[ ? ]";
export const LIFECYCLE_DONE              = "[done]";
