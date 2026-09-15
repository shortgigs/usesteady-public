/**
 * Pure executor eligibility evaluator (metadata only — no execution).
 */

import { isCapabilityEligibilityExpired } from "../../capabilities/eligibility/expire.js";
import type { CapabilityEligibilityRecord } from "../../capabilities/eligibility/types.js";
import { EXECUTOR_ELIGIBILITY_TTL_MS } from "./constants.js";
import { executorEligibilityRecordId } from "./record-id.js";
import type {
  ExecutorEligibilityInput,
  ExecutorEligibilityLineageEntry,
  ExecutorEligibilityRecord,
  ExecutorEligibilityState,
} from "./types.js";

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function isCapabilityRecordIncomplete(
  record: CapabilityEligibilityRecord,
): boolean {
  if (record.eligibility_record_id.trim().length === 0) return true;
  if (record.capability_eligibility_expires_at.trim().length === 0) return true;
  if (Number.isNaN(Date.parse(record.capability_eligibility_expires_at))) return true;
  if (!Number.isFinite(record.capability_eligibility_ttl_ms)) return true;
  return false;
}

type ExecutorDecision = {
  readonly executor_eligibility_state: ExecutorEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

function decideExecutorEligibility(
  capability: CapabilityEligibilityRecord,
  now: Date,
): ExecutorDecision {
  if (isCapabilityRecordIncomplete(capability)) {
    return {
      executor_eligibility_state: "blocked",
      reason:                   "Capability eligibility record is incomplete.",
      blocking_cause:           "capability_record_incomplete",
    };
  }

  if (capability.eligibility_state === "blocked") {
    return {
      executor_eligibility_state: "blocked",
      reason:                   "Capability eligibility is blocked.",
      blocking_cause:           "capability_eligibility_blocked",
    };
  }

  if (capability.eligibility_state === "expired") {
    return {
      executor_eligibility_state: "blocked",
      reason:                   "Capability eligibility has expired.",
      blocking_cause:           "capability_eligibility_expired",
    };
  }

  if (isCapabilityEligibilityExpired(capability, now)) {
    return {
      executor_eligibility_state: "blocked",
      reason:                   "Capability eligibility TTL has lapsed.",
      blocking_cause:           "capability_eligibility_expired",
    };
  }

  if (capability.eligibility_state !== "allowed") {
    return {
      executor_eligibility_state: "blocked",
      reason:                   "Capability eligibility state is not allowed.",
      blocking_cause:           "executor_policy_fail_closed",
    };
  }

  return {
    executor_eligibility_state: "allowed",
    reason:                   "Capability eligibility allowed; executor gate valid until TTL expires.",
    blocking_cause:           "",
  };
}

function buildRecord(input: {
  readonly capability_eligibility: CapabilityEligibilityRecord;
  readonly decision: ExecutorDecision;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): ExecutorEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: ExecutorEligibilityLineageEntry[] = [
    {
      at:                          input.checked_at,
      kind:                        "evaluated",
      executor_eligibility_state:  input.decision.executor_eligibility_state,
      reason:                        input.decision.reason,
      blocking_cause:              input.decision.blocking_cause,
    },
  ];

  return {
    capability_id:                      input.capability_eligibility.capability_id,
    capability_eligibility_record_id:     input.capability_eligibility.eligibility_record_id,
    executor_eligibility_state:         input.decision.executor_eligibility_state,
    executor_eligibility_checked_at:    input.checked_at,
    executor_eligibility_ttl_ms:        input.ttl_ms,
    executor_eligibility_expires_at:    expires_at,
    executor_eligibility_record_id:     executorEligibilityRecordId({
      capability_id:              String(input.capability_eligibility.capability_id),
      executor_eligibility_state: input.decision.executor_eligibility_state,
      reason:                       input.decision.reason,
      blocking_cause:               input.decision.blocking_cause,
    }),
    lineage,
    reason:         input.decision.reason,
    blocking_cause: input.decision.blocking_cause,
  };
}

/**
 * Pure evaluator — capability eligibility record only; no I/O or handler execution.
 */
export function evaluateExecutorEligibility(
  input: ExecutorEligibilityInput,
): ExecutorEligibilityRecord {
  const ttl_ms = input.ttl_ms ?? EXECUTOR_ELIGIBILITY_TTL_MS;
  const checked_at = input.checked_at;
  const now = input.now ?? new Date(checked_at);

  const decision = decideExecutorEligibility(input.capability_eligibility, now);

  return buildRecord({
    capability_eligibility: input.capability_eligibility,
    decision,
    checked_at,
    ttl_ms,
  });
}

/** Stable outcome fingerprint (excludes timestamps and lineage). */
export function executorEligibilityOutcomeFingerprint(
  record: ExecutorEligibilityRecord,
): string {
  return JSON.stringify({
    capability_id:                  record.capability_id,
    capability_eligibility_record_id: record.capability_eligibility_record_id,
    executor_eligibility_state:     record.executor_eligibility_state,
    reason:                           record.reason,
    blocking_cause:                   record.blocking_cause,
    executor_eligibility_record_id:   record.executor_eligibility_record_id,
    executor_eligibility_ttl_ms:      record.executor_eligibility_ttl_ms,
  });
}
