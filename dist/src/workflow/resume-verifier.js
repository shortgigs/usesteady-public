/**
 * src/workflow/resume-verifier.ts
 *
 * P2-min — Per-task resume verification.
 *
 * Given a validated token and the current spec + workspace, classify
 * each `0..K-1` task into one of the `TaskVerificationVerdict`s. The
 * coordinator then decides what to do per-task:
 *
 *   already_done           → silent skip
 *   previously_skipped     → silent skip
 *   requires_reconfirm     → re-prompt operator (default: abort)
 *   interpretive_reconfirm → re-prompt operator (default: abort)
 *   task_state_diverged    → refuse resume; operator must reconcile
 *
 * Authority discipline:
 *
 *   - The verifier is READ-ONLY w.r.t. the workspace. It uses
 *     `existsSync` and `statSync` only; it never writes, deletes, or
 *     renames anything.
 *   - Approval is not encoded here. The verifier classifies; the
 *     coordinator + operator make the runtime decision.
 *   - Idempotency-class assignment matches the closed set in
 *     `resume-verifier-types.ts`. The set is intentionally narrow:
 *     v1 marks only the structurally-checkable ops (create, delete,
 *     rename, create_dir) as `checkable`. Content-bearing ops
 *     (replace, append, prepend) and side-effecting ops (run) are
 *     `requires_reconfirm` until a follow-up primitive broadens
 *     the checkable set with content hashing.
 */
import { existsSync, statSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
// ─── Idempotency classification ─────────────────────────────────────────────
/**
 * Closed map of operationType → idempotency class. The verifier's
 * v1 checkable set is intentionally narrow — only ops whose
 * post-state is "presence/absence of a path" qualify. Broader content
 * hashing is left to a follow-up primitive.
 *
 * `claude` runtime is handled separately (see `classifyTask`).
 */
function classifyOpType(opType) {
    switch (opType) {
        // Canonical spec operationType values (see WorkflowTaskSpec).
        // v1 checkable set: ops whose post-state reduces to path presence/absence.
        case "write_file":
        case "delete_file":
        case "rename":
        case "create_dir":
            return "checkable";
        // Content-bearing ops — content hash check deferred to a follow-up.
        case "replace":
        case "append_file":
        case "prepend_file":
            return "requires_reconfirm";
        // Side-effecting op — no idempotency signal on disk.
        case "run_command":
            return "requires_reconfirm";
        case "claude":
            return "interpretive";
        default:
            // Conservative: unknown op types are treated as requires_reconfirm
            // (forces operator confirmation rather than silently skipping).
            return "requires_reconfirm";
    }
}
function classifyTask(task) {
    if (task.runtime === "claude") {
        return { opType: "claude", klass: "interpretive" };
    }
    // For replace tasks the operationType may be "replace" with structuredReplace,
    // or undefined with structuredReplace (NL replace). Either way we report
    // "replace" as the op_type for token recording / verifier classification.
    if (task.structuredReplace !== undefined && (task.operationType === "replace" || task.operationType === undefined)) {
        return { opType: "replace", klass: classifyOpType("replace") };
    }
    const opType = task.operationType ?? "unknown";
    return { opType, klass: classifyOpType(opType) };
}
function probeCreate(task, workspaceRoot) {
    const target = firstTargetPath(task);
    if (!target) {
        return { verdict: "task_state_diverged", detail: "create task is missing a target path." };
    }
    const abs = resolvePath(workspaceRoot, target);
    if (existsSync(abs)) {
        // Post-create state present.
        return { verdict: "already_done", detail: `${target} exists` };
    }
    return {
        verdict: "task_state_diverged",
        detail: `expected ${target} to exist (per completed token) but it is missing`,
    };
}
function probeDelete(task, workspaceRoot) {
    const target = firstTargetPath(task);
    if (!target) {
        return { verdict: "task_state_diverged", detail: "delete task is missing a target path." };
    }
    const abs = resolvePath(workspaceRoot, target);
    if (!existsSync(abs)) {
        return { verdict: "already_done", detail: `${target} is absent` };
    }
    return {
        verdict: "task_state_diverged",
        detail: `expected ${target} to be absent (per completed token) but it still exists`,
    };
}
function probeRename(task, workspaceRoot) {
    // Canonical WorkflowTaskSpec: rename source = targetFiles[0], destination = newPath.
    const fromPath = firstTargetPath(task);
    const toPath = task.newPath;
    if (!fromPath || !toPath) {
        return {
            verdict: "task_state_diverged",
            detail: "rename task is missing targetFiles[0] (source) or newPath (destination).",
        };
    }
    const absFrom = resolvePath(workspaceRoot, fromPath);
    const absTo = resolvePath(workspaceRoot, toPath);
    const fromExists = existsSync(absFrom);
    const toExists = existsSync(absTo);
    if (!fromExists && toExists) {
        return { verdict: "already_done", detail: `${fromPath} → ${toPath} (destination present, source absent)` };
    }
    if (fromExists && !toExists) {
        return {
            verdict: "task_state_diverged",
            detail: `rename appears not to have happened: source ${fromPath} still present, destination ${toPath} absent`,
        };
    }
    if (fromExists && toExists) {
        return {
            verdict: "task_state_diverged",
            detail: `both source ${fromPath} and destination ${toPath} present — workspace state ambiguous`,
        };
    }
    // !fromExists && !toExists
    return {
        verdict: "task_state_diverged",
        detail: `neither source ${fromPath} nor destination ${toPath} present — cannot confirm rename completion`,
    };
}
function probeCreateDir(task, workspaceRoot) {
    const target = firstTargetPath(task);
    if (!target) {
        return { verdict: "task_state_diverged", detail: "create_dir task is missing a target path." };
    }
    const abs = resolvePath(workspaceRoot, target);
    if (!existsSync(abs)) {
        return {
            verdict: "task_state_diverged",
            detail: `expected directory ${target} to exist (per completed token) but it is missing`,
        };
    }
    try {
        const st = statSync(abs);
        if (st.isDirectory()) {
            return { verdict: "already_done", detail: `${target} exists as a directory` };
        }
        return {
            verdict: "task_state_diverged",
            detail: `expected ${target} to be a directory but it is not`,
        };
    }
    catch (err) {
        return {
            verdict: "task_state_diverged",
            detail: `could not stat ${target}: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
function firstTargetPath(task) {
    // Canonical: WorkflowTaskSpec encodes its target path via `targetFiles[0]`
    // for path-bearing ops (write_file, delete_file, rename source, create_dir,
    // append_file, prepend_file). The replace op encodes its path inside
    // `structuredReplace.filePath`; the verifier does not call this helper
    // for the replace branch (replace is requires_reconfirm in v1).
    if (Array.isArray(task.targetFiles) && task.targetFiles.length > 0) {
        const first = task.targetFiles[0];
        if (typeof first === "string" && first.length > 0)
            return first;
    }
    return null;
}
// ─── Public entry point ─────────────────────────────────────────────────────
/**
 * Run resume verification across the `[0, completed_task_count)`
 * range. Pure inspection — no writes. Each task is classified
 * independently; the aggregate gate combines them per the rule:
 *
 *   any diverged                 → aggregate = "diverged"
 *   else any requires_reconfirm  → aggregate = "needs_reconfirm"
 *   else                          → aggregate = "clean"
 *
 * `previously_skipped` is informational only — does not affect the
 * aggregate.
 */
export function verifyResumePoint(token, spec, workspaceRoot) {
    const findings = [];
    let alreadyDone = 0;
    let diverged = 0;
    let reconfirm = 0;
    let previouslySkipped = 0;
    for (let i = 0; i < token.completed_task_count; i++) {
        const summary = token.completed_task_summaries[i];
        const task = spec.tasks[i];
        // Defensive: validator already guarantees both are present + matching.
        if (!summary || !task) {
            findings.push({
                task_index: i,
                task_label: summary?.label ?? `task[${i}]`,
                op_type: summary?.op_type ?? "unknown",
                idempotency_class: summary?.idempotency_class ?? "requires_reconfirm",
                verdict: "task_state_diverged",
                detail: "internal: spec/token desynchronized after validation",
            });
            diverged++;
            continue;
        }
        // previously_skipped tasks remain skipped.
        if (summary.idempotency_class === "skipped") {
            findings.push({
                task_index: i,
                task_label: summary.label,
                op_type: summary.op_type,
                idempotency_class: "skipped",
                verdict: "previously_skipped",
                detail: "task was skipped in the original run; remains skipped on resume",
            });
            previouslySkipped++;
            continue;
        }
        const { opType, klass } = classifyTask(task);
        if (klass === "interpretive") {
            findings.push({
                task_index: i,
                task_label: summary.label,
                op_type: opType,
                idempotency_class: "interpretive",
                verdict: "interpretive_reconfirm",
                detail: "Claude-runtime task; output cannot be statically verified",
            });
            reconfirm++;
            continue;
        }
        if (klass === "requires_reconfirm") {
            findings.push({
                task_index: i,
                task_label: summary.label,
                op_type: opType,
                idempotency_class: "requires_reconfirm",
                verdict: "requires_reconfirm",
                detail: `op type "${opType}" is not idempotency-checkable; operator must confirm`,
            });
            reconfirm++;
            continue;
        }
        // klass === "checkable" — probe the filesystem.
        let probe;
        switch (opType) {
            case "write_file":
                probe = probeCreate(task, workspaceRoot);
                break;
            case "delete_file":
                probe = probeDelete(task, workspaceRoot);
                break;
            case "rename":
                probe = probeRename(task, workspaceRoot);
                break;
            case "create_dir":
                probe = probeCreateDir(task, workspaceRoot);
                break;
            default:
                // Should not be reachable given classifyOpType's mapping.
                probe = {
                    verdict: "task_state_diverged",
                    detail: `internal: checkable op type "${opType}" has no probe implementation`,
                };
        }
        findings.push({
            task_index: i,
            task_label: summary.label,
            op_type: opType,
            idempotency_class: "checkable",
            verdict: probe.verdict,
            detail: probe.detail,
        });
        if (probe.verdict === "already_done")
            alreadyDone++;
        else if (probe.verdict === "task_state_diverged")
            diverged++;
    }
    const aggregate = diverged > 0 ? "diverged" :
        reconfirm > 0 ? "needs_reconfirm" :
            "clean";
    return {
        findings,
        already_done: alreadyDone,
        diverged,
        reconfirm,
        previously_skipped: previouslySkipped,
        aggregate,
    };
}
// Re-export the type-only `classifyTask` helper for tests.
export { classifyOpType };
/**
 * Shared helper: derive the canonical op_type string for a
 * `WorkflowTaskSpec`. Used by:
 *   - the token writer (when recording a completed task)
 *   - the validator (when comparing token vs current spec)
 *   - the verifier (when classifying idempotency)
 *
 * Single source of truth keeps the three call sites synchronized; if
 * the WorkflowTaskSpec discriminant ever changes, this function changes
 * once.
 */
export function opTypeForTask(task) {
    if (task.runtime === "claude")
        return "claude";
    if (task.structuredReplace !== undefined && (task.operationType === "replace" || task.operationType === undefined)) {
        return "replace";
    }
    return task.operationType ?? "unknown";
}
/**
 * Shared helper: derive the canonical idempotency class for a task.
 * Wraps `classifyTask` to expose only the class (useful when recording
 * a completed task summary).
 */
export function idempotencyClassForTask(task) {
    return classifyTask(task).klass;
}
//# sourceMappingURL=resume-verifier.js.map