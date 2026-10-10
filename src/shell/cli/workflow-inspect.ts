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
 *     `command_policy_violation`, `ambiguous_match`, `target_exists`,
 *     `file_not_found`, `merge_conflict`) plus the existing CLI-layer
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

import { isAbsolute, resolve as resolvePath, relative as relativePath } from "node:path";

import type { WorkflowSpec, WorkflowTaskSpec } from "../../workflow/types.js";
import type { Operation } from "../../input/ir.js";
import type { CliErrorCode } from "../../input/cli-error.js";
import { validateOperation } from "../../input/feasibility-validator.js";

import {
  loadWorkflowSpecFromFile,
  WorkflowSpecLoadError,
} from "./workflow-spec-loader.js";
import { specTaskToIROperation, type SpecTaskLowering } from "./workflow-inspect-task-to-ir.js";
import {
  buildTargetTree,
  contributionsForIROperation,
  contributionsForNonDeterministicTask,
  renderTargetTreeText,
  type TargetContribution,
  type TargetEntry,
} from "./workflow-inspect-target-tree.js";
import {
  loadTeamPolicyPack,
  renderTeamPolicyInspectLines,
  teamPolicyMetadata,
  type TeamPolicyPackV1,
  type TeamPolicyLoadResult,
} from "../../workflow/team-policy-pack.js";

// ─── fs_dependent classification table ──────────────────────────────────────

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
type InspectFindingCode =
  | "invalid_path"
  | "outside_workspace"
  | "effective_resource_unresolved"
  | "invalid_filename_chars"
  | "invalid_filename_reserved_name"
  | "prohibited_path"
  | "command_policy_violation"
  | "ambiguous_match"
  | "target_exists"
  | "file_not_found"
  | "merge_conflict"
  | "invalid_op";

function inspectFindingFsDependent(code: InspectFindingCode): boolean {
  switch (code) {
    case "invalid_path":
    case "outside_workspace":
    case "invalid_filename_chars":
    case "invalid_filename_reserved_name":
    case "prohibited_path":
    case "command_policy_violation":
    case "ambiguous_match":
    case "invalid_op":
      return false;
    case "target_exists":
    case "file_not_found":
    case "merge_conflict":
    case "effective_resource_unresolved":
      return true;
  }
}

/**
 * Narrow an arbitrary `CliErrorCode` from `validateOperation` to the
 * inspect-known set. The validator can in principle emit codes outside
 * this set (the executor-only subset like `old_value_not_found`), but
 * by construction it never does at validate-stage. Anything not in our
 * set is treated as fs-dependent for safety (the conservative side).
 */
function classifyValidatorCode(code: CliErrorCode): InspectFindingCode {
  switch (code) {
    case "invalid_path":
    case "outside_workspace":
    case "invalid_filename_chars":
    case "invalid_filename_reserved_name":
    case "prohibited_path":
    case "command_policy_violation":
    case "ambiguous_match":
    case "target_exists":
    case "file_not_found":
    case "merge_conflict":
    case "effective_resource_unresolved":
      return code;
    default:
      // Defensive: unknown validator code. Cast back via the union so the
      // map handles it. Code path is unreachable today; included so a
      // future validator widening does not silently bypass the table.
      return "invalid_op";
  }
}

// ─── Op-type display naming ─────────────────────────────────────────────────

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
export type InspectOpName =
  | "write_file"
  | "create_dir"
  | "delete_file"
  | "rename"
  | "append_file"
  | "prepend_file"
  | "run_command"
  | "replace"
  | "non_deterministic"
  | "unknown";

function specTaskOpName(task: WorkflowTaskSpec, lowering: SpecTaskLowering): InspectOpName {
  if (!lowering.ok) {
    if (lowering.kind === "non_deterministic") return "non_deterministic";
    return "unknown";
  }
  // ok: prefer the SpecTask's declared operationType when present;
  // fall back to IR-derived name (this covers the structuredReplace-only
  // path where operationType may be absent on JSON-op inputs).
  if (task.operationType !== undefined) return task.operationType as InspectOpName;
  // Lowered IR op type → SpecTask name.
  switch (lowering.op.type) {
    case "create":     return "write_file";
    case "create_dir": return "create_dir";
    case "delete":     return "delete_file";
    case "rename":     return "rename";
    case "replace":    return "replace";
    case "append":     return "append_file";
    case "prepend":    return "prepend_file";
    case "run":        return "run_command";
  }
}

// ─── Public types ────────────────────────────────────────────────────────────

export type InspectionFinding = {
  readonly task_index:    number;
  readonly task_label:    string | null;
  readonly op_type:       InspectOpName;
  readonly code:          InspectFindingCode;
  readonly stage:         "load" | "validate";
  readonly fs_dependent:  boolean;
  readonly message:       string;
};

export type InspectionTargetEntry = TargetEntry;

export type InspectionReport =
  | InspectionReportSuccess
  | InspectionReportFailure;

export type InspectionReportSuccess = {
  readonly success:                    true;
  readonly workflow:                   string;
  readonly spec_path:                  string;
  readonly workspace_root:             string;
  /** Present when `.usesteady/policy.json` is valid; null when absent/invalid. */
  readonly team_policy:                TeamPolicyPackV1 | null;
  readonly team_policy_load:           TeamPolicyLoadResult;
  readonly task_count:                 number;
  readonly op_histogram:               Readonly<Record<string, number>>;
  readonly target_tree:                readonly InspectionTargetEntry[];
  readonly findings:                   readonly InspectionFinding[];
  readonly finding_count:              number;
  readonly static_finding_count:       number;
  readonly fs_dependent_finding_count: number;
};

export type InspectionReportFailure = {
  readonly success:    false;
  readonly error:      "file_not_found" | "invalid_json" | "invalid_op";
  readonly spec_path:  string;
  readonly message:    string;
};

// ─── Orchestrator ───────────────────────────────────────────────────────────

export type InspectOptions = {
  readonly specPath:       string;
  readonly workspaceRoot:  string;
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
export function inspectWorkflowSpec(opts: InspectOptions): InspectionReport {
  const absSpecPath = isAbsolute(opts.specPath) ? opts.specPath : resolvePath(opts.specPath);
  const absRoot     = isAbsolute(opts.workspaceRoot) ? opts.workspaceRoot : resolvePath(opts.workspaceRoot);

  let spec: WorkflowSpec;
  try {
    spec = loadWorkflowSpecFromFile(absSpecPath);
  } catch (cause) {
    if (cause instanceof WorkflowSpecLoadError) {
      // Narrow the loader's `CanonicalErrorCode` to the inspect-public
      // load-failure subset. The loader emits exactly these three.
      const loadCode = cause.code;
      const error: InspectionReportFailure["error"] =
        loadCode === "file_not_found" ? "file_not_found" :
        loadCode === "invalid_json"   ? "invalid_json"   :
        "invalid_op";
      return Object.freeze({
        success:   false,
        error,
        spec_path: absSpecPath,
        message:   cause.message,
      });
    }
    // Defensive: anything not a WorkflowSpecLoadError is treated as
    // `invalid_op` with the raw error message. The loader is documented
    // to throw only WorkflowSpecLoadError, so this branch is theoretical.
    return Object.freeze({
      success:   false,
      error:     "invalid_op",
      spec_path: absSpecPath,
      message:   cause instanceof Error ? cause.message : String(cause),
    });
  }

  // Lower each task, run validateOperation, collect findings + tree.
  const findings:      InspectionFinding[]   = [];
  const histogram:     Map<InspectOpName, number> = new Map();
  const contributions: TargetContribution[]  = [];

  for (let i = 0; i < spec.tasks.length; i++) {
    const task     = spec.tasks[i]!;
    const lowering = specTaskToIROperation(task);
    const opName   = specTaskOpName(task, lowering);

    histogram.set(opName, (histogram.get(opName) ?? 0) + 1);

    if (lowering.ok) {
      // Contribute to target tree from the IR op.
      for (const c of contributionsForIROperation(lowering.op)) {
        contributions.push(c);
      }
      // Run the canonical validator. NO short-circuit — every task gets
      // probed, regardless of whether earlier tasks produced findings.
      const result = validateOperation(lowering.op as Operation, { workspaceRoot: absRoot });
      if (result !== null) {
        const code = classifyValidatorCode(result.code);
        findings.push({
          task_index:    i,
          task_label:    typeof task.label === "string" ? task.label : null,
          op_type:       opName,
          code,
          stage:         "validate",
          fs_dependent:  inspectFindingFsDependent(code),
          message:       result.message,
        });
      }
    } else if (lowering.kind === "non_deterministic") {
      // Claude / non-deterministic task: contribute declared targetFiles
      // (if any) to the tree; produce no finding. The histogram bucket
      // already records its presence.
      for (const c of contributionsForNonDeterministicTask(task.targetFiles)) {
        contributions.push(c);
      }
    } else {
      // Invalid lowering. Surface as a load-stage finding with `invalid_op`.
      findings.push({
        task_index:    i,
        task_label:    typeof task.label === "string" ? task.label : null,
        op_type:       "unknown",
        code:          "invalid_op",
        stage:         "load",
        fs_dependent:  false,
        message:       lowering.reason,
      });
    }
  }

  // Sort findings by task_index (stable; same-task findings preserve
  // insertion order, but there can be at most one finding per task today
  // because validateOperation short-circuits per op).
  findings.sort((a, b) => a.task_index - b.task_index);

  // Build histogram as a stable, alphabetically-keyed record.
  const histKeys = [...histogram.keys()].sort();
  const histRecord: Record<string, number> = {};
  for (const k of histKeys) {
    histRecord[k] = histogram.get(k) ?? 0;
  }

  const tree = buildTargetTree(contributions);

  const staticCount     = findings.filter((f) => !f.fs_dependent).length;
  const fsDependentCount = findings.length - staticCount;

  const policyResult = loadTeamPolicyPack(absRoot);

  return Object.freeze({
    success:                    true,
    workflow:                   spec.name,
    spec_path:                  absSpecPath,
    workspace_root:             absRoot,
    team_policy:                teamPolicyMetadata(policyResult),
    team_policy_load:           policyResult,
    task_count:                 spec.tasks.length,
    op_histogram:               Object.freeze(histRecord),
    target_tree:                tree,
    findings:                   Object.freeze(findings),
    finding_count:              findings.length,
    static_finding_count:       staticCount,
    fs_dependent_finding_count: fsDependentCount,
  });
}

// ─── JSON renderer ──────────────────────────────────────────────────────────

/**
 * Render the report as a single-line JSON string terminated by exactly
 * one newline. Key order is fixed by the construction order of the
 * report object (success-shape and failure-shape both pinned above);
 * JSON.stringify preserves insertion order for string keys per the
 * ECMAScript spec.
 */
export function renderInspectionJson(report: InspectionReport): string {
  return JSON.stringify(report) + "\n";
}

// ─── Text renderer ──────────────────────────────────────────────────────────

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
export function renderInspectionText(report: InspectionReport): string {
  if (!report.success) {
    return [
      "",
      "  Workflow inspection failed.",
      `    Code:   ${report.error}`,
      `    Spec:   ${report.spec_path}`,
      `    Reason: ${report.message}`,
      "",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("");
  lines.push(`  Workflow: ${report.workflow}`);
  lines.push(`  Spec:     ${report.spec_path}`);
  lines.push(`  Root:     ${report.workspace_root}`);
  lines.push(`  Tasks:    ${report.task_count}`);
  lines.push("");
  const policyLines = renderTeamPolicyInspectLines(report.team_policy_load);
  if (policyLines.length > 0) {
    for (const policyLine of policyLines) {
      lines.push(policyLine);
    }
    lines.push("");
  }

  // Op histogram (alphabetical; right-aligned counts).
  lines.push("  Op histogram");
  const histEntries = Object.entries(report.op_histogram);
  if (histEntries.length === 0) {
    lines.push("    (no tasks)");
  } else {
    const widestName = histEntries.reduce((w, [n]) => Math.max(w, n.length), 0);
    for (const [name, count] of histEntries) {
      const pad = " ".repeat(Math.max(widestName - name.length + 2, 2));
      lines.push(`    ${name}${pad}${count}`);
    }
  }
  lines.push("");

  // Target tree.
  if (report.target_tree.length === 0) {
    lines.push("  Target tree");
    lines.push("    (no path-bearing tasks)");
    lines.push("");
  } else {
    lines.push("  Target tree");
    for (const treeLine of renderTargetTreeText(report.target_tree)) {
      lines.push(`  ${treeLine}`);
    }
    lines.push("");
  }

  // Findings.
  if (report.findings.length === 0) {
    lines.push("  Findings: none");
  } else {
    lines.push(`  Findings (${report.findings.length})`);
    for (const f of report.findings) {
      const taskNum    = f.task_index + 1;
      const label      = f.task_label !== null ? ` "${f.task_label}"` : "";
      const dependency = f.fs_dependent ? "fs-dependent" : "static";
      const detail     = shortFindingDetail(f, report.workspace_root);
      lines.push(`    task ${taskNum} [${f.op_type}]${label}  ${f.code}  ${detail}  (${dependency})`);
    }
  }
  lines.push("");

  // Summary footer.
  lines.push(
    `  Summary: ${report.task_count} tasks, ${report.finding_count} findings ` +
      `(${report.static_finding_count} static, ${report.fs_dependent_finding_count} fs-dependent).`,
  );
  lines.push("");
  return lines.join("\n");
}

/**
 * Produce a short, human-readable tail for the findings line. The full
 * machine-readable message lives in JSON output's `message` field; the
 * text mode shows a compact tail that helps the operator orient.
 *
 *   - `prohibited_path` / `outside_workspace` / `invalid_path` /
 *     `target_exists` / `file_not_found` / `merge_conflict` —
 *     emit the relevant path (made workspace-relative when possible).
 *   - `ambiguous_match` — emit the directive quote when present.
 *   - `invalid_filename_chars` / `invalid_filename_reserved_name` —
 *     emit a one-word tag.
 *   - `invalid_op` — emit the reason verbatim, truncated.
 */
function shortFindingDetail(f: InspectionFinding, workspaceRoot: string): string {
  const msg = f.message;
  // Common: "(field: path)" suffix in validator messages. Pull it.
  //
  // Use `[^()]+` (not `.+`) for the captured path so the regex cannot span
  // intermediate parentheses. Some validator messages embed nested
  // parenthetical detail BEFORE the final `(field: path)` tail — e.g. the
  // reserved-name refusal embeds `(basename: "...")` and `(e.g. ...)` in
  // its detail string. A greedy `.+` against the final `\)` collapses
  // the whole tail into the captured group and produces an unreadable
  // detail line; `[^()]+` correctly anchors to the final atomic
  // `(field: path)` form.
  const fieldPathMatch = msg.match(/\(([a-z]+): ([^()]+)\)\s*$/);
  if (fieldPathMatch !== null) {
    const rawPath = fieldPathMatch[2]!;
    const relIfPossible = makeRelativeToRoot(rawPath, workspaceRoot);
    return relIfPossible;
  }
  // `target_exists` / `file_not_found` / `merge_conflict` typically end
  // with the absolute resolved path. Extract the trailing path token.
  const absTail = msg.match(/(?:[A-Za-z]:[\\/]|\/)[^\s]*$/);
  if (absTail !== null) {
    return makeRelativeToRoot(absTail[0]!, workspaceRoot);
  }
  // Fallback: truncate the message.
  if (msg.length > 80) return msg.slice(0, 77) + "...";
  return msg;
}

function makeRelativeToRoot(path: string, root: string): string {
  if (!isAbsolute(path)) return path;
  try {
    const rel = relativePath(root, path);
    if (rel.length === 0) return ".";
    if (rel.startsWith("..")) return path;
    return rel.replace(/\\/g, "/");
  } catch {
    return path;
  }
}
