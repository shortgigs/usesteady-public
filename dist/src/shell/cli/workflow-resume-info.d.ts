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
import type { ResumeTokenV1 } from "../../workflow/resume-token-types.js";
import type { ResumeVerificationReport } from "../../workflow/resume-verifier-types.js";
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
export type ResumeInfoResult = {
    readonly success: false;
    readonly stage: "load_token";
    readonly code: string;
    readonly message: string;
    readonly path: string;
} | {
    readonly success: false;
    readonly stage: "load_spec";
    readonly code: string;
    readonly message: string;
    readonly path: string;
} | {
    readonly success: false;
    readonly stage: "validate_token";
    readonly code: string;
    readonly message: string;
} | {
    readonly success: true;
    readonly stage: "verified";
    readonly token: ResumeTokenV1;
    readonly report: ResumeVerificationReport;
} | {
    readonly success: true;
    readonly stage: "already_complete";
    readonly token: ResumeTokenV1;
};
export type ResumeInfoArgs = {
    readonly tokenPath: string;
    readonly specPath: string;
    readonly workspaceRoot: string;
};
/**
 * Run resume-info for a (token, spec, workspaceRoot) triple. Pure
 * orchestration over the I/O modules; no console output here.
 */
export declare function runResumeInfo(args: ResumeInfoArgs): ResumeInfoResult;
/**
 * Deterministic text renderer for the result of `runResumeInfo`.
 */
export declare function renderResumeInfoText(result: ResumeInfoResult): {
    lines: readonly string[];
    exitCode: number;
};
/**
 * Deterministic JSON renderer for the result of `runResumeInfo`.
 *
 * The shape is the public contract: keys are sorted by emission order
 * matching the type definition. Tests pin the exact bytes.
 */
export declare function renderResumeInfoJson(result: ResumeInfoResult): {
    json: string;
    exitCode: number;
};
//# sourceMappingURL=workflow-resume-info.d.ts.map