/**
 * Pending Approval Bridge (PENDING_APPROVAL_BRIDGE_LANE_A_V1) - run -> input mapper.
 *
 * Pure, read-only projection of a WorkflowRun at a pre-execution approval gate into
 * the normalized `PendingApprovalInput` the builder consumes. No network, no
 * filesystem, no clock (the gate-open timestamp is injected), no env reads.
 *
 * Source of truth (INV-LA-EMIT1 / privacy INV-PAB-P2): the same structured
 * `WorkflowTaskSpec` fields the executor consumes and the local SYSTEM WILL preview
 * renders from - `operationType`, `targetFiles`, `newPath`, `structuredReplace`,
 * plus `run.display.headline`. This guarantees the Portal gate cannot drift from
 * what the local operator would see. There is deliberately NO path here for file
 * contents or diffs to reach the wire - only a summary line, resource PATHS +
 * change-types, and a Core-assigned risk band.
 *
 * The risk band and action_type are deterministic, monotone maps of the structured
 * operation type - fixed strings, never derived from or paraphrasing user input.
 */
import type { WorkflowRun } from "../../workflow/types.js";
import type { PendingApprovalInput } from "./payload.js";
/**
 * Project the run's CURRENT gate into a PendingApprovalInput. Returns null when the
 * run has no current task spec (defensive: the caller then falls back to the local
 * approval flow rather than emitting a malformed gate). `requestedAt` is the
 * injected Core-clock gate-open timestamp (ISO-8601; ordering authority INV-PAB-I4).
 */
export declare function pendingApprovalInputFromRun(run: WorkflowRun, requestedAt: string): PendingApprovalInput | null;
//# sourceMappingURL=from-run.d.ts.map