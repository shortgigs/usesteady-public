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

import type { WorkflowSpec } from "./types.js";
import { computeWorkflowSpecHash } from "./spec-hash.js";

import {
  RESUME_TOKEN_FORMAT_V1,
  type CompletedTaskSummary,
  type ResumeTokenV1,
} from "./resume-token-types.js";
import { computeTokenId } from "./resume-token-io.js";
import { opTypeForTask, idempotencyClassForTask } from "./resume-verifier.js";

export type BuildResumeTokenArgs = {
  readonly spec:                 WorkflowSpec;
  readonly workflowRunId:        string;
  readonly executionInstanceId?: string;
  readonly specPath:             string;
  readonly workspaceRoot:        string;
  readonly completedTaskCount:   number;
  /**
   * Provenance string. Convention: `"usesteady-cli@<package.json version>"`.
   * Free-form; not used for matching.
   */
  readonly issuedBy:             string;
  /**
   * ISO 8601 timestamp. Caller passes `new Date().toISOString()`.
   * Held as a parameter (not synthesized) so tests can pin output.
   */
  readonly issuedAt:             string;
  /**
   * Optional explicit token id; when omitted, derived deterministically
   * from the token content via `computeTokenId`. Tests use the explicit
   * form to assert byte-stability; production uses the derived form.
   */
  readonly tokenId?:             string;
};

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
export function buildResumeToken(args: BuildResumeTokenArgs): ResumeTokenV1 {
  const summaries: CompletedTaskSummary[] = [];
  for (let i = 0; i < args.completedTaskCount; i++) {
    const task = args.spec.tasks[i];
    if (!task) {
      throw new Error(`buildResumeToken: spec has only ${args.spec.tasks.length} tasks but completedTaskCount=${args.completedTaskCount}`);
    }
    summaries.push({
      index:             i,
      label:             task.label ?? task.input.slice(0, 60),
      op_type:           opTypeForTask(task),
      idempotency_class: idempotencyClassForTask(task),
    });
  }

  const draft: Omit<ResumeTokenV1, "token_id"> = {
    format:                    RESUME_TOKEN_FORMAT_V1,
    workflow_run_id:           args.workflowRunId,
    ...(args.executionInstanceId !== undefined
      ? { execution_instance_id: args.executionInstanceId }
      : {}),
    workflow_name:             args.spec.name,
    workflow_spec_hash:        computeWorkflowSpecHash(args.spec),
    spec_path:                 args.specPath,
    workspace_root:            args.workspaceRoot,
    completed_task_count:      args.completedTaskCount,
    total_task_count:          args.spec.tasks.length,
    completed_task_summaries:  summaries,
    issued_at:                 args.issuedAt,
    issued_by:                 args.issuedBy,
  };

  return {
    ...draft,
    token_id: args.tokenId ?? computeTokenId(draft),
  };
}

// workflow_run_id is the spec identity. execution_instance_id (when
// present) is the filename key so two executions of the same spec
// keep distinct resumable files. Resume of A reuses A's instance id.
