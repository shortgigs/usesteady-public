/**
 * Execution Return Bridge (EXECUTION_RETURN_BRIDGE_V1) - run -> input mapping.
 *
 * Turns a finished Core run (its execution.db session + persisted UCP chain) into
 * the camel-case `ExecutionReturnInput` consumed by buildExecutionReturnPayload.
 *
 * Shape of this slice (P0-49 Step 2a):
 *   - `summarizeDecisions` and `stepsToAffectedResources` are PURE (no I/O).
 *     Feature 2.2: step status is a pre-execution human decision, not execution.
 *   - `mapRunToExecutionReturnInput` is the thin, READ-ONLY orchestrator: it
 *     reads (never writes) execution.db via getSessionSteps and the UCP chain via
 *     getChain. It performs no network call and does not touch the run.
 *
 * Caller-supplied metadata (`RunReturnMetadata`) carries the facts execution.db
 * does not hold: the Core-generated run_id, the UCP linkage, outcome + clock,
 * approval record, break-glass flag, resume-token presence, and an optional
 * redaction policy (applied on the machine before the resources are returned -
 * INV-ERB-P3).
 */
import type { ExecutionStep } from "../../types/execution.js";
import type { ExecutionReturnInput } from "./build-payload.js";
import { type RedactionPolicy } from "./redact.js";
import type { ApprovalMode, ExecutionOutcome, ExecutionReturnAffectedResource, ExecutionReturnDecisionSummary, ExecutionReturnReplayRef, ExecutionReturnResumeTokenMeta } from "./types.js";
/** Minimal step shape the pure helpers depend on (decoupled from full ExecutionStep). */
export type DecisionStep = Pick<ExecutionStep, "status" | "file_path" | "action_type">;
/**
 * Counts-only decision summary from execution.db step statuses.
 * Those statuses are pre-execution human decision records:
 *   approved  = explicit human approval
 *   rejected  = explicit human rejection
 *   executed  = always 0 / not_established (unknown-by-this-field, not
 *               proof of non-execution — this review layer has not run files)
 *   skipped   = 0 / not_available (pending is not a human skip)
 */
export declare function summarizeDecisions(steps: readonly DecisionStep[], breakGlass: boolean): ExecutionReturnDecisionSummary;
/**
 * execution.db is a pre-execution review layer. Approved steps have not run,
 * so they must not become affected_resources. Always empty.
 */
export declare function stepsToAffectedResources(_steps: readonly DecisionStep[]): ExecutionReturnAffectedResource[];
export type RunReturnMetadata = {
    /** Core-generated idempotency anchor (INV-ERB-I1). */
    readonly runId: string;
    readonly ucpRootId: string;
    readonly ucpBundleHash?: string | null;
    readonly workflowName?: string | null;
    readonly outcome: ExecutionOutcome;
    /** ISO-8601, Core clock - ordering authority (INV-ERB-I3). */
    readonly executedAt: string;
    readonly approval: {
        readonly mode: ApprovalMode;
        readonly approver: string | null;
        readonly approvedAt: string | null;
        /** P1 authority carry (optional): evidence status + preserved assertion. */
        readonly authorityStatus?: "portal_signed_verified" | "self_asserted";
        readonly authorityAssertion?: unknown;
    };
    readonly breakGlass?: boolean;
    readonly resumeTokenMeta?: ExecutionReturnResumeTokenMeta;
    /** Optional on-machine redaction applied before resources leave (INV-ERB-P3). */
    readonly redaction?: RedactionPolicy;
    /** Optional (P0-55) kernel-replay reference; omitted from the wire when null. */
    readonly replayRef?: ExecutionReturnReplayRef | null;
};
/**
 * Read-only mapping from a finished run to ExecutionReturnInput.
 * Reads execution.db (steps) and the UCP chain (chain count). No writes, no
 * network. The returned input is ready for buildExecutionReturnPayload.
 */
export declare function mapRunToExecutionReturnInput(storeDir: string, sessionId: string, meta: RunReturnMetadata): ExecutionReturnInput;
//# sourceMappingURL=map-run.d.ts.map