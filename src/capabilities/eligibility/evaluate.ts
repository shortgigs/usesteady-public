/**
 * Pure capability eligibility evaluator (metadata only).
 */

import { isKnownExecutionCapabilityId } from "../runtime-bindings.js";
import type { ResolutionBlocked, RuntimeCapabilityResolution } from "../types.js";
import { CAPABILITY_ELIGIBILITY_TTL_MS } from "./constants.js";
import { eligibilityRecordId } from "./record-id.js";
import type {
  CapabilityEligibilityInput,
  CapabilityEligibilityLineageEntry,
  CapabilityEligibilityRecord,
  CapabilityEligibilityState,
} from "./types.js";

function isResolutionBlocked(
  resolution: RuntimeCapabilityResolution | ResolutionBlocked,
): resolution is ResolutionBlocked {
  return "outcome" in resolution && resolution.outcome === "blocked";
}

function addMsToIso(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

function buildRecord(input: {
  readonly capability_id: string;
  readonly version: string;
  readonly eligibility_state: CapabilityEligibilityState;
  readonly reason: string;
  readonly checked_at: string;
  readonly ttl_ms: number;
}): CapabilityEligibilityRecord {
  const expires_at = addMsToIso(input.checked_at, input.ttl_ms);
  const lineage: CapabilityEligibilityLineageEntry[] = [
    {
      at:                input.checked_at,
      kind:              "evaluated",
      eligibility_state: input.eligibility_state,
      reason:            input.reason,
    },
  ];

  return {
    capability_id:                      input.capability_id,
    eligibility_state:                  input.eligibility_state,
    capability_eligibility_checked_at:  input.checked_at,
    capability_eligibility_ttl_ms:      input.ttl_ms,
    capability_eligibility_expires_at:  expires_at,
    eligibility_record_id:              eligibilityRecordId({
      capability_id:     input.capability_id,
      version:           input.version,
      eligibility_state: input.eligibility_state,
      reason:            input.reason,
    }),
    lineage,
    reason: input.reason,
  };
}

function evaluateBlockedResolution(blocked: ResolutionBlocked): {
  readonly capability_id: string;
  readonly version: string;
  readonly reason: string;
} {
  const reason =
    blocked.reason_code === "unknown_capability"
      ? "unknown_capability"
      : "resolution_blocked";

  return {
    capability_id: blocked.capability_id,
    version:       "",
    reason,
  };
}

function evaluateResolved(resolution: RuntimeCapabilityResolution): {
  readonly capability_id: string;
  readonly version: string;
  readonly eligibility_state: CapabilityEligibilityState;
  readonly reason: string;
} {
  if (!isKnownExecutionCapabilityId(resolution.capability_id)) {
    return {
      capability_id:     resolution.capability_id,
      version:           resolution.version,
      eligibility_state: "blocked",
      reason:            "unknown_capability",
    };
  }

  if (
    resolution.handler_name.trim().length === 0
    || resolution.forbidden_side_effects.length === 0
  ) {
    return {
      capability_id:     resolution.capability_id,
      version:           resolution.version,
      eligibility_state: "blocked",
      reason:            "binding_incomplete",
    };
  }

  return {
    capability_id:     resolution.capability_id,
    version:           resolution.version,
    eligibility_state: "allowed",
    reason:            "capability_eligible",
  };
}

/**
 * Pure evaluator — resolution metadata only; no I/O or handler execution.
 */
export function evaluateCapabilityEligibility(
  input: CapabilityEligibilityInput,
): CapabilityEligibilityRecord {
  const ttl_ms = input.ttl_ms ?? CAPABILITY_ELIGIBILITY_TTL_MS;
  const checked_at = input.checked_at;

  if (isResolutionBlocked(input.resolution)) {
    const blocked = evaluateBlockedResolution(input.resolution);
    return buildRecord({
      ...blocked,
      eligibility_state: "blocked",
      checked_at,
      ttl_ms,
    });
  }

  const decision = evaluateResolved(input.resolution);
  return buildRecord({
    capability_id:     decision.capability_id,
    version:           decision.version,
    eligibility_state: decision.eligibility_state,
    reason:            decision.reason,
    checked_at,
    ttl_ms,
  });
}

/** Stable outcome fingerprint (excludes timestamps and lineage). */
export function eligibilityOutcomeFingerprint(
  record: CapabilityEligibilityRecord,
): string {
  return JSON.stringify({
    capability_id:     record.capability_id,
    eligibility_state: record.eligibility_state,
    reason:            record.reason,
    eligibility_record_id: record.eligibility_record_id,
    capability_eligibility_ttl_ms: record.capability_eligibility_ttl_ms,
  });
}
