/**
 * Kernel v1 / K4 + K5 + K6 -- replay classifier.
 *
 * -- Scope (PR-K4 design section 3 D1, section 5; K5 v1.0 section 3 D1,
 *          section 5.1; K6 v1.0 section 3 D1) ------------------------------
 *
 *   Pure pre-pass over `WorkflowSpec.tasks`. Decides whether an IR is
 *   replayable end-to-end before any sandbox is created. Drives the per-IR
 *   refusal in `runExecutionReplay` (K4-I10: refusal is per-IR, never
 *   per-task partial execution).
 *
 *   Replayable iff every task is one of:
 *     - operationType: "write_file"   + targetFiles[0] + content
 *     - operationType: "rename"       + targetFiles[0] + newPath
 *     - operationType: "delete_file"  + targetFiles[0]
 *     - operationType: "create_dir"   + targetFiles[0]
 *     - operationType: "append_file"  + targetFiles[0] + content
 *     - operationType: "prepend_file" + targetFiles[0] + content
 *     - structuredReplace: { oldValue, newValue, filePath }
 *     - operationType: "run_command"  + command matching the K5 + K6
 *                                       allow-list (echo <args> / true /
 *                                       false / node -e "<BODY>"; see
 *                                       command-classifier.ts)
 *
 *   Explicitly NOT replayable in K4 + K5 + K6 v1.0:
 *     - bare `{ input: "<NL>" }` (no operationType, no structuredReplace)
 *     - operationType: "run_command" with a command outside the K5 + K6
 *       allow-list (env-dependent or non-deterministic shape; K7+ scope)
 *     - any task with runtime "cursor" | "claude" but no FS op fields set
 *       (would require LLM intake -- out of K4)
 *
 *   Reason discriminant (K5 v1.0 section 3 D5; K6 v1.0 section 10):
 *     - run_command + K6 prefix shape (`node -e "..."`) but BODY out of
 *       K6 scope          -> reason: "non_deterministic_inline_js"
 *     - run_command, any other out-of-scope shape
 *                         -> reason: "non_deterministic_command"
 *     - all other non_replayable refusals
 *                         -> reason: "non_deterministic_task"
 *
 *   The classifier returns the 1-based index of the first non-replayable task
 *   (matches PR-2's `failed_at_step` convention) so the CLI surface and the
 *   verdict surface use the same numbering.
 *
 *   Pure function. No I/O. No imports beyond types.
 */

import { isAbsolute, posix } from "node:path";

import type { WorkflowSpec, WorkflowTaskSpec }     from "../workflow/types.js";
import { isReplayableCommandShape }                 from "./command-classifier.js";
import { isK6NodeECommandShape }                    from "./inline-js-classifier.js";
import type { ClassifierResult }                    from "./types.js";

// ─── Sandbox containment predicate (K4-I3 defense) ───────────────────────────
//
// The classifier MUST reject any task whose paths cannot be safely rooted
// inside the replay sandbox. Without this gate the sandbox is a fiction:
// `CursorInProcessAdapter.executeFsOp` short-circuits absolute paths
// (src/cursor/adapters/inprocess-adapter.ts:303), and `path.join(sandbox,
// "../../etc/x")` normalizes OUT of the sandbox. Either case lets a
// malicious or malformed artifact mutate real disk during replay.
//
// Refusal model is structural — same K4-I10 spirit: no path rewriting,
// no normalization fallback, no per-task partial execution. The whole IR
// refuses with the offending task's 1-based index.
//
// A path is "contained" iff:
//   - it is a non-empty string
//   - it is NOT absolute (POSIX `/...`, Windows `C:\...`, UNC `\\...`)
//   - after posix-normalization it neither equals ".." nor starts with "../"
//
// Backslashes are folded to forward slashes before normalization so a
// Windows-authored IR with `targetFiles: ["..\\..\\etc"]` is rejected on
// any host.

export function isContainedRelativePath(p: unknown): boolean {
  if (typeof p !== "string" || p.length === 0)             return false;
  if (isAbsolute(p))                                       return false;
  // Catch UNC and Windows drive forms even when running on POSIX, where
  // `isAbsolute` would otherwise return false for "C:\foo" or "\\srv\share".
  if (/^[a-zA-Z]:[\\/]/.test(p))                           return false;
  if (p.startsWith("\\\\") || p.startsWith("//"))          return false;
  const normalized = posix.normalize(p.replace(/\\/g, "/"));
  if (normalized === ".." || normalized.startsWith("../")) return false;
  return true;
}

// ─── Per-task predicate ──────────────────────────────────────────────────────

/**
 * True iff this task spec is in the K4 replayable set (design §5.1).
 *
 * Missing companion fields (e.g. `write_file` without `content`) are treated
 * as NON-replayable — the original artifact represents a working run, so a
 * missing field at replay time is itself drift and the IR refuses with
 * `task_index = N` rather than executing and producing a confusing failure.
 */
export function isReplayableTaskSpec(spec: WorkflowTaskSpec): boolean {
  // Every path field that the executor will hand to an FS primitive MUST
  // pass `isContainedRelativePath`. This is the structural enforcement of
  // K4-I3 — no absolute paths, no `..` escape — independent of whether the
  // sandbox itself catches escapes at runtime.
  const target0 = spec.targetFiles?.[0];

  switch (spec.operationType) {
    case "write_file":
      return spec.content !== undefined
        && isContainedRelativePath(target0);
    case "rename":
      return isContainedRelativePath(target0)
        && isContainedRelativePath(spec.newPath);
    case "delete_file":
    case "create_dir":
      return isContainedRelativePath(target0);
    case "append_file":
    case "prepend_file":
      return spec.content !== undefined
        && isContainedRelativePath(target0);
    case "run_command":
      // K4 excluded all run_command tasks. K5 widened this to a structural
      // allow-list of three command shapes (echo <args> / true / false).
      // K6 widens it further to also admit `node -e "<BODY>"` where BODY
      // satisfies the K6 closed inline-JS predicate. Out-of-scope commands
      // STILL refuse -- see K6 design v1.0 sections 3 + 5.
      return typeof spec.command === "string"
          && isReplayableCommandShape(spec.command);
    default:
      // No operationType — the structuredReplace fast path is the only way in.
      return Boolean(
        spec.structuredReplace
          && typeof spec.structuredReplace.oldValue === "string"
          && typeof spec.structuredReplace.newValue === "string"
          && isContainedRelativePath(spec.structuredReplace.filePath),
      );
  }
}

// ─── IR-level classifier ─────────────────────────────────────────────────────

/**
 * Classifies a non-replayable task's refusal reason for K5 + K6 surface
 * reporting.
 *
 * The three reasons separate three distinct refusal-shape buckets:
 *
 *   - "non_deterministic_inline_js" : K6. The task IS an
 *                                     `operationType:"run_command"` AND its
 *                                     command matches the K6 prefix shape
 *                                     `node -e "<BODY>"`, but BODY is NOT
 *                                     in the K6 closed inline-JS allow-list.
 *                                     This is the precise K6 contribution.
 *
 *   - "non_deterministic_command"   : K5. The task IS an
 *                                     `operationType:"run_command"` AND its
 *                                     command string is NOT in the K5+K6
 *                                     allow-list AND it does NOT even match
 *                                     the K6 prefix shape. Catches every
 *                                     non-`node -e` out-of-scope command.
 *                                     Preserves the K5 surface contract.
 *
 *   - "non_deterministic_task"      : K4 catch-all. Every other
 *                                     non-replayable shape. Bare NL,
 *                                     path-escape, unknown operationType,
 *                                     missing companion fields, etc.
 *                                     Preserves the K4 surface contract
 *                                     verbatim.
 *
 * Private helper. Pure function.
 */
function classifyRefusalReason(
  task: WorkflowTaskSpec,
):
  | "non_deterministic_task"
  | "non_deterministic_command"
  | "non_deterministic_inline_js"
{
  if (task.operationType === "run_command") {
    // K6 distinction: the command matches the K6 prefix shape
    // (`node -e "<BODY>"`) but the body fell out of the K6 closed allow-list.
    // We surface this as the K6-specific reason so observers can distinguish
    // "this command shape is K6 but the body is out of scope" from "this
    // command shape is not even K5/K6 in form" -- K6 design doc section 10.
    if (typeof task.command === "string" && isK6NodeECommandShape(task.command)) {
      return "non_deterministic_inline_js";
    }
    // Otherwise the run_command falls out of K5+K6 entirely. K5 reason.
    return "non_deterministic_command";
  }
  return "non_deterministic_task";
}

/**
 * Walk `ir.tasks` once and return either:
 *   - { verdict: "replayable" }                                                    (every task passes)
 *   - { verdict: "non_replayable", task_index: 1-based-int, reason: <discriminant> } (first failing task)
 *
 * Empty `ir.tasks` is replayable (vacuous).
 *
 * The `reason` field was ADDITIVELY added in K5 v1.0 (§3 D5). Pre-K5 callers
 * that read only `verdict` and `task_index` are unaffected.
 */
export function classifyForReplay(ir: WorkflowSpec): ClassifierResult {
  for (let i = 0; i < ir.tasks.length; i++) {
    const task = ir.tasks[i];
    if (!task || !isReplayableTaskSpec(task)) {
      const reason = task ? classifyRefusalReason(task) : "non_deterministic_task";
      return { verdict: "non_replayable", task_index: i + 1, reason };
    }
  }
  return { verdict: "replayable" };
}
