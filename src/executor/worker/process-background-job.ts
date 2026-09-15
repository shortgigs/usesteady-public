/**
 * Process BackgroundJobRecord — transport records only (INV-QWORK-0, INV-QWORK-4).
 */

import { isExecutionAuthorityExpired } from "../authority/create-execution-authority-record.js";
import type { ExecutionAuthorityRecord } from "../authority/types.js";
import { WORKER_MAX_ATTEMPTS_BY_JOB_KIND } from "./constants.js";
import type {
  ProcessBackgroundJobInput,
  ProcessBackgroundJobOutput,
  WorkerClaimState,
  WorkerJobClaim,
  WorkerResultOutcome,
  WorkerResultRecord,
  WorkerStatusRecord,
} from "./types.js";
import { runWorkerAutoWire } from "./auto-wire.js";
import { validateWorkerJob } from "./validate-worker-job.js";
import { workerClaimId } from "./worker-result-id.js";

const TERMINAL_OUTCOMES = new Set<WorkerResultOutcome>([
  "transport_completed",
  "transport_failed",
  "dead_letter",
  "awaiting_execution_authority",
  "idempotent_skip",
  "execution_chain_completed",
  "execution_chain_halted",
]);

function findTerminalResult(
  prior: readonly WorkerResultRecord[],
  idempotency_key: string,
): WorkerResultRecord | undefined {
  const matches = prior.filter(
    (r) =>
      r.idempotency_key.trim() === idempotency_key.trim() &&
      TERMINAL_OUTCOMES.has(r.outcome),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function findAuthorityForJob(
  records: readonly ExecutionAuthorityRecord[],
  job_id: string,
  idempotency_key: string,
): ExecutionAuthorityRecord | undefined {
  const matches = records.filter(
    (r) =>
      r.job_id.trim() === job_id.trim() &&
      r.idempotency_key.trim() === idempotency_key.trim(),
  );
  if (matches.length === 0) return undefined;
  return structuredClone(matches[matches.length - 1]!);
}

function outcomeToClaimState(outcome: WorkerResultOutcome): WorkerClaimState {
  switch (outcome) {
    case "transport_completed":
    case "idempotent_skip":
      return "completed";
    case "dead_letter":
      return "dead_letter";
    case "awaiting_execution_authority":
      return "awaiting_execution_authority";
    case "transport_failed":
    case "execution_chain_halted":
      return "failed";
    case "execution_chain_completed":
      return "completed";
  }
}

function buildOutput(input: {
  readonly job: ProcessBackgroundJobInput["job"];
  readonly now: Date;
  readonly attempt: number;
  readonly max_attempts: number;
  readonly outcome: WorkerResultOutcome;
  readonly note: string;
  readonly rejection_cause?: string;
  readonly explain?: string;
  readonly result?: WorkerResultRecord;
}): ProcessBackgroundJobOutput {
  const processed_at = input.now.toISOString();
  const claimed_at = processed_at;
  const outcome = input.result?.outcome ?? input.outcome;
  const claim_state = outcomeToClaimState(outcome);

  const claim: WorkerJobClaim = {
    claim_id:        workerClaimId({
      job_id:      input.job.job_id,
      attempt:     input.attempt,
      claimed_at,
    }),
    job_id:          input.job.job_id,
    idempotency_key: input.job.idempotency_key,
    claimed_at,
    claim_state,
  };

  const status: WorkerStatusRecord = {
    job_id:       input.job.job_id,
    at:           processed_at,
    status:       claim_state,
    attempt:      input.attempt,
    max_attempts: input.max_attempts,
    ...(input.rejection_cause !== undefined
      ? { rejection_cause: input.rejection_cause }
      : {}),
    ...(input.explain !== undefined ? { explain: input.explain } : {}),
  };

  const result: WorkerResultRecord =
    input.result !== undefined
      ? structuredClone(input.result)
      : {
          job_id:          input.job.job_id,
          idempotency_key: input.job.idempotency_key,
          processed_at,
          outcome,
          note:            input.note,
          lineage_ref:     structuredClone(input.job.lineage),
        };

  return { claim, status, result };
}

function resolveAuthorityOutcome(input: {
  readonly job: ProcessBackgroundJobInput["job"];
  readonly now: Date;
  readonly authority_records: readonly ExecutionAuthorityRecord[];
}):
  | {
    readonly outcome: WorkerResultOutcome;
    readonly note: string;
    readonly rejection_cause?: string;
    readonly explain?: string;
    readonly authority?: ExecutionAuthorityRecord;
  } {
  const authority = findAuthorityForJob(
    input.authority_records,
    input.job.job_id,
    input.job.idempotency_key,
  );

  if (authority === undefined) {
    return {
      outcome: "awaiting_execution_authority",
      note:    "No ExecutionAuthorityRecord for job — chain requires operator-minted authority.",
    };
  }

  if (authority.decision === "denied") {
    return {
      outcome:         "transport_failed",
      note:            `Authority denied: ${authority.denial_cause ?? "unspecified"}.`,
      rejection_cause: authority.denial_cause ?? "authority_denied",
      explain:         authority.reason,
    };
  }

  if (isExecutionAuthorityExpired(authority, input.now)) {
    return {
      outcome:         "transport_failed",
      note:            "ExecutionAuthorityRecord expired — transport cannot proceed.",
      rejection_cause: "authority_expired",
      explain:         `expired_at=${authority.expires_at}`,
    };
  }

  return {
    outcome:  "transport_completed",
    note:     "Transport step recorded under granted authority — handler invoke blocked (INV-QWORK-0).",
    authority,
  };
}

/**
 * Validate job, apply idempotency + bounded retry, consume authority read-only, emit records.
 */
export function processBackgroundJob(
  input: ProcessBackgroundJobInput,
): ProcessBackgroundJobOutput {
  const { job, now, attempt } = input;
  const max_attempts = WORKER_MAX_ATTEMPTS_BY_JOB_KIND[job.job_kind];
  const prior = input.prior_results ?? [];

  if (!Number.isInteger(attempt) || attempt < 1) {
    return buildOutput({
      job,
      now,
      attempt:         1,
      max_attempts,
      outcome:         "dead_letter",
      note:            "Invalid attempt counter.",
      rejection_cause: "attempt_invalid",
      explain:         "attempt must be a positive integer.",
    });
  }

  const replay = findTerminalResult(prior, job.idempotency_key);
  if (replay !== undefined) {
    return buildOutput({
      job,
      now,
      attempt,
      max_attempts,
      outcome: "idempotent_skip",
      note:    `Idempotent replay of prior outcome ${replay.outcome}.`,
    });
  }

  if (attempt > max_attempts) {
    return buildOutput({
      job,
      now,
      attempt,
      max_attempts,
      outcome:         "dead_letter",
      note:            `Exceeded max_attempts (${max_attempts}) — poison job.`,
      rejection_cause: "max_attempts_exceeded",
      explain:         "Bounded retry exhausted.",
    });
  }

  const validation = validateWorkerJob(job);
  if (!validation.ok) {
    const isPoison = attempt >= max_attempts;
    return buildOutput({
      job,
      now,
      attempt,
      max_attempts,
      outcome:         isPoison ? "dead_letter" : "transport_failed",
      note:            validation.explain,
      rejection_cause: validation.rejection_cause,
      explain:         validation.explain,
    });
  }

  const authorityResolution = resolveAuthorityOutcome({
    job,
    now,
    authority_records: input.authority_records,
  });

  if (
    authorityResolution.outcome === "transport_failed" &&
    attempt >= max_attempts
  ) {
    return buildOutput({
      job,
      now,
      attempt,
      max_attempts,
      outcome:         "dead_letter",
      note:            authorityResolution.note,
      rejection_cause: authorityResolution.rejection_cause ?? "transport_failed",
      ...(authorityResolution.explain !== undefined ? { explain: authorityResolution.explain } : {}),
    });
  }

  if (
    input.auto_wire !== undefined &&
    authorityResolution.outcome === "transport_completed" &&
    authorityResolution.authority !== undefined
  ) {
    const chainOut = runWorkerAutoWire({
      job:       input.job,
      authority: authorityResolution.authority,
      request:   input.auto_wire,
      now:       input.now,
      prior_chain_results: prior,
    });

    return buildOutput({
      job,
      now,
      attempt,
      max_attempts,
      outcome: chainOut.result.outcome,
      note:    chainOut.result.note,
      result:  chainOut.result,
      ...(chainOut.result.outcome === "execution_chain_halted"
        ? {
            rejection_cause:
              chainOut.result.execution_chain?.halt_cause ?? "execution_chain_halted",
            explain: chainOut.result.note,
          }
        : {}),
    });
  }

  return buildOutput({
    job,
    now,
    attempt,
    max_attempts,
    outcome:         authorityResolution.outcome,
    note:            authorityResolution.note,
    ...(authorityResolution.rejection_cause !== undefined ? { rejection_cause: authorityResolution.rejection_cause } : {}),
    ...(authorityResolution.explain !== undefined ? { explain: authorityResolution.explain } : {}),
  });
}

/**
 * Descriptive replay of prior worker result — no re-execution (INV-QWORK-7).
 */
export function replayWorkerResult(input: {
  readonly prior_results: readonly WorkerResultRecord[];
  readonly idempotency_key: string;
}): WorkerResultRecord | undefined {
  return findTerminalResult(input.prior_results, input.idempotency_key);
}
