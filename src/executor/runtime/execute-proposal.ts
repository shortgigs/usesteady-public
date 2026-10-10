/**
 * Record-only executeProposal — no handler execution (INV-ERUN-IMPL-5).
 */

import { isExecutorEligibilityExpired } from "../eligibility/expire.js";
import type { ExecutorEligibilityRecord } from "../eligibility/types.js";
import { executionId } from "./execution-id.js";
import type {
  ExecuteProposalInput,
  ExecutionLineageEntry,
  ExecutionLineageKind,
  ExecutionOutcome,
  ExecutionRecord,
} from "./types.js";
import { ExecutorRuntimeRejectedError } from "./types.js";

function reject(rejection_cause: string, explain: string): never {
  throw new ExecutorRuntimeRejectedError(rejection_cause, explain);
}

function isExecutorRecordIncomplete(record: ExecutorEligibilityRecord): boolean {
  if (record.executor_eligibility_record_id.trim().length === 0) return true;
  if (record.capability_id.trim().length === 0) return true;
  if (record.capability_eligibility_record_id.trim().length === 0) return true;
  if (record.executor_eligibility_checked_at.trim().length === 0) return true;
  if (!Number.isFinite(record.executor_eligibility_ttl_ms)) return true;
  if (record.executor_eligibility_expires_at.trim().length === 0) return true;
  if (Number.isNaN(Date.parse(record.executor_eligibility_expires_at))) return true;
  return false;
}

function terminalLineageKind(outcome: ExecutionOutcome): ExecutionLineageKind {
  switch (outcome) {
    case "completed":
      return "execution_completed";
    case "failed":
      return "execution_failed";
    case "aborted":
      return "execution_aborted";
  }
}

function buildLineage(executed_at: string, outcome: ExecutionOutcome): readonly ExecutionLineageEntry[] {
  return [
    {
      at:   executed_at,
      kind: "gate_passed",
      note: "executor eligibility allowed and unexpired",
    },
    {
      at:   executed_at,
      kind: "execution_started",
    },
    {
      at:   executed_at,
      kind: terminalLineageKind(outcome),
    },
  ];
}

function validateGate(input: ExecuteProposalInput): { now: Date; eligibility: ExecutorEligibilityRecord } {
  if (input.operator_confirmation !== true) {
    reject("operator_confirmation_required", "Operator confirmation must be explicit (literal true).");
  }

  const eligibility = input.executor_eligibility;
  const now = input.now ?? new Date();

  if (isExecutorRecordIncomplete(eligibility)) {
    reject("executor_record_incomplete", "Executor eligibility record is incomplete.");
  }

  const state = eligibility.executor_eligibility_state;
  if (state === "blocked" || state === "expired") {
    reject("executor_not_allowed", `Executor eligibility state is ${state}.`);
  }
  if (state !== "allowed") {
    reject("executor_policy_fail_closed", "Unknown executor eligibility state.");
  }

  if (isExecutorEligibilityExpired(eligibility, now)) {
    reject("executor_eligibility_expired", "Executor eligibility has expired.");
  }

  return { now, eligibility };
}

export function executeProposal(input: ExecuteProposalInput): ExecutionRecord {
  const { now, eligibility } = validateGate(input);
  const outcome = input.outcome ?? "completed";
  const executed_at = input.executed_at ?? now.toISOString();

  return {
    execution_id: executionId({
      capability_id:                  eligibility.capability_id,
      executor_eligibility_record_id: eligibility.executor_eligibility_record_id,
      outcome,
      reason:                         eligibility.reason,
      blocking_cause:                 eligibility.blocking_cause,
    }),
    executor_eligibility_record_id: eligibility.executor_eligibility_record_id,
    capability_id:                  eligibility.capability_id,
    capability_eligibility_record_id: eligibility.capability_eligibility_record_id,
    executed_at,
    executed_by:                    "operator",
    outcome,
    reason:                         eligibility.reason,
    blocking_cause:                 eligibility.blocking_cause,
    lineage:                        buildLineage(executed_at, outcome),
  };
}
