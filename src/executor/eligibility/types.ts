/**
 * Executor eligibility types (metadata only — no execution).
 * @see docs/product/executor-eligibility-contract-v1.md
 * @see docs/product/executor-eligibility-implementation-contract-v1.md
 */

import type { CapabilityEligibilityRecord } from "../../capabilities/eligibility/types.js";

export type ExecutorEligibilityState = "allowed" | "blocked" | "expired";

export type ExecutorEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated" | "revalidated" | "expired" | "blocked";
  readonly executor_eligibility_state: ExecutorEligibilityState;
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ExecutorEligibilityRecord = {
  readonly capability_id: string;
  readonly capability_eligibility_record_id: string;
  readonly executor_eligibility_state: ExecutorEligibilityState;
  readonly executor_eligibility_checked_at: string;
  readonly executor_eligibility_ttl_ms: number;
  readonly executor_eligibility_expires_at: string;
  readonly executor_eligibility_record_id: string;
  readonly lineage: readonly ExecutorEligibilityLineageEntry[];
  readonly reason: string;
  readonly blocking_cause: string;
};

export type ExecutorEligibilityInput = {
  readonly capability_eligibility: CapabilityEligibilityRecord;
  readonly checked_at: string;
  readonly ttl_ms?: number;
  readonly now?: Date;
};
