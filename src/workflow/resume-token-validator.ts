/**
 * src/workflow/resume-token-validator.ts
 *
 * P2-min — Token-vs-spec/workspace validation.
 *
 * Given a structurally-valid token (from `readResumeToken`) and the
 * current spec + workspace root, decide whether the token is bound to
 * exactly the same workflow run identity.
 *
 * This is the "gate before per-task verification" step. If the gate
 * fails, the resume path stops here with a closed-set error code; the
 * per-task verifier never runs.
 *
 * Authority discipline:
 *   - This module's only output is a `ResumeTokenValidationResult`
 *     discriminant. It performs no I/O beyond reading the file when
 *     `validateTokenForResume` is asked to load + validate in one
 *     call.
 *   - No new error codes minted — the closed set lives in
 *     `resume-token-types.ts` as `ResumeTokenRejectionCode`.
 */

import { resolve as resolvePath } from "node:path";

import type { WorkflowSpec } from "./types.js";
import { computeWorkflowSpecHash } from "./spec-hash.js";

import {
  type ResumeTokenV1,
  type ResumeTokenValidationResult,
} from "./resume-token-types.js";
import { readResumeToken } from "./resume-token-io.js";
import { opTypeForTask } from "./resume-verifier.js";

/**
 * Validate a parsed token against the current spec + workspace root.
 *
 * Order of checks (each short-circuits on failure):
 *   1. Spec hash match.
 *   2. Total task count match.
 *   3. completed_task_count is in [0, total_task_count].
 *   4. Per-task op_type signature match for `[0, completed_task_count)`.
 *   5. Workspace root match (resolved/normalized).
 *
 * Step 6 is a special-case: `completed_task_count === total_task_count`
 * yields `workflow_already_complete`. Friendly exit; not an error.
 */
export function validateTokenAgainstSpec(
  token:          ResumeTokenV1,
  spec:           WorkflowSpec,
  workspaceRoot:  string,
): ResumeTokenValidationResult {
  // 1. Spec hash match.
  const currentHash = computeWorkflowSpecHash(spec);
  if (currentHash !== token.workflow_spec_hash) {
    return {
      ok: false,
      code: "spec_hash_mismatch",
      message:
        `Resume token was issued for spec hash ${token.workflow_spec_hash.slice(0, 12)}…, `
        + `but the current spec hashes to ${currentHash.slice(0, 12)}…. `
        + `The spec was edited since the token was issued. Resume refuses to proceed; `
        + `start a fresh run.`,
    };
  }

  // 2. Total task count match (redundant if (1) passed, but explicit
  //    keeps the error clearer when the hash check changes shape).
  if (spec.tasks.length !== token.total_task_count) {
    return {
      ok: false,
      code: "task_count_mismatch",
      message:
        `Resume token expects ${token.total_task_count} tasks; current spec has ${spec.tasks.length}.`,
    };
  }

  // 3. Bounds check on completed_task_count.
  if (
    !Number.isInteger(token.completed_task_count)
    || token.completed_task_count < 0
    || token.completed_task_count > token.total_task_count
  ) {
    return {
      ok: false,
      code: "corrupt_resume_token",
      message:
        `Resume token has out-of-range completed_task_count `
        + `(${token.completed_task_count} not in [0, ${token.total_task_count}]).`,
    };
  }

  // Already-complete short-circuit. Friendly: not an error.
  if (token.completed_task_count === token.total_task_count) {
    return {
      ok: false,
      code: "workflow_already_complete",
      message:
        `Resume token reports all ${token.total_task_count} tasks already complete. `
        + `Nothing to resume.`,
    };
  }

  // Summary length consistency.
  if (token.completed_task_summaries.length !== token.completed_task_count) {
    return {
      ok: false,
      code: "corrupt_resume_token",
      message:
        `Resume token's completed_task_summaries length (${token.completed_task_summaries.length}) `
        + `does not match completed_task_count (${token.completed_task_count}).`,
    };
  }

  // 4. Per-task signature check for the completed prefix.
  for (let i = 0; i < token.completed_task_count; i++) {
    const summary = token.completed_task_summaries[i];
    if (!summary || summary.index !== i) {
      return {
        ok: false,
        code: "corrupt_resume_token",
        message: `Resume token's completed_task_summaries[${i}] has wrong index or is missing.`,
      };
    }
    const specTask = spec.tasks[i];
    if (!specTask) {
      // Defensive: should be caught by total_task_count match.
      return {
        ok: false,
        code: "task_count_mismatch",
        message: `Resume token references task index ${i} but the spec has only ${spec.tasks.length} tasks.`,
      };
    }
    const specOpType = opTypeForTask(specTask);
    if (specOpType !== summary.op_type) {
      return {
        ok: false,
        code: "task_signature_mismatch",
        message:
          `Resume token's task ${i} op_type "${summary.op_type}" does not match `
          + `the current spec's task ${i} op_type "${specOpType}". `
          + `The spec was edited; resume refuses.`,
      };
    }
  }

  // 5. Workspace root match (normalized).
  const tokenRoot   = resolvePath(token.workspace_root);
  const currentRoot = resolvePath(workspaceRoot);
  if (tokenRoot !== currentRoot) {
    return {
      ok: false,
      code: "workspace_root_mismatch",
      message:
        `Resume token was issued in workspace ${tokenRoot}; `
        + `current workspace is ${currentRoot}. `
        + `Resume refuses to cross workspaces.`,
    };
  }

  return { ok: true, token };
}

/**
 * Convenience: read + parse + validate in one call. Returns the same
 * discriminant as `validateTokenAgainstSpec`, plus the read-stage
 * failure codes mapped to canonical token-rejection codes:
 *
 *   missing            → invalid_resume_token
 *   invalid (parse)    → invalid_resume_token
 *   unsupported_format → invalid_resume_token_format
 */
export function validateTokenForResume(
  tokenPath:      string,
  spec:           WorkflowSpec,
  workspaceRoot:  string,
): ResumeTokenValidationResult {
  const r = readResumeToken(tokenPath);
  switch (r.kind) {
    case "ok":
      return validateTokenAgainstSpec(r.token, spec, workspaceRoot);
    case "missing":
      return { ok: false, code: "invalid_resume_token", message: r.reason };
    case "invalid":
      return { ok: false, code: "invalid_resume_token", message: r.reason };
    case "unsupported_format":
      return {
        ok: false,
        code: "invalid_resume_token_format",
        message:
          `Resume token format "${r.seen}" is not supported by this CLI version. `
          + `Expected "usesteady.resume-token.v1".`,
      };
  }
}
