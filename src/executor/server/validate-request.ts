/**
 * Transport validation before runExecutorPipeline() (INV-SROUTE-3).
 */

import type { BackgroundJobKind } from "../jobs/types.js";
import type { ExecutionLedgerActor } from "../ledger/types.js";
import type { ExecutorEligibilityRecord, ExecutorEligibilityState } from "../eligibility/types.js";
import type { RunExecutorPipelineInput } from "../wire-up/types.js";
import { ExecutorRouteRejectedError } from "./types.js";
import type { ExecutorApplyFixRequestBody } from "./types.js";

const ALLOWED_JOB_KINDS: readonly BackgroundJobKind[] = [
  "replay_notify",
  "retry_transport",
];

const ELIGIBILITY_STATES: readonly ExecutorEligibilityState[] = [
  "allowed",
  "blocked",
  "expired",
];

function reject(rejection_cause: string, explain: string): never {
  throw new ExecutorRouteRejectedError(rejection_cause, explain);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  cause: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    reject(cause, `${key} must be a non-empty string.`);
  }
  return value.trim();
}

function requireStringValue(
  record: Record<string, unknown>,
  key: string,
  cause: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    reject(cause, `${key} must be a string.`);
  }
  return value;
}

function parseEligibility(value: unknown): ExecutorEligibilityRecord {
  if (!isRecord(value)) {
    reject("eligibility_invalid", "eligibility must be an object.");
  }

  const capability_id = requireString(value, "capability_id", "eligibility_invalid");
  const capability_eligibility_record_id = requireString(
    value,
    "capability_eligibility_record_id",
    "eligibility_invalid",
  );
  const executor_eligibility_record_id = requireString(
    value,
    "executor_eligibility_record_id",
    "eligibility_invalid",
  );
  const executor_eligibility_checked_at = requireString(
    value,
    "executor_eligibility_checked_at",
    "eligibility_invalid",
  );
  const executor_eligibility_expires_at = requireString(
    value,
    "executor_eligibility_expires_at",
    "eligibility_invalid",
  );
  const reason = requireString(value, "reason", "eligibility_invalid");
  const blocking_cause = requireStringValue(value, "blocking_cause", "eligibility_invalid");

  const stateRaw = value["executor_eligibility_state"];
  if (typeof stateRaw !== "string" || !ELIGIBILITY_STATES.includes(stateRaw as ExecutorEligibilityState)) {
    reject("eligibility_invalid", "executor_eligibility_state is invalid.");
  }
  const executor_eligibility_state = stateRaw as ExecutorEligibilityState;

  const ttlRaw = value["executor_eligibility_ttl_ms"];
  if (typeof ttlRaw !== "number" || !Number.isFinite(ttlRaw)) {
    reject("eligibility_invalid", "executor_eligibility_ttl_ms must be a finite number.");
  }

  if (Number.isNaN(Date.parse(executor_eligibility_checked_at))) {
    reject("eligibility_invalid", "executor_eligibility_checked_at must be a valid ISO timestamp.");
  }
  if (Number.isNaN(Date.parse(executor_eligibility_expires_at))) {
    reject("eligibility_invalid", "executor_eligibility_expires_at must be a valid ISO timestamp.");
  }

  const lineageRaw = value["lineage"];
  if (!Array.isArray(lineageRaw)) {
    reject("eligibility_invalid", "lineage must be an array.");
  }

  const lineage = lineageRaw.map((entry, index) => {
    if (!isRecord(entry)) {
      reject("eligibility_invalid", `lineage[${index}] must be an object.`);
    }
    return {
      at:                    requireString(entry, "at", "eligibility_invalid"),
      kind:                  requireString(entry, "kind", "eligibility_invalid") as ExecutorEligibilityRecord["lineage"][number]["kind"],
      executor_eligibility_state: (
        typeof entry["executor_eligibility_state"] === "string"
          ? entry["executor_eligibility_state"]
          : executor_eligibility_state
      ) as ExecutorEligibilityState,
      reason:                requireString(entry, "reason", "eligibility_invalid"),
      blocking_cause:        requireStringValue(entry, "blocking_cause", "eligibility_invalid"),
    };
  });

  return {
    capability_id,
    capability_eligibility_record_id,
    executor_eligibility_state,
    executor_eligibility_checked_at,
    executor_eligibility_ttl_ms: ttlRaw,
    executor_eligibility_expires_at,
    executor_eligibility_record_id,
    lineage,
    reason,
    blocking_cause,
  };
}

function parseLedgerActor(value: unknown): ExecutionLedgerActor {
  if (!isRecord(value)) {
    reject("ledger_actor_invalid", "ledger_actor must be an object.");
  }
  if (value["kind"] !== "operator") {
    reject("ledger_actor_invalid", "ledger_actor.kind must be operator.");
  }
  const actor_id = requireString(value, "actor_id", "ledger_actor_invalid");
  return { kind: "operator", actor_id };
}

/**
 * Validate HTTP JSON body into pipeline input. `now` is server-side only (INV-SROUTE-4).
 */
export function validateExecutorApplyFixRequest(
  body: unknown,
  now: Date = new Date(),
): RunExecutorPipelineInput {
  if (!isRecord(body)) {
    reject("request_body_invalid", "Request body must be a JSON object.");
  }

  if (body["operator_confirmation"] !== true) {
    reject(
      "operator_confirmation_required",
      "operator_confirmation must be literal true.",
    );
  }

  const executed_at = requireString(body, "executed_at", "executed_at_invalid");
  if (Number.isNaN(Date.parse(executed_at))) {
    reject("executed_at_invalid", "executed_at must be a valid ISO timestamp.");
  }

  const store_dir = requireString(body, "store_dir", "store_dir_invalid");
  const capability_handler_id = requireString(
    body,
    "capability_handler_id",
    "capability_handler_id_invalid",
  );

  const job_kindRaw = body["job_kind"];
  if (typeof job_kindRaw !== "string" || !ALLOWED_JOB_KINDS.includes(job_kindRaw as BackgroundJobKind)) {
    reject("job_kind_invalid", "job_kind is not allowed.");
  }
  const job_kind = job_kindRaw as BackgroundJobKind;

  const eligibility = parseEligibility(body["eligibility"]);
  const ledger_actor = parseLedgerActor(body["ledger_actor"]);

  const _typed: ExecutorApplyFixRequestBody = {
    eligibility,
    operator_confirmation: true,
    capability_handler_id,
    ledger_actor,
    store_dir,
    job_kind,
    executed_at,
  };

  return {
    eligibility,
    operator_confirmation: true,
    capability_handler_id,
    ledger_actor,
    store_dir,
    job_kind,
    executed_at,
    now,
  };
}
