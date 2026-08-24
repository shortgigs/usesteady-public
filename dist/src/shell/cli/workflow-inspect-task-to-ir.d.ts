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
import type { Operation } from "../../input/ir.js";
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
export type SpecTaskLowering = {
    readonly ok: true;
    readonly op: Operation;
} | {
    readonly ok: false;
    readonly kind: "non_deterministic";
    readonly reason: string;
} | {
    readonly ok: false;
    readonly kind: "invalid";
    readonly reason: string;
};
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
export declare function specTaskToIROperation(task: WorkflowTaskSpec): SpecTaskLowering;
//# sourceMappingURL=workflow-inspect-task-to-ir.d.ts.map