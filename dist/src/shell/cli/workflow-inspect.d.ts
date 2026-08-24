/**
 * src/shell/cli/workflow-inspect.ts
 *
 * P7-min — Workflow Comprehension Surface.
 *
 * Read-only structural inspection of a `WorkflowSpec` file. Loads the
 * spec via the existing `loadWorkflowSpecFromFile`, lowers each task to
 * an IR `Operation` via `specTaskToIROperation`, runs the existing
 * `validateOperation` per task (no short-circuit), and produces a
 * deterministic report.
 *
 * Design lock: `docs/product/p7-min-workflow-inspect-design-v1.md`.
 *
 * Authority discipline:
 *
 *   - Zero. Inspect never executes, never approves, never mutates the
 *     workspace.
 *   - No new error codes are minted. The set of codes inspect may
 *     surface equals the existing validator-emitted set
 *     (`invalid_path`, `outside_workspace`, `invalid_filename_chars`,
 *     `invalid_filename_reserved_name`, `prohibited_path`,
 *     `ambiguous_match`, `target_exists`, `file_not_found`,
 *     `merge_conflict`) plus the existing CLI-layer
 *     `invalid_op` / `invalid_json` / `file_not_found` for load
 *     failures.
 *   - Validator reuse, not re-implementation. The inspector calls
 *     `validateOperation` per task — the same function `run` uses.
 *
 * Non-bypass requirements (load-bearing):
 *
 *   - Inspect must use `loadWorkflowSpecFromFile` verbatim. A spec that
 *     fails to load for `run` MUST fail to load for `inspect` with the
 *     same classified code.
 *   - Inspect must not skip any validator check or invert the validator's
 *     check order. `validateOperation` is the single entry point.
 *   - Inspect must not run any check the validator does not run.
 */
import { type TargetEntry } from "./workflow-inspect-target-tree.js";
import { type TeamPolicyPackV1, type TeamPolicyLoadResult } from "../../workflow/team-policy-pack.js";
/**
 * Maps every validator-emitted `CliErrorCode` plus the inspector-only
 * `invalid_op` to a `fs_dependent` boolean.
 *
 * `false`  → finding is fully static; the same input produces the same
 *            finding regardless of workspace state.
 * `true`   → finding depends on `existsSync` / `lstatSync` probes; it
 *            represents the workspace at inspect time and may differ at
 *            run time.
 *
 * If the validator ever emits a NEW `CliErrorCode`, the build-time
 * exhaustive switch in `classifyFindingCode` will fail until this map
 * is updated — see the `assertNever` call at the bottom of
 * `inspectFindingFsDependent`.
 */
type InspectFindingCode = "invalid_path" | "outside_workspace" | "invalid_filename_chars" | "invalid_filename_reserved_name" | "prohibited_path" | "ambiguous_match" | "target_exists" | "file_not_found" | "merge_conflict" | "invalid_op";
/**
 * The histogram and the findings list both use the SpecTask-level op
 * names (`write_file`, `create_dir`, `delete_file`, `rename`,
 * `append_file`, `prepend_file`, `run_command`, `replace`) plus two
 * synthetic buckets:
 *
 *   - `non_deterministic` — Claude-runtime tasks.
 *   - `unknown`           — tasks the lowering helper marked as invalid.
 *
 * Using the SpecTask names keeps the inspect output aligned with what
 * the user actually wrote in their spec (rather than the internal IR
 * names like `create` / `append` / `run`).
 */
export type InspectOpName = "write_file" | "create_dir" | "delete_file" | "rename" | "append_file" | "prepend_file" | "run_command" | "replace" | "non_deterministic" | "unknown";
export type InspectionFinding = {
    readonly task_index: number;
    readonly task_label: string | null;
    readonly op_type: InspectOpName;
    readonly code: InspectFindingCode;
    readonly stage: "load" | "validate";
    readonly fs_dependent: boolean;
    readonly message: string;
};
export type InspectionTargetEntry = TargetEntry;
export type InspectionReport = InspectionReportSuccess | InspectionReportFailure;
export type InspectionReportSuccess = {
    readonly success: true;
    readonly workflow: string;
    readonly spec_path: string;
    readonly workspace_root: string;
    /** Present when `.usesteady/policy.json` is valid; null when absent/invalid. */
    readonly team_policy: TeamPolicyPackV1 | null;
    readonly team_policy_load: TeamPolicyLoadResult;
    readonly task_count: number;
    readonly op_histogram: Readonly<Record<string, number>>;
    readonly target_tree: readonly InspectionTargetEntry[];
    readonly findings: readonly InspectionFinding[];
    readonly finding_count: number;
    readonly static_finding_count: number;
    readonly fs_dependent_finding_count: number;
};
export type InspectionReportFailure = {
    readonly success: false;
    readonly error: "file_not_found" | "invalid_json" | "invalid_op";
    readonly spec_path: string;
    readonly message: string;
};
export type InspectOptions = {
    readonly specPath: string;
    readonly workspaceRoot: string;
};
/**
 * Load + validate + project the spec into an `InspectionReport`.
 *
 * Side effects:
 *   - Reads the spec file (via `loadWorkflowSpecFromFile`).
 *   - For each lowered task, calls `validateOperation` which performs
 *     `existsSync` / `lstatSync` against `workspaceRoot`.
 *   - Writes nothing.
 *
 * Pure of side-effect output: stdout / stderr untouched.
 */
export declare function inspectWorkflowSpec(opts: InspectOptions): InspectionReport;
/**
 * Render the report as a single-line JSON string terminated by exactly
 * one newline. Key order is fixed by the construction order of the
 * report object (success-shape and failure-shape both pinned above);
 * JSON.stringify preserves insertion order for string keys per the
 * ECMAScript spec.
 */
export declare function renderInspectionJson(report: InspectionReport): string;
/**
 * Render the report as a human-readable text block. Bytes are
 * identical across runs for the same `(spec contents, workspace
 * state, build)` tuple.
 *
 * The block:
 *   1. Header (Workflow, Spec, Root, Tasks)
 *   2. Op histogram
 *   3. Target tree (hierarchical; empty section omitted when no
 *      contributions exist, e.g. an all-`run_command` workflow)
 *   4. Findings — one line per finding, in task-index order; `none`
 *      when empty
 *   5. Summary footer
 *
 * Failure shape:
 *   - 4-line block naming code, spec path, reason.
 */
export declare function renderInspectionText(report: InspectionReport): string;
export {};
//# sourceMappingURL=workflow-inspect.d.ts.map