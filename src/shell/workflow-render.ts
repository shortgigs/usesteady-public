/**
 * Phase 9D: Workflow shell rendering.
 *
 * ── Purpose ───────────────────────────────────────────────────────────────────
 *
 *   Pure function that maps WorkflowRun state → ShellFrame.
 *   No I/O. No coordinator calls. No authority.
 *
 * ── Two-layer read rule (WS6) ─────────────────────────────────────────────────
 *
 *   1. Read WorkflowRun.phase first — determines the frame type and prompt kind.
 *   2. Read currentSession.state.display second — provides task-level detail
 *      (change summary, conflict list, scope candidates, failure note).
 *
 *   Never conflate workflow phase with session phase. See docs/phase-9c-baseline.md
 *   for the full phase distinction table.
 *
 * ── Key invariants (WS1–WS5) ──────────────────────────────────────────────────
 *
 *   WS1: Pure — no side effects, no state mutation.
 *   WS3: task_failed prompt is always "choose" (stop/skip/retry), never "confirm".
 *        A choice prompt cannot imply a default the way a yes/no confirm can.
 *   WS4: Failure note from display.failureNote is preserved verbatim.
 *        exec_error, blocked, rejected, and missing-plugin all have distinct notes.
 *        The renderer never replaces these with a generic "task failed" message.
 *   WS5: completed/stopped frames read history from run.tasks[i].outcome, not
 *        from currentSession (which is absent in those phases).
 *
 * ── task_approved rendering (9C distinction) ──────────────────────────────────
 *
 *   task_approved renders as "Approved — ready to deliver."
 *   Never as "Accepted" or "Completed". Those are delivery outcomes.
 *   The advance functions collapse approve+deliver into one user action, so
 *   task_approved is usually a transient frame — but it must not visually blur.
 *
 * See: docs/phase-9c-baseline.md — workflow/session phase distinction
 *      docs/phase-9d-baseline.md — Phase 9D freeze record
 */

import type { WorkflowRun, WorkflowTaskOutcome, WorkflowTaskSpec } from "../workflow/types.js";
import type { ShellFrame, ShellPrompt }          from "./types.js";
import { escapeControlForInline }                from "./render-escape.js";
import {
  ancestorClosure,
  formatAncestorDirs,
  CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE,
} from "../workflow/effect-closure.js";
import { discloseCreateContent } from "../input/effect-result.js";

// ─── Formatting helpers ───────────────────────────────────────────────────────

const DIVIDER = "─".repeat(52);

function header(label: string): string {
  return `${DIVIDER}\n  ${label}\n${DIVIDER}`;
}

/**
 * S4 / friction #43 — Output truthfulness.
 *
 * The `input` field on a SpecTask is sometimes a stable parser placeholder
 * (e.g. `replace "x" with "y" in <file>` for tasks built from JSON op
 * shapes via `buildSpecTasksFromIROps`). Rendering that placeholder as
 * the "You asked:" line lies to the user — they see fabricated `x`/`y`
 * values for a replace whose real `from`/`to` come from `structuredReplace`.
 *
 * The fix: render from the authoritative source. When `structuredReplace`
 * is set, derive the display string from `oldValue`/`newValue`/`filePath`.
 * Otherwise return `input` verbatim (the NL surfaces already carry the
 * literal user text). This is a render-only transform — `taskSpec.input`
 * stays parser-stable, the executor still uses `structuredReplace`.
 *
 * Quote-escape any embedded `"` so the rendered string is unambiguous.
 * The result is for human display only and is never re-parsed.
 *
 * Exported for the F10-W2 entry-layer pre-approval surface
 * (`src/shell/cli/entry-approval-preview.ts`) so the one-shot intake
 * echo anchors the exact same canonical string the task_ready frame
 * shows — one display truth, two lifecycle stages.
 */
export function truthfulInputDisplay(taskSpec: {
  readonly input: string;
  readonly structuredReplace?: { readonly oldValue: string; readonly newValue: string; readonly filePath: string };
}): string {
  const sr = taskSpec.structuredReplace;
  if (!sr) {
    // alpha.56 / F-A55-2: the canonical `input` field carries the
    // user's content verbatim, including any embedded newlines or
    // tabs. Rendering it inline without escape produced the same
    // "forged visual lines" failure mode SYSTEM WILL's Preview
    // block already closed; this routes the You-asked anchor
    // through the same shared escape primitive so all three
    // adjacent surfaces (intake echo, You asked, Preview) agree
    // on the inline shape of user content.
    return escapeControlForInline(taskSpec.input);
  }
  const esc = (v: string): string =>
    escapeControlForInline(v.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
  return `replace "${esc(sr.oldValue)}" with "${esc(sr.newValue)}" in ${sr.filePath}`;
}

function outcomeSymbol(outcome: WorkflowTaskOutcome): string {
  switch (outcome) {
    case "accepted":          return "[done]";
    case "skipped":           return "[skip]";
    case "skipped_by_intake": return "[auto]";
    case "planning_reviewed": return "[plan]";
    case "stopped":           return "[stop]";
    case "rejected":          return "[reject]";
    case "pending":           return "[...]";
  }
}

// ─── SYSTEM WILL preview helpers (alpha.55) ───────────────────────────────────
//
// Purpose: tighten the explain-before-execute surface so a first-time
// operator reviewing "SYSTEM WILL" can immediately tell, for the
// current task:
//
//   * what kind of change the system will make
//   * which file (or command) it targets
//   * what literal text is being appended/prepended/written
//   * whether a missing file will be created, or an existing file
//     blocks the operation (target_exists)
//
// Authority/safety frame (preserved verbatim from prior phases):
//
//   1. Pure render. No I/O, no state mutation, no execution. WS1.
//   2. Source of truth: WorkflowTaskSpec structured fields. These are
//      the same fields the executor consumes — the preview cannot
//      drift from execution without the spec hash changing (Row 2 /
//      Cluster B trust chain).
//   3. No semantic interpretation. The preview never paraphrases user
//      content. It quotes content verbatim (with C-style escapes for
//      tab/CR/newline so multi-line text never forges visual lines)
//      and reports lengths. No AI summarization.
//   4. The op-kind label is a fixed factual string per type — not
//      derived from input.
//   5. Determinism: identical WorkflowTaskSpec → identical bytes
//      across runs.
//   6. Falls back to empty array for tasks without structured fields
//      (raw NL prompts still in intake). The renderer's existing
//      "You asked:" + "Understood:" lines remain authoritative in
//      that case.

const PREVIEW_INLINE_MAX     = 72;
const PREVIEW_BLOCK_MAX_LINES = 6;
const PREVIEW_BLOCK_MAX_LINE  = 76;

/**
 * Quote-and-escape a string for inline preview. The Preview block
 * embeds the content INSIDE its own quotes (`Content: "<value>"`),
 * so it needs the full disambiguation pass — `\` and `"` are
 * escaped first so the quoted form is unambiguous, then the shared
 * `escapeControlForInline` primitive handles tab/CR/newline.
 * Truncates to PREVIEW_INLINE_MAX visible chars and appends a
 * `(truncated; N chars total)` note when the string exceeds the
 * limit.
 *
 * The shared escape primitive lives in `render-escape.ts` so the
 * intake echo (`formatDraftTask`) and the `You asked:` anchor
 * (`truthfulInputDisplay`) — both adjacent surfaces that render
 * user content before approval — escape control characters
 * identically. See `docs/architecture/...` for the parity contract.
 */
function previewInline(raw: string): string {
  const quoteEscaped = raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const escaped = escapeControlForInline(quoteEscaped);
  if (escaped.length <= PREVIEW_INLINE_MAX) {
    return `"${escaped}"`;
  }
  const head = escaped.slice(0, PREVIEW_INLINE_MAX);
  return `"${head}…" (truncated; ${raw.length} chars total)`;
}

/**
 * Render a multi-line string as an indented `| `-prefixed block.
 * Lines past PREVIEW_BLOCK_MAX_LINES are dropped and replaced with a
 * "N more lines truncated" tail. Per-line characters past
 * PREVIEW_BLOCK_MAX_LINE are dropped with a trailing ellipsis. The
 * header reports the full line and char count so the operator can
 * tell when content was truncated.
 */
function previewBlock(raw: string): readonly string[] {
  const lines  = raw.split("\n");
  const lineCt = lines.length;
  const charCt = raw.length;
  const header = `    Content (${lineCt} line${lineCt === 1 ? "" : "s"}, ${charCt} chars):`;
  const shown  = lines.slice(0, PREVIEW_BLOCK_MAX_LINES);
  const body: string[] = [];
  for (const line of shown) {
    const trimmed = line.length > PREVIEW_BLOCK_MAX_LINE
      ? line.slice(0, PREVIEW_BLOCK_MAX_LINE) + "…"
      : line;
    body.push(`      | ${trimmed}`);
  }
  if (lineCt > PREVIEW_BLOCK_MAX_LINES) {
    const rest = lineCt - PREVIEW_BLOCK_MAX_LINES;
    body.push(`      … ${rest} more line${rest === 1 ? "" : "s"} truncated`);
  }
  return [header, ...body];
}

/**
 * P-EFFECT-RESULT — create content disclosure. Empty and unspecified
 * stay distinct. Payload X is represented verbatim (inline or block).
 */
function writeFileContentPreviewLines(
  content: string | undefined,
  surface: "full" | "review",
): readonly string[] {
  const disclosed = discloseCreateContent(content);
  const prefix = surface === "full" ? "    Content:   " : "       Content: ";
  if (disclosed.kind === "unspecified") {
    return [`${prefix}not specified (not authorized as empty)`];
  }
  if (disclosed.kind === "empty") {
    return [`${prefix}empty (0 bytes)`];
  }
  if (surface === "review") {
    return [`${prefix}${previewInline(disclosed.utf8)}`];
  }
  if (disclosed.utf8.includes("\n")) {
    return previewBlock(disclosed.utf8);
  }
  return [`${prefix}${previewInline(disclosed.utf8)}`];
}

/**
 * Fixed, factual label per operation type. Never paraphrases — these
 * strings are constants chosen at build time, not derived from input.
 * The parenthetical describes the runtime semantics (what the
 * coordinator will actually do), matching `inprocess-adapter.ts`.
 */
function operationKindLabel(op: WorkflowTaskSpec["operationType"]): string {
  switch (op) {
    case "append_file":  return "append (text added to end of file)";
    case "prepend_file": return "prepend (text inserted at start of file)";
    case "write_file":   return "create (writes a new file)";
    case "delete_file":  return "delete (removes a file)";
    case "rename":       return "rename (moves a file to a new path)";
    case "create_dir":   return "create directory (makes a new folder)";
    case "replace":      return "replace (substitutes text in a file)";
    case "run_command":  return "run (executes a shell command)";
    case undefined:      return "";
  }
}

/**
 * Build the SYSTEM WILL preview block for a single task.
 *
 * Output shape (when structured fields are present):
 *
 *   "  Preview:"
 *   "    Operation: <fixed label>"
 *   "    Target:    <path>"            (or From/To, Path, Command — per op)
 *   "    Content:   "<inline>"          (single-line content)
 *     — or —
 *   "    Content (N lines, M chars):"  (multi-line content)
 *   "      | line 1"
 *   "      | line 2"
 *   "      … K more lines truncated"
 *   "    File note: <runtime statement>"
 *
 * Returns `[]` when the task carries no structured operation fields
 * (raw NL prompts pending intake resolution). Callers must treat an
 * empty array as "no extra preview lines" and fall back to the
 * existing `You asked:` / `Understood:` lines on their own.
 *
 * Determinism: pure function of `WorkflowTaskSpec`. Tests assert
 * byte-identical output across calls.
 */
/**
 * CREATE_DIR_EFFECT_CONTRACT_V1 pre-approval disclosure text
 * (docs/product/CREATE_DIR_EFFECT_CONTRACT_V1.md §3-4).
 *
 * The disclosed set is derived ONLY from the hash-bound target via the single
 * shared ancestorClosure: approving the target approves its closure, and that
 * must be visible before approval. Returns null when there are no ancestors to
 * disclose (single-level target). Falls back to the generic disclosure
 * (fail-closed) when the closure is underivable.
 */
function createDirEffectsText(target: string): string | null {
  const closure = ancestorClosure(target);
  if (closure === null) return CREATE_DIR_GENERIC_ANCESTOR_DISCLOSURE;
  const ancestors = closure.slice(0, -1);
  if (ancestors.length === 0) return null;
  return `may also create missing ancestors: ${formatAncestorDirs(ancestors)}`;
}

export function operationPreviewLines(taskSpec: WorkflowTaskSpec): readonly string[] {
  if (taskSpec.structuredReplace !== undefined) {
    const sr = taskSpec.structuredReplace;
    return [
      "  Preview:",
      `    Operation: ${operationKindLabel("replace")}`,
      `    Target:    ${sr.filePath}`,
      `    From:      ${previewInline(sr.oldValue)}`,
      `    To:        ${previewInline(sr.newValue)}`,
      // F8-W4 / usesteady-public#45 — when the user explicitly declared
      // `occurrence: "first"`, the approval surface must disclose both the
      // directive and the execution constraint: the executor is
      // uniqueness-only and never selects the first of several matches.
      // Only "first" can reach this renderer (non-"first" is refused at
      // validate / load stage); absent the field, the legacy byte-shape
      // is preserved.
      ...(taskSpec.requestedOccurrence === "first"
        ? [
            "    Occurrence: first occurrence (requested) — the executor does not " +
            "honor occurrence selection: a unique match is required; multiple " +
            "matches are refused, never selected",
          ]
        : []),
    ];
  }

  const op = taskSpec.operationType;
  if (op === undefined) return [];

  const target = taskSpec.targetFiles && taskSpec.targetFiles.length > 0
    ? taskSpec.targetFiles[0]
    : undefined;

  if (op === "append_file" || op === "prepend_file") {
    if (target === undefined) return [];
    const content     = taskSpec.content ?? "";
    const isMultiline = content.includes("\n");
    const lines: string[] = [
      "  Preview:",
      `    Operation: ${operationKindLabel(op)}`,
      `    Target:    ${target}`,
    ];
    if (isMultiline) {
      lines.push(...previewBlock(content));
    } else {
      lines.push(`    Content:   ${previewInline(content)}`);
    }
    lines.push(`    File note: If ${target} does not exist, it will be created.`);
    return lines;
  }

  if (op === "write_file") {
    if (target === undefined) return [];
    const lines: string[] = [
      "  Preview:",
      `    Operation: ${operationKindLabel(op)}`,
      `    Target:    ${target}`,
    ];
    lines.push(...writeFileContentPreviewLines(taskSpec.content, "full"));
    lines.push(`    File note: If ${target} already exists, the operation will fail (target_exists).`);
    return lines;
  }

  if (op === "rename") {
    if (target === undefined || taskSpec.newPath === undefined) return [];
    return [
      "  Preview:",
      `    Operation: ${operationKindLabel(op)}`,
      `    From:      ${target}`,
      `    To:        ${taskSpec.newPath}`,
      `    File note: If ${taskSpec.newPath} already exists, the operation will fail (target_exists).`,
    ];
  }

  if (op === "delete_file") {
    if (target === undefined) return [];
    return [
      "  Preview:",
      `    Operation: ${operationKindLabel(op)}`,
      `    Target:    ${target}`,
      `    File note: Deletion is permanent within this workspace; verify the path.`,
    ];
  }

  if (op === "create_dir") {
    if (target === undefined) return [];
    const effects = createDirEffectsText(target);
    return [
      "  Preview:",
      `    Operation: ${operationKindLabel(op)}`,
      `    Path:      ${target}`,
      ...(effects === null ? [] : [`    Effects:   ${effects}`]),
    ];
  }

  if (op === "run_command") {
    if (taskSpec.command === undefined) return [];
    return [
      "  Preview:",
      `    Operation: ${operationKindLabel(op)}`,
      `    Command:   ${previewInline(taskSpec.command)}`,
    ];
  }

  return [];
}

/**
 * Compact per-task preview for the multi-task `reviewing` phase.
 *
 * Shorter than `operationPreviewLines` (one or two indented lines per
 * task) so a batch of N tasks still fits on screen at review time.
 * The full preview shows again per-task at `task_ready` approval.
 *
 * Same determinism, same source of truth (`WorkflowTaskSpec`
 * structured fields), same no-paraphrase rule. Returns `[]` for
 * unstructured tasks.
 */
export function operationReviewSummaryLines(taskSpec: WorkflowTaskSpec): readonly string[] {
  if (taskSpec.structuredReplace !== undefined) {
    const sr = taskSpec.structuredReplace;
    return [
      `       Target:  ${sr.filePath}`,
      `       Change:  ${previewInline(sr.oldValue)} → ${previewInline(sr.newValue)}`,
      // F8-W4 / usesteady-public#45 — compact form of the approval-frame
      // disclosure: the directive is user-declared intent; execution is
      // uniqueness-only and never selects among multiple matches. The
      // full constraint text renders at the per-task approval frame.
      ...(taskSpec.requestedOccurrence === "first"
        ? ["       Occurrence: first (requested) — unique match required; multiple matches refused, never selected"]
        : []),
    ];
  }

  const op = taskSpec.operationType;
  if (op === undefined) return [];

  const target = taskSpec.targetFiles && taskSpec.targetFiles.length > 0
    ? taskSpec.targetFiles[0]
    : undefined;

  if (op === "write_file") {
    if (target === undefined) return [];
    return [
      `       Target:  ${target}`,
      ...writeFileContentPreviewLines(taskSpec.content, "review"),
    ];
  }

  if (op === "append_file" || op === "prepend_file") {
    if (target === undefined) return [];
    const content = taskSpec.content ?? "";
    return [
      `       Target:  ${target}`,
      `       Content: ${previewInline(content)}`,
    ];
  }

  if (op === "rename") {
    if (target === undefined || taskSpec.newPath === undefined) return [];
    return [
      `       Move:    ${target} → ${taskSpec.newPath}`,
    ];
  }

  if (op === "delete_file") {
    if (target === undefined) return [];
    return [
      `       Target:  ${target}`,
      `       Note:    deletion is permanent`,
    ];
  }

  if (op === "create_dir") {
    if (target === undefined) return [];
    const effects = createDirEffectsText(target);
    return [
      `       Path:    ${target}`,
      ...(effects === null ? [] : [`       Effects: ${effects}`]),
    ];
  }

  if (op === "run_command") {
    if (taskSpec.command === undefined) return [];
    return [
      `       Command: ${previewInline(taskSpec.command)}`,
    ];
  }

  return [];
}

// ─── Session detail helpers ───────────────────────────────────────────────────

/**
 * Extract task detail lines from the session display.
 * Used for task_ready and task_conflict frames where H needs context.
 *
 * Reads session display (layer 2) only after workflow phase is established.
 */
function sessionDetailLines(run: WorkflowRun): readonly string[] {
  const session = run.currentSession;
  if (!session) return [];

  const d      = session.state.display;
  const lines: string[] = [];

  if (d.changeSummary)                       lines.push(`  Understood: ${d.changeSummary}`);
  if (d.targetFiles && d.targetFiles.length) lines.push(`  Files:     ${d.targetFiles.join(", ")}`);
  if (d.conflicts   && d.conflicts.length) {
    lines.push("  Conflicts:");
    for (const c of d.conflicts) lines.push(`    • ${c}`);
  }

  return lines;
}

/**
 * Extract scope candidates from the current session's scope question.
 * Only valid when workflow phase is "task_scope".
 */
function scopeCandidates(run: WorkflowRun): readonly string[] {
  const session = run.currentSession;
  if (!session) return [];
  return session.state.scopeQuestion?.candidates ?? [];
}

/**
 * Whether retry is available for the current task (retryCount < maxRetries).
 * Avoids presenting a retry option that the coordinator would silently ignore.
 */
function retryAvailable(run: WorkflowRun): boolean {
  const task = run.tasks[run.currentIndex];
  if (!task) return false;
  const max = run.spec.maxRetries ?? 2;
  return task.retryCount < max;
}

/**
 * Build completed/stopped summary lines from task outcomes.
 * WS5: reads run.tasks[i].outcome — does NOT read currentSession.
 */
function taskSummaryLines(run: WorkflowRun): readonly string[] {
  const done = run.tasks.filter(t => t.outcome !== "pending");
  if (done.length === 0) return [];

  const lines: string[] = ["  Tasks:"];
  for (const t of done) {
    const label = t.spec.label ?? t.spec.input.slice(0, 48);
    lines.push(`    ${outcomeSymbol(t.outcome)} ${label}`);
  }
  return lines;
}

/**
 * Guidance lines shown when one or more tasks were skipped by the intake parser.
 * Mirrors the RECOVERY_FORMATS guidance already shown in the web UI (TerminalFrame).
 *
 * WS4 safe: appended after outcome list, never replaces the verbatim failure note.
 */
function intakeGuidanceLines(run: WorkflowRun): readonly string[] {
  const hasAutoSkipped = run.tasks.some(t => t.outcome === "skipped_by_intake");
  if (!hasAutoSkipped) return [];
  // Governance: lists every op in OPERATION_REGISTRY at least once.
  // tests/governance/input-surface-integrity.test.ts asserts this.
  return [
    "",
    "  One or more steps could not be understood.",
    "  Try one of these exact formats:",
    '    replace "X" with "Y" in <file>',
    '    append "X" to <file>',
    '    prepend "X" to <file>',
    "    rename <old> to <new>",
    "    create file <path>",
    "    mkdir <path>",
    "    delete file <path>",
    "    run <command>",
  ];
}

// ─── Public rendering function ────────────────────────────────────────────────

/**
 * Render a WorkflowRun into a ShellFrame.
 *
 * WS1: Pure — no I/O, no side effects.
 * WS6: Returns the same ShellFrame contract as renderCursorFrame /
 *      renderClaudeFrame. A generic shell loop can drive all three without
 *      special workflow logic.
 *
 * Two-layer read rule:
 *   1. Switch on run.phase (workflow coordinator layer).
 *   2. Read currentSession.state.display for task-level detail (session layer).
 */

/**
 * F10-W2 — presentation-only render options.
 *
 * `auditTrailOnly`: set by the CLI loop when the frame's confirm gate
 * will be auto-confirmed without a human at the terminal (delegated
 * one-shot `--yes`, or an operator-supplied `--yes`). The frame keeps
 * every disclosure line (SYSTEM WILL, preview, detail) but the
 * task_ready header renders `WILL RUN` instead of the actionable
 * decision header `APPROVE?` — no approval can actually be supplied at
 * that point, so presenting a decision surface would be a false
 * affordance (Stuart Finding 10, presentation-order remediation).
 *
 * Default (undefined / false) preserves the pre-F10-W2 byte output
 * exactly. The web surface (`server.ts` runResponse) never sets this —
 * its approval gate is real and keeps the `APPROVE?` header.
 */
export type WorkflowFrameRenderOptions = {
  readonly auditTrailOnly?: boolean;
};

export function renderWorkflowFrame(run: WorkflowRun, opts?: WorkflowFrameRenderOptions): ShellFrame {
  const { phase, display } = run;

  switch (phase) {
    // ── Pre-flight review (WF-R4) ─────────────────────────────────────────

    case "reviewing": {
      const total   = run.spec.tasks.length;
      const runtime = (t: { runtime?: "cursor" | "claude" }) =>
        t.runtime ?? run.spec.defaultRuntime ?? "cursor";

      // alpha.55: per-task structured summary in REVIEW.
      //
      // Pre-alpha.55 this was a single one-line `N. [runtime] label`
      // per task. For JSON/batch workflows the label was usually
      // "Step N", which carries zero information about WHAT the step
      // will do — the operator was approving a workflow they could
      // not actually inspect at review time.
      //
      // The new shape preserves the existing one-line header
      // (`N. [runtime] label`) so existing tests on numbering and
      // runtime tags pass byte-identically, and adds an indented
      // compact-preview block sourced from the same WorkflowTaskSpec
      // structured fields the executor uses. Tasks without
      // structured fields render exactly as before. A thin separator
      // (`    ─────`) sits between adjacent tasks when there are 2+,
      // so visually distinct ops cannot blur together.
      //
      // No semantic interpretation. No paraphrase. Pure per-task
      // projection of `WorkflowTaskSpec` → display bytes.
      const taskBlocks: string[][] = run.spec.tasks.map((t, i) => {
        const lbl   = t.label ?? t.input.slice(0, 56);
        const head  = `    ${i + 1}. [${runtime(t)}] ${lbl}`;
        const body  = operationReviewSummaryLines(t);
        return [head, ...body];
      });
      const taskLines: string[] = [];
      for (let i = 0; i < taskBlocks.length; i += 1) {
        if (i > 0) taskLines.push("    ─────");
        for (const ln of taskBlocks[i]!) taskLines.push(ln);
      }

      const breakGlassLines: string[] =
        run.mode === "break_glass"
          ? [
              `  ⚠  BREAK-GLASS MODE — audited operator escape hatch`,
              `     All steps run without per-step approval.`,
              `     Every step is still recorded in the full audit trail.`,
              ...(run.breakGlassReason
                ? [`     Reason: ${run.breakGlassReason}`]
                : []),
              "",
            ]
          : [];

      return {
        lines: [
          "",
          header(`REVIEW  "${run.spec.name}"  —  ${total} task${total === 1 ? "" : "s"}`),
          "",
          ...breakGlassLines,
          ...taskLines,
          "",
        ],
        prompt: { kind: "confirm", question: "Start workflow? (y/n)" } satisfies ShellPrompt,
      };
    }

    // ── Transient states (no prompt) ──────────────────────────────────────

    case "idle": {
      return {
        lines: [
          "",
          header(`WORKFLOW  ${display.headline}`),
          `  ${display.progress}`,
          "  Call advanceWorkflow() to start.",
          "",
        ],
      };
    }

    case "running": {
      return {
        lines: [
          "",
          header("WORKFLOW  ADVANCING"),
          `  ${display.progress}`,
          `  ${display.headline}`,
          "",
        ],
      };
    }

    case "task_approved": {
      // Transient — advance functions collapse approve+deliver.
      // Render as "Approved" explicitly. Never "Accepted" or "Completed" (9C distinction).
      return {
        lines: [
          "",
          header(`APPROVED  ${display.progress}`),
          "  Task approved — ready to deliver.",
          "  (Delivery in progress...)",
          "",
        ],
      };
    }

    // ── H decision required ───────────────────────────────────────────────

    case "task_ready": {
      const detail   = sessionDetailLines(run);
      // F6: show the immediately preceding task's outcome so H sees what just succeeded
      // before being asked to approve the next one.
      const prevTask = run.tasks[run.currentIndex - 1];
      const prevLine =
        prevTask && prevTask.outcome !== "pending"
          ? [`  Previous: ${outcomeSymbol(prevTask.outcome)}  ${prevTask.spec.label ?? prevTask.spec.input.slice(0, 48)}`]
          : [];
      // F5 / WF-A1: raw task input is the approval anchor (source of truth).
      // WF-A2: interpreted summary (in detail) is assistive, not authoritative.
      // S4 / #43: derive display from `structuredReplace` when present so
      // JSON-op replace tasks don't surface the parser-stable placeholder.
      const taskSpec     = run.spec.tasks[run.currentIndex];
      const rawInputLine = taskSpec ? [`  You asked:  ${truthfulInputDisplay(taskSpec)}`] : [];
      // alpha.55: structured SYSTEM WILL preview block.
      //
      // Pulled directly from `taskSpec.{operationType, targetFiles,
      // content, newPath, command, structuredReplace}` — the same
      // fields the executor consumes. The block answers four
      // questions at the approval surface: what kind of change,
      // where, what literal text, and whether a missing/existing
      // file changes behavior. Falls back silently to `[]` for
      // tasks without structured fields (raw NL prompts), preserving
      // pre-alpha.55 byte output for those.
      const previewLines = taskSpec ? operationPreviewLines(taskSpec) : [];
      // F10-W2: when the gate is auto-confirmed upstream (delegated
      // one-shot / operator --yes), no approval can be supplied here —
      // render the truthful non-decision header. All disclosure content
      // (SYSTEM WILL, anchor, preview, detail) is preserved verbatim.
      const headerLabel = opts?.auditTrailOnly === true
        ? `WILL RUN  ${display.progress}`
        : `APPROVE?  ${display.progress}`;
      return {
        lines: [
          "",
          header(headerLabel),
          "  SYSTEM WILL",
          `  → ${display.headline}`,
          ...prevLine,
          ...rawInputLine,
          ...previewLines,
          ...detail,
          "",
        ],
        // confirm — the only way to approve or reject.
        prompt: { kind: "confirm", question: "Approve this task? (y/n)" } satisfies ShellPrompt,
      };
    }

    case "task_conflict": {
      // S4 / friction #42 — Trust frame alignment.
      //
      // Pre-S4 this frame printed `CONFLICT  Task N of M` and execution
      // proceeded on H approval (or auto-accept under `--yes`). Users
      // perceived "CONFLICT" as a hard severity label that should block
      // execution, then watched the very next frame report `COMPLETED ok
      // Completed successfully` for the same task — exactly the silent-
      // override pattern the trust contract is meant to forbid.
      //
      // The frame is never blocking by the system itself; it is gated by
      // the H choice (`acceptWorkflowConflict` advances to `task_ready`).
      // Renaming the label to `WARNING — OCD conflict detected (non-blocking)`
      // and adding an explicit "System will execute on approval." line
      // honors the rule "if it executes, the system must say it will
      // execute." No state-machine, evaluator, or policy change — only
      // this renderer text.
      const detail = sessionDetailLines(run);  // includes conflict list from session display
      // F5 / WF-A1: raw task input is also anchored in warning frames.
      // S4 / #43: same truthful-display rule as task_ready.
      const taskSpec     = run.spec.tasks[run.currentIndex];
      const rawInputLine = taskSpec ? [`  You asked:  ${truthfulInputDisplay(taskSpec)}`] : [];
      // alpha.55: same structured preview as task_ready so the
      // operator sees the exact change before accepting a warning.
      const previewLines = taskSpec ? operationPreviewLines(taskSpec) : [];
      return {
        lines: [
          "",
          header(`WARNING - OCD conflict detected (non-blocking)  ${display.progress}`),
          `  ${display.headline}`,
          ...rawInputLine,
          ...previewLines,
          ...detail,
          "  System will execute on approval.",
          "",
        ],
        // confirm — H must explicitly accept or reject.
        prompt: { kind: "confirm", question: "Accept warning and approve task? (y/n)" } satisfies ShellPrompt,
      };
    }

    case "task_scope": {
      const candidates    = scopeCandidates(run);
      const candidateLines = candidates.map((c, i) => `    ${i + 1}. ${c}`);
      return {
        lines: [
          "",
          header(`SCOPE?    ${display.progress}`),
          `  ${display.headline}`,
          ...candidateLines,
          "",
        ],
        // choose — H selects by number.
        prompt: {
          kind:     "choose",
          question: "Select file (enter number):",
          choices:  candidates as string[],
        } satisfies ShellPrompt,
      };
    }

    case "task_advisory": {
      // P3 Phase 2 — the model emitted structured advisory position(s) about
      // this action and did NOT execute. The frame renders two evidentially
      // distinct blocks:
      //   MODEL POSITION — the exact preserved model-authored content
      //   SYSTEM WILL    — the exact proposed governed action
      // The model is speaking ABOUT the action; it never decides whether it
      // runs. The only way forward is the explicit supersession decision.
      const positions =
        run.currentSession?.runtime === "claude"
          ? (run.currentSession.state.advisoryPositions ?? [])
          : [];
      const positionLines: string[] = [];
      for (let i = 0; i < positions.length; i++) {
        const rec = positions[i];
        if (!rec) continue;
        positionLines.push(
          `  Position ${i + 1} [${rec.position.kind}]  id: ${rec.modelPositionId.slice(0, 16)}…`,
        );
        for (const l of rec.position.explanation.split("\n")) {
          positionLines.push(`    | ${l}`);
        }
      }
      const taskSpec     = run.spec.tasks[run.currentIndex];
      const rawInputLine = taskSpec ? [`  You asked:  ${truthfulInputDisplay(taskSpec)}`] : [];
      const previewLines = taskSpec ? operationPreviewLines(taskSpec) : [];
      const detail       = sessionDetailLines(run);
      return {
        lines: [
          "",
          header(`ADVISORY  ${display.progress}`),
          "  MODEL POSITION (advisory only — the model does not decide)",
          ...positionLines,
          "",
          "  SYSTEM WILL (the proposed action, unchanged)",
          ...rawInputLine,
          ...previewLines,
          ...detail,
          "",
        ],
        // confirm — yes = proceed despite the model position (explicit
        // supersession decision); no = decline the action. Ordinary approval
        // semantics do not apply on this frame.
        prompt: { kind: "confirm", question: "Proceed despite the model position? (y/n)" } satisfies ShellPrompt,
      };
    }

    case "task_failed": {
      // WS4: preserve specific failure note — never flatten to generic "task failed".
      const failureNote = display.failureNote ?? "Task failed.";
      // F7: show which task failed so H has context when choosing stop/skip/retry.
      const taskSpec  = run.spec.tasks[run.currentIndex];
      const taskLabel = taskSpec ? (taskSpec.label ?? taskSpec.input.slice(0, 60)) : undefined;
      // F8: explain retry semantics — retry re-attempts the same input, unchanged.
      //     This prevents H from expecting a different outcome on an unchanged spec.
      // WS3: always "choose", never "confirm". No implicit default.
      const choices = retryAvailable(run)
        ? ["stop", "skip", "retry"]
        : ["stop", "skip"];
      const retryNote = retryAvailable(run)
        ? "  Note: retry re-attempts the same input unchanged. Use skip if the spec needs correction."
        : undefined;
      return {
        lines: [
          "",
          header(`FAILED    ${display.progress}`),
          ...(taskLabel ? [`  Task:     ${taskLabel}`] : []),
          `  Failure:  ${failureNote}`,
          ...(retryNote ? [retryNote] : []),
          "",
        ],
        prompt: { kind: "choose", question: "Action:", choices } satisfies ShellPrompt,
      };
    }

    // ── Terminal phases (no prompt) ───────────────────────────────────────

    case "completed": {
      // WS5: history from run.tasks[i].outcome, not currentSession.
      const summary  = taskSummaryLines(run);
      const guidance = intakeGuidanceLines(run);
      return {
        lines: [
          "",
          header("COMPLETED"),
          `  ${display.headline}`,
          ...summary,
          ...guidance,
          "",
        ],
      };
    }

    case "stopped": {
      // WS5: history from run.tasks[i].outcome, not currentSession.
      const summary  = taskSummaryLines(run);
      const guidance = intakeGuidanceLines(run);
      return {
        lines: [
          "",
          header("STOPPED"),
          `  ${display.headline}`,
          ...summary,
          ...guidance,
          // F10: explain partial-state clearly so H knows completed tasks are already applied.
          "  Note: completed tasks have already been applied to the workspace.",
          "  Use version control or your editor's undo to revert if needed.",
          "",
        ],
      };
    }
  }
}
