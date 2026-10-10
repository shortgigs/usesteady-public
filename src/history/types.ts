/**
 * Phase 10B: History / Audit read-model types.
 *
 * ── Two-tier model (D1) ──────────────────────────────────────────────────────
 *
 *   Tier 1 — WorkflowHistorySummary
 *     Cheap. Reads only from ucp.workflow_run.v1 envelopes.
 *     No per-task chain resolution.
 *     Consumer: list views, CLI history command.
 *
 *   Tier 2 — WorkflowAuditRecord
 *     Expensive. Resolves session chains per task via byRoot index.
 *     Consumer: operator drill-down, incident investigation.
 *
 * ── SessionChain vs RunTimeline (D2) ─────────────────────────────────────────
 *
 *   SessionChain covers Phase 8/9 sessions: handoff → receipt | refused.
 *   RunTimeline  covers Phase 3/6 runs:     artifact → trace + replay.
 *   These are NOT merged. They are structurally incompatible chains.
 *
 * ── Live state excluded (D4) ─────────────────────────────────────────────────
 *
 *   No type in this module accepts a live WorkflowRun, WorkflowTask[],
 *   CursorSessionState, or ClaudeSessionState. All history reads from storeDir.
 *
 * ── Authority ─────────────────────────────────────────────────────────────────
 *
 *   Zero. This module imports types only — no coordinator, no sessions,
 *   no execution layer. It is a pure read-only projection of the UCP store.
 */

import type {
  UCPEnvelope,
  CursorHandoffPayload,
  CursorReceiptPayload,
  CursorRefusedPayload,
  ClaudeHandoffPayload,
  ClaudeReceiptPayload,
  ClaudeRefusedPayload,
  IntentPayload,
} from "../ucp/types.js";

// ─── Shared ───────────────────────────────────────────────────────────────────

/**
 * WorkflowTaskOutcome — the set of outcomes a task can have.
 * Mirrors WorkflowTaskOutcome from workflow/types.ts.
 * Defined here so the history layer has no coordinator dependency.
 */
export type HistoryTaskOutcome =
  | "accepted"
  | "skipped"
  | "skipped_by_intake"
  | "planning_reviewed"
  | "stopped"
  | "rejected"
  | "pending";

// ─── Tier 1: WorkflowHistorySummary ──────────────────────────────────────────

/**
 * A single task entry in the shallow history tier.
 *
 * input is populated from WorkflowRunPayload.taskInputs[taskIndex].
 * It is null only for records written before Phase 10B (V1.0 records without
 * the taskInputs field), where taskInputs is treated as [].
 */
export type WorkflowTaskHistoryEntry = {
  readonly taskIndex:  number;
  readonly outcome:    HistoryTaskOutcome;
  readonly retryCount: number;
  readonly input:      string | null;
};

/**
 * Shallow summary of a completed or stopped workflow run.
 *
 * Built entirely from one ucp.workflow_run.v1 envelope.
 * No per-task session-chain resolution.
 */
export type WorkflowHistorySummary = {
  /** id of the ucp.workflow_run.v1 envelope — stable cross-session lookup key */
  readonly envelopeId:    string;
  readonly workflowRunId: string;
  /** Execution-instance key. Equals workflowRunId on legacy envelopes. */
  readonly executionInstanceId: string;
  readonly workflowName:  string;
  /** Epoch ms — wall-clock time when the run was persisted */
  readonly ts:            number;
  readonly finalOutcome:  "completed" | "stopped";
  readonly taskCount:     number;
  readonly acceptedCount: number;
  readonly skippedCount:  number;
  /**
   * Per-task entries. Includes only tasks present in sessionRefs
   * (i.e., tasks that ran — outcome !== "pending").
   */
  readonly tasks: readonly WorkflowTaskHistoryEntry[];
};

// ─── Tier 2: SessionChain + WorkflowAuditRecord ───────────────────────────────

/**
 * SessionChain — the Phase 8/9 delivery envelope chain for a single task session.
 *
 * NOT the same as RunTimeline (which covers artifact/trace/replay for Phase 3/6).
 * Both are built from getChain(storeDir, intentId) navigation over byRoot,
 * but they classify into completely different envelope types.
 *
 * runtime detection:
 *   cursorHandoff !== null → "cursor"
 *   claudeHandoff !== null → "claude"
 *   neither                → "unknown"  (e.g., partial/corrupt record)
 */
export type SessionChain = {
  readonly runtime:       "cursor" | "claude" | "unknown";
  readonly intentId:      string | null;
  readonly responseId:    string | null;
  readonly intent:        UCPEnvelope<IntentPayload>      | null;
  /** Cursor delivery path */
  readonly cursorHandoff: UCPEnvelope<CursorHandoffPayload> | null;
  readonly cursorReceipt: UCPEnvelope<CursorReceiptPayload> | null;
  readonly cursorRefused: UCPEnvelope<CursorRefusedPayload> | null;
  /** Claude delivery path */
  readonly claudeHandoff: UCPEnvelope<ClaudeHandoffPayload> | null;
  readonly claudeReceipt: UCPEnvelope<ClaudeReceiptPayload> | null;
  readonly claudeRefused: UCPEnvelope<ClaudeRefusedPayload> | null;
};

/**
 * A single task entry in the deep audit tier.
 *
 * session is null when no intentId is recorded for this task
 * (e.g., skipped_by_intake, or a stopped task that never opened a session).
 */
export type WorkflowTaskAuditEntry = {
  readonly taskIndex:  number;
  readonly input:      string | null;
  readonly outcome:    HistoryTaskOutcome;
  readonly retryCount: number;
  readonly session:    SessionChain | null;
};

/**
 * Full audit record for one completed or stopped workflow run.
 *
 * Resolves per-task session chains via getChain(storeDir, intentId).
 * Cost: O(tasks × chain depth). Not suitable for list views.
 */
export type WorkflowAuditRecord = {
  readonly envelopeId:    string;
  readonly workflowRunId: string;
  readonly executionInstanceId: string;
  readonly workflowName:  string;
  readonly ts:            number;
  readonly finalOutcome:  "completed" | "stopped";
  readonly taskCount:     number;
  readonly acceptedCount: number;
  readonly skippedCount:  number;
  readonly tasks:         readonly WorkflowTaskAuditEntry[];
};
