/**
 * src/workflow/resume-token-builder.ts
 *
 * P2-min — Token construction.
 *
 * Pure: takes a spec + run identity + completed-task-count + workspace
 * root, returns a ready-to-write `ResumeTokenV1`. Performs no I/O —
 * the token's persistence is the caller's responsibility (via
 * `writeResumeToken`).
 *
 * Authority discipline:
 *   - No approval state in the token. The builder cannot encode any.
 *   - `issued_by` is a free-form provenance string ("usesteady-cli@<version>");
 *     it is informational only, not load-bearing.
 */
import { computeWorkflowSpecHash } from "./spec-hash.js";
import { RESUME_TOKEN_FORMAT_V1, } from "./resume-token-types.js";
import { computeTokenId } from "./resume-token-io.js";
import { opTypeForTask, idempotencyClassForTask } from "./resume-verifier.js";
/**
 * Build a ResumeTokenV1 from inputs. Pure.
 *
 * Pre-conditions (caller enforces):
 *   - `completedTaskCount` is in `[0, spec.tasks.length]`.
 *   - `spec.name` is a string (loader guarantees this).
 *
 * The completed_task_summaries array reflects the first
 * `completedTaskCount` tasks in spec order. The `idempotency_class`
 * field captures the task's class AT TOKEN-WRITE TIME (i.e. matches
 * the spec the task ran against, not some future spec).
 */
export function buildResumeToken(args) {
    const summaries = [];
    for (let i = 0; i < args.completedTaskCount; i++) {
        const task = args.spec.tasks[i];
        if (!task) {
            throw new Error(`buildResumeToken: spec has only ${args.spec.tasks.length} tasks but completedTaskCount=${args.completedTaskCount}`);
        }
        summaries.push({
            index: i,
            label: task.label ?? task.input.slice(0, 60),
            op_type: opTypeForTask(task),
            idempotency_class: idempotencyClassForTask(task),
        });
    }
    const draft = {
        format: RESUME_TOKEN_FORMAT_V1,
        workflow_run_id: args.workflowRunId,
        workflow_name: args.spec.name,
        workflow_spec_hash: computeWorkflowSpecHash(args.spec),
        spec_path: args.specPath,
        workspace_root: args.workspaceRoot,
        completed_task_count: args.completedTaskCount,
        total_task_count: args.spec.tasks.length,
        completed_task_summaries: summaries,
        issued_at: args.issuedAt,
        issued_by: args.issuedBy,
    };
    return {
        ...draft,
        token_id: args.tokenId ?? computeTokenId(draft),
    };
}
// Note: workflowRunId is NOT generated here — it is derived
// deterministically from the spec by the coordinator
// (`deriveWorkflowRunId` in src/workflow/coordinator.ts). The token
// uses that same value verbatim. A fresh UUID-style id would break
// the contract: same spec, same run id, same token filename, so
// a resumed run can find its token from the same workspace + spec
// even after a full process crash.
//# sourceMappingURL=resume-token-builder.js.map