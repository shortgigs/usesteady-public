/**
 * src/shell/cli/workflow-inspect-task-to-ir.ts
 *
 * P7-min — Workflow Inspect helper.
 *
 * Pure inverse mapping from `WorkflowTaskSpec` (the post-load structured
 * shape) to `IR Operation` so the existing `validateOperation` can be
 * invoked against each task during `usesteady workflow inspect`.
 *
 * The mapping is the structural inverse of `mapIROpToStructuredFields` in
 * `src/shell/cli/ir-to-spec-fields.ts` (which goes IR -> SpecTask). The
 * forward and inverse mappers cannot be unified because:
 *
 *   - Forward is total: every IR op maps to a SpecTask shape.
 *   - Inverse is partial: Claude-runtime tasks have no IR representation,
 *     and a hand-crafted spec slipping past the loader's task shape gate
 *     can still arrive here malformed.
 *
 * Authority discipline:
 *
 *   - This helper has zero authority. It returns a derived `Operation`
 *     value that is consumed exclusively by the inspect renderer's call
 *     to `validateOperation`. Nothing in the executor / coordinator /
 *     adapter path reads anything this file produces.
 *
 *   - No new fields. No new operation types. No new error codes.
 *
 *   - The inspect surface is read-only. This helper performs no I/O.
 */

import type { WorkflowTaskSpec } from "../../workflow/types.js";
import type { Operation, ReplaceOccurrence } from "../../input/ir.js";

// ─── Result discriminant ─────────────────────────────────────────────────────

/**
 * Result of attempting to lower a `WorkflowTaskSpec` to an `Operation`.
 *
 *   - `ok: true`           → IR Operation produced; validator can probe it.
 *   - `kind: "non_deterministic"` → task is not statically predictable
 *                            (Claude runtime); inspect surfaces this in the
 *                            histogram without producing a finding.
 *   - `kind: "invalid"`    → task is structurally malformed (missing field
 *                            or unknown shape); inspect surfaces this as a
 *                            finding with code `invalid_op`.
 */
export type SpecTaskLowering =
  | { readonly ok: true; readonly op: Operation }
  | { readonly ok: false; readonly kind: "non_deterministic"; readonly reason: string }
  | { readonly ok: false; readonly kind: "invalid"; readonly reason: string };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function firstTargetFile(task: WorkflowTaskSpec): string | null {
  if (!task.targetFiles) return null;
  if (task.targetFiles.length === 0) return null;
  const first = task.targetFiles[0];
  return typeof first === "string" && first.length > 0 ? first : null;
}

/**
 * Derive the IR `occurrence` field for a replace op.
 *
 * The IR §5.1 requires `occurrence` to be "never undefined". When the
 * user did not provide an explicit directive (no `requestedOccurrence`)
 * we use "first" as the IR-level value. This choice does NOT affect
 * the validate-stage decision: `validateReplace` branches on
 * `requestedOccurrence`, not `occurrence` (see
 * `src/input/feasibility-validator.ts:validateReplace`). It only ensures
 * the IR type constraint is satisfied.
 */
function resolveOccurrence(req: ReplaceOccurrence | undefined): ReplaceOccurrence {
  if (req === undefined) return "first";
  return req;
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Lower a single `WorkflowTaskSpec` to an IR `Operation` for inspect-time
 * validation. Pure. Never throws.
 *
 * Order of classification:
 *   1. Claude runtime → non_deterministic (regardless of any other fields).
 *   2. `structuredReplace` present → replace (preferred path; carries
 *      the executor-canonical operands).
 *   3. `operationType` present → switch on the SpecTask discriminant.
 *   4. Otherwise → invalid (loader should have caught this; defensive).
 */
export function specTaskToIROperation(task: WorkflowTaskSpec): SpecTaskLowering {
  // 1. Claude tasks are not statically predictable — they go through the
  //    Claude product session, not the FS-op fast path. The inspect
  //    surface honestly classifies them as non_deterministic instead of
  //    fabricating a finding.
  if (task.runtime === "claude") {
    return {
      ok: false,
      kind: "non_deterministic",
      reason: "task runs through the Claude product session (not statically predictable)",
    };
  }

  // 2. structuredReplace wins for replace ops. The JSON / batch path
  //    populates this field whenever the op is a replace, and the IR
  //    operand triple lives inside it. The optional requestedOccurrence
  //    flows through so validateReplace can refuse non-"first" directives.
  if (task.structuredReplace !== undefined) {
    const sr = task.structuredReplace;
    if (typeof sr.filePath !== "string" || sr.filePath.length === 0) {
      return { ok: false, kind: "invalid", reason: "replace task has empty structuredReplace.filePath" };
    }
    if (typeof sr.oldValue !== "string") {
      return { ok: false, kind: "invalid", reason: "replace task has non-string structuredReplace.oldValue" };
    }
    if (typeof sr.newValue !== "string") {
      return { ok: false, kind: "invalid", reason: "replace task has non-string structuredReplace.newValue" };
    }
    const op: Operation = {
      type: "replace",
      args: {
        file:       sr.filePath,
        from:       sr.oldValue,
        to:         sr.newValue,
        occurrence: resolveOccurrence(task.requestedOccurrence),
        ...(task.requestedOccurrence !== undefined ? { requestedOccurrence: task.requestedOccurrence } : {}),
      },
    };
    return { ok: true, op };
  }

  // 3. operationType drives the remaining 7 op types.
  switch (task.operationType) {
    case "create_dir": {
      const path = firstTargetFile(task);
      if (path === null) {
        return { ok: false, kind: "invalid", reason: "create_dir task is missing targetFiles[0]" };
      }
      return { ok: true, op: { type: "create_dir", args: { path } } };
    }

    case "write_file": {
      const path = firstTargetFile(task);
      if (path === null) {
        return { ok: false, kind: "invalid", reason: "write_file task is missing targetFiles[0]" };
      }
      const op: Operation = {
        type: "create",
        args: {
          path,
          ...(typeof task.content === "string" ? { contents: task.content } : {}),
        },
      };
      return { ok: true, op };
    }

    case "delete_file": {
      const path = firstTargetFile(task);
      if (path === null) {
        return { ok: false, kind: "invalid", reason: "delete_file task is missing targetFiles[0]" };
      }
      return { ok: true, op: { type: "delete", args: { path } } };
    }

    case "rename": {
      const from = firstTargetFile(task);
      if (from === null) {
        return { ok: false, kind: "invalid", reason: "rename task is missing targetFiles[0] (source path)" };
      }
      if (typeof task.newPath !== "string" || task.newPath.length === 0) {
        return { ok: false, kind: "invalid", reason: "rename task is missing newPath (destination)" };
      }
      return { ok: true, op: { type: "rename", args: { from, to: task.newPath } } };
    }

    case "append_file": {
      const file = firstTargetFile(task);
      if (file === null) {
        return { ok: false, kind: "invalid", reason: "append_file task is missing targetFiles[0]" };
      }
      return { ok: true, op: { type: "append", args: { file, text: task.content ?? "" } } };
    }

    case "prepend_file": {
      const file = firstTargetFile(task);
      if (file === null) {
        return { ok: false, kind: "invalid", reason: "prepend_file task is missing targetFiles[0]" };
      }
      return { ok: true, op: { type: "prepend", args: { file, text: task.content ?? "" } } };
    }

    case "run_command": {
      if (typeof task.command !== "string" || task.command.length === 0) {
        return { ok: false, kind: "invalid", reason: "run_command task is missing command" };
      }
      return { ok: true, op: { type: "run", args: { command: task.command } } };
    }

    case "replace": {
      // operationType="replace" without structuredReplace is structurally
      // malformed — the loader synthesizes structuredReplace from NL for
      // every accepted replace task. If we reach this branch, the spec
      // bypassed the synth path (hand-crafted) and is missing the
      // executor-canonical operand triple.
      return { ok: false, kind: "invalid", reason: "replace task has operationType=\"replace\" but no structuredReplace" };
    }

    case undefined: {
      // Bare NL input only — recovery-parity path. The coordinator treats
      // these as non-deterministic and routes unparseable NL to
      // `skipped_by_intake`; inspect mirrors that without fabricating IR.
      if (typeof task.input === "string" && task.input.length > 0) {
        return {
          ok: false,
          kind: "non_deterministic",
          reason: "task has NL input only; coordinator resolves at runtime via intake recovery",
        };
      }
      return { ok: false, kind: "invalid", reason: "task has no operationType and no structuredReplace (post-load invariant violation)" };
    }

    default: {
      // Defensive: a SpecTask.operationType value not in the union. The
      // type system makes this unreachable today; included so that adding
      // a new operationType without updating this switch produces a
      // compile-time error (the assignment to `_exhaustive`) AND a
      // runtime-honest finding (the return below).
      const _exhaustive: never = task.operationType;
      return { ok: false, kind: "invalid", reason: `task has unsupported operationType: ${String(_exhaustive)}` };
    }
  }
}
