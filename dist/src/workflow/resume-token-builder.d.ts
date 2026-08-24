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
import { type ResumeTokenV1 } from "./resume-token-types.js";
export type BuildResumeTokenArgs = {
    readonly spec: WorkflowSpec;
    readonly workflowRunId: string;
    readonly specPath: string;
    readonly workspaceRoot: string;
    readonly completedTaskCount: number;
    /**
     * Provenance string. Convention: `"usesteady-cli@<package.json version>"`.
     * Free-form; not used for matching.
     */
    readonly issuedBy: string;
    /**
     * ISO 8601 timestamp. Caller passes `new Date().toISOString()`.
     * Held as a parameter (not synthesized) so tests can pin output.
     */
    readonly issuedAt: string;
    /**
     * Optional explicit token id; when omitted, derived deterministically
     * from the token content via `computeTokenId`. Tests use the explicit
     * form to assert byte-stability; production uses the derived form.
     */
    readonly tokenId?: string;
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
export declare function buildResumeToken(args: BuildResumeTokenArgs): ResumeTokenV1;
//# sourceMappingURL=resume-token-builder.d.ts.map