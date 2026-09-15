/**
 * Capability eligibility types (metadata only — no execution).
 * @see docs/product/capability-eligibility-runtime-contract-v1.md
 * @see docs/product/capability-eligibility-implementation-contract-v1.md
 */

import type { ExecutionCapabilityId } from "../../remediation/types.js";
import type { ResolutionBlocked, RuntimeCapabilityResolution } from "../types.js";

export type CapabilityEligibilityState = "allowed" | "blocked" | "expired";

export type CapabilityEligibilityLineageEntry = {
  readonly at: string;
  readonly kind: "evaluated" | "revalidated" | "expired";
  readonly eligibility_state: CapabilityEligibilityState;
  readonly reason: string;
};

export type CapabilityEligibilityRecord = {
  readonly capability_id: ExecutionCapabilityId | string;
  readonly eligibility_state: CapabilityEligibilityState;
  readonly capability_eligibility_checked_at: string;
  readonly capability_eligibility_ttl_ms: number;
  readonly capability_eligibility_expires_at: string;
  readonly eligibility_record_id: string;
  readonly lineage: readonly CapabilityEligibilityLineageEntry[];
  readonly reason: string;
};

export type CapabilityEligibilityInput = {
  readonly resolution: RuntimeCapabilityResolution | ResolutionBlocked;
  readonly checked_at: string;
  readonly ttl_ms?: number;
};
