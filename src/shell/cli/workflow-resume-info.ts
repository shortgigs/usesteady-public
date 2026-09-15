/**
 * src/shell/cli/workflow-resume-info.ts
 *
 * P2-min — Read-only resume-token inspection subcommand.
 *
 * Mirrors `workflow inspect`'s discipline: zero authority, deterministic
 * output, exits non-zero only on read/parse failure. Validates a token
 * against a spec + workspace and prints a structured report so
 * operators can decide whether to invoke `--resume-from` before risking
 * a real run.
 *
 * Surface:
 *   usesteady workflow resume-info <token.json> --spec <spec.json>
 *     [--workspace-root <dir>] [--output json]
 *
 * Exit codes:
 *   0 — token loads, parses, validates, and verifies clean OR cleanly
 *       reports needs_reconfirm / diverged status (the report itself
 *       is the deliverable).
 *   1 — token file missing, malformed, or unsupported format.
 *   1 — spec file missing or malformed.
 *
 * The command NEVER triggers execution and NEVER writes anywhere.
 */

import { isAbsolute, resolve as resolvePath } from "node:path";

import { loadWorkflowSpecFromFile, WorkflowSpecLoadError } from "./workflow-spec-loader.js";
import { readResumeToken } from "../../workflow/resume-token-io.js";
import { validateTokenAgainstSpec } from "../../workflow/resume-token-validator.js";
import { verifyResumePoint } from "../../workflow/resume-verifier.js";
import type { ResumeTokenV1 } from "../../workflow/resume-token-types.js";
import type { ResumeVerificationReport, TaskVerificationFinding } from "../../workflow/resume-verifier-types.js";

// ─── Public result shape ────────────────────────────────────────────────────

/**
 * Top-level result of `workflow resume-info`. Returned to the CLI
 * dispatcher which renders text or JSON.
 *
 * Discriminants:
 *
 *   - success: false, stage: "load_token"       → token I/O / parse failure
 *   - success: false, stage: "load_spec"        → spec I/O / parse failure
 *   - success: false, stage: "validate_token"   → token-vs-spec/workspace mismatch
 *   - success: true,  stage: "verified"         → verification ran; see report
 *   - success: true,  stage: "already_complete" → token says all tasks done
 */
export type ResumeInfoResult =
  | { readonly success: false; readonly stage: "load_token";     readonly code: string; readonly message: string; readonly path: string }
  | { readonly success: false; readonly stage: "load_spec";      readonly code: string; readonly message: string; readonly path: string }
  | { readonly success: false; readonly stage: "validate_token"; readonly code: string; readonly message: string }
  | {
      readonly success: true;
      readonly stage:   "verified";
      readonly token:   ResumeTokenV1;
      readonly report:  ResumeVerificationReport;
    }
  | {
      readonly success: true;
      readonly stage:   "already_complete";
      readonly token:   ResumeTokenV1;
    };

// ─── Orchestrator ───────────────────────────────────────────────────────────

export type ResumeInfoArgs = {
  readonly tokenPath:     string;
  readonly specPath:      string;
  readonly workspaceRoot: string;
};

/**
 * Run resume-info for a (token, spec, workspaceRoot) triple. Pure
 * orchestration over the I/O modules; no console output here.
 */
export function runResumeInfo(args: ResumeInfoArgs): ResumeInfoResult {
  // 1. Load token.
  const tokenAbs = isAbsolute(args.tokenPath) ? args.tokenPath : resolvePath(process.cwd(), args.tokenPath);
  const read = readResumeToken(tokenAbs);
  if (read.kind === "missing") {
    return { success: false, stage: "load_token", code: "invalid_resume_token", message: read.reason, path: tokenAbs };
  }
  if (read.kind === "invalid") {
    return { success: false, stage: "load_token", code: "invalid_resume_token", message: read.reason, path: tokenAbs };
  }
  if (read.kind === "unsupported_format") {
    return {
      success: false,
      stage:   "load_token",
      code:    "invalid_resume_token_format",
      message: `Resume token format "${read.seen}" is not supported by this CLI version. Expected "usesteady.resume-token.v1".`,
      path:    tokenAbs,
    };
  }

  // 2. Load spec.
  const specAbs = isAbsolute(args.specPath) ? args.specPath : resolvePath(process.cwd(), args.specPath);
  let spec;
  try {
    spec = loadWorkflowSpecFromFile(specAbs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code    = err instanceof WorkflowSpecLoadError ? err.code : "invalid_op";
    return { success: false, stage: "load_spec", code, message, path: specAbs };
  }

  // 3. Validate token vs spec + workspace.
  const validation = validateTokenAgainstSpec(read.token, spec, args.workspaceRoot);
  if (!validation.ok) {
    if (validation.code === "workflow_already_complete") {
      return { success: true, stage: "already_complete", token: read.token };
    }
    return { success: false, stage: "validate_token", code: validation.code, message: validation.message };
  }

  // 4. Run per-task verification.
  const report = verifyResumePoint(read.token, spec, args.workspaceRoot);
  return { success: true, stage: "verified", token: read.token, report };
}

// ─── Renderers ──────────────────────────────────────────────────────────────

function renderFinding(f: TaskVerificationFinding): string {
  const marker =
    f.verdict === "already_done"           ? "ok "   :
    f.verdict === "previously_skipped"     ? "skip"  :
    f.verdict === "requires_reconfirm"     ? "?  "   :
    f.verdict === "interpretive_reconfirm" ? "?  "   :
    /* diverged */                            "!! ";
  return `    [${marker}] task[${f.task_index}] ${f.op_type.padEnd(12)}  ${f.task_label}\n          → ${f.verdict}: ${f.detail}`;
}

/**
 * Deterministic text renderer for the result of `runResumeInfo`.
 */
export function renderResumeInfoText(result: ResumeInfoResult): { lines: readonly string[]; exitCode: number } {
  if (!result.success) {
    switch (result.stage) {
      case "load_token":
        return {
          exitCode: 1,
          lines: [
            "",
            `  ✗ Could not read resume token.`,
            `    Code: ${result.code}`,
            `    Path: ${result.path}`,
            `    ${result.message}`,
            "",
          ],
        };
      case "load_spec":
        return {
          exitCode: 1,
          lines: [
            "",
            `  ✗ Could not load workflow spec.`,
            `    Code: ${result.code}`,
            `    Path: ${result.path}`,
            `    ${result.message}`,
            "",
          ],
        };
      case "validate_token":
        return {
          exitCode: 1,
          lines: [
            "",
            `  ✗ Resume token does not match current spec/workspace.`,
            `    Code: ${result.code}`,
            `    ${result.message}`,
            "",
          ],
        };
    }
  }

  if (result.stage === "already_complete") {
    const t = result.token;
    return {
      exitCode: 0,
      lines: [
        "",
        `  Resume token reports the workflow is already complete.`,
        `    Workflow: ${t.workflow_name}`,
        `    Run ID:   ${t.workflow_run_id}`,
        `    Tasks:    ${t.completed_task_count}/${t.total_task_count}`,
        `  Nothing to resume.`,
        "",
      ],
    };
  }

  // verified stage.
  const t = result.token;
  const r = result.report;
  const lines: string[] = [];
  lines.push("");
  lines.push(`  Resume token: ${t.token_id}`);
  lines.push(`  Workflow:     ${t.workflow_name}`);
  lines.push(`  Run ID:       ${t.workflow_run_id}`);
  lines.push(`  Completed:    ${t.completed_task_count}/${t.total_task_count}`);
  lines.push(`  Workspace:    ${t.workspace_root}`);
  lines.push("");
  lines.push(`  Verification report`);
  lines.push(`    already_done:        ${r.already_done}`);
  lines.push(`    requires_reconfirm:  ${r.reconfirm}`);
  lines.push(`    previously_skipped:  ${r.previously_skipped}`);
  lines.push(`    diverged:            ${r.diverged}`);
  lines.push(`    aggregate:           ${r.aggregate}`);
  lines.push("");
  if (r.findings.length > 0) {
    lines.push(`  Per-task verdicts`);
    for (const f of r.findings) lines.push(renderFinding(f));
    lines.push("");
  }
  lines.push(`  No execution occurred. No tasks ran. No workspace changes.`);
  lines.push("");
  return { lines, exitCode: 0 };
}

/**
 * Deterministic JSON renderer for the result of `runResumeInfo`.
 *
 * The shape is the public contract: keys are sorted by emission order
 * matching the type definition. Tests pin the exact bytes.
 */
export function renderResumeInfoJson(result: ResumeInfoResult): { json: string; exitCode: number } {
  // Top-level shape is the result itself (including the discriminants).
  // We serialize with deterministic key order.
  const exitCode = result.success ? 0 : 1;
  // Re-serialize to ensure deterministic output across runs.
  const json = JSON.stringify(result) + "\n";
  return { json, exitCode };
}
