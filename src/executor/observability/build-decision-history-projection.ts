/**
 * Derive DecisionHistoryProjection from WorkerResultRecord chain (lineage order only).
 * @see docs/product/executor-execution-decision-history-surface-contract-v1.md
 */

import type { WorkerResultRecord } from "../worker/types.js";
import type { DecisionHistoryEntry, DecisionHistoryProjection } from "./types.js";
import { ObservabilityRejectedError } from "./types.js";

const STAGE_ORDER: readonly DecisionHistoryEntry["stage"][] = [
  "authority_granted",
  "handler_invoked",
  "command_authorized",
  "mutation_applied",
  "halted",
];

function sortEntries(entries: DecisionHistoryEntry[]): DecisionHistoryEntry[] {
  return [...entries].sort((a, b) => {
    const ai = STAGE_ORDER.indexOf(a.stage);
    const bi = STAGE_ORDER.indexOf(b.stage);
    if (ai !== bi) return ai - bi;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

function shortRequestId(job_id: string): string {
  const tail = job_id.replace(/^job-/, "").slice(-4);
  return tail.length > 0 ? tail : job_id.slice(0, 8);
}

export function buildDecisionHistoryProjection(input: {
  readonly worker_result: WorkerResultRecord;
  readonly now?: Date;
}): DecisionHistoryProjection {
  const now = input.now ?? new Date();
  const result = input.worker_result;
  const chain = result.execution_chain;

  if (chain === undefined) {
    if (
      result.outcome === "execution_chain_completed" ||
      result.outcome === "execution_chain_halted"
    ) {
      throw new ObservabilityRejectedError(
        "chain_evidence_missing",
        "Worker result claims chain outcome but execution_chain evidence is absent.",
      );
    }
    return {
      history_id:     `history-${result.job_id.slice(0, 12)}-${now.getTime()}`,
      job_id:         result.job_id,
      execution_id:   result.job_id,
      request_label:  `Request #${shortRequestId(result.job_id)}`,
      entries:        [],
      recorded_at:    now.toISOString(),
    };
  }

  const actor =
    chain.command?.actor_id ??
    chain.mutation?.actor_id ??
    "unknown";

  const entries: DecisionHistoryEntry[] = [
    {
      stage:               "authority_granted",
      decision:            "granted",
      actor_id:            actor,
      authority_reference: "operator_gate",
      reason:              `Authority record ${chain.authority_record_id} consumed by operator gate.`,
      timestamp:           chain.invocation?.invoked_at ?? result.processed_at,
      lineage_reference:   `authority:${chain.authority_record_id}`,
      replay_reference:    chain.chain_idempotency_key,
    },
  ];

  if (chain.invocation !== undefined) {
    entries.push({
      stage:             "handler_invoked",
      decision:          chain.invocation.decision,
      actor_id:          actor,
      authority_reference: "operator_gate",
      ...((chain.handler_result !== undefined
          ? chain.handler_result.result_summary
          : chain.invocation.denial_cause) !== undefined ? { reason: chain.handler_result !== undefined
          ? chain.handler_result.result_summary
          : chain.invocation.denial_cause } : {}),
      timestamp:         chain.invocation.invoked_at,
      lineage_reference: `invocation:${chain.invocation.invocation_record_id}`,
      replay_reference:  chain.invocation.invocation_idempotency_key,
    });
  }

  if (chain.command !== undefined) {
    entries.push({
      stage:               "command_authorized",
      decision:            chain.command.decision,
      actor_id:            chain.command.actor_id,
      authority_reference: "operator_gate",
      reason:              chain.command.reason,
      timestamp:           chain.command.decided_at,
      lineage_reference:   `command:${chain.command.command_record_id}`,
      replay_reference:    chain.command.command_idempotency_key,
    });
  }

  if (chain.mutation !== undefined) {
    entries.push({
      stage:               "mutation_applied",
      decision:            chain.mutation.decision,
      actor_id:            chain.mutation.actor_id,
      authority_reference: "operator_gate",
      reason:              chain.mutation.reason,
      timestamp:           chain.mutation.applied_at,
      lineage_reference:   `mutation:${chain.mutation.mutation_record_id}`,
      replay_reference:    chain.mutation.mutation_idempotency_key,
    });
  }

  if (chain.halt_cause !== undefined && chain.terminal_stage === "halted") {
    entries.push({
      stage:               "halted",
      decision:            "halted",
      actor_id:            actor,
      authority_reference: "operator_gate",
      reason:              chain.halt_cause,
      timestamp:           result.processed_at,
      lineage_reference:   `halt:${chain.chain_idempotency_key}`,
    });
  }

  return {
    history_id:     `history-${result.job_id.slice(0, 12)}-${now.getTime()}`,
    job_id:         result.job_id,
    execution_id:   result.job_id,
    request_label:  `Request #${shortRequestId(result.job_id)}`,
    entries:        sortEntries(entries),
    recorded_at:    now.toISOString(),
  };
}
