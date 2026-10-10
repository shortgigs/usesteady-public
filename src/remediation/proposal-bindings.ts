/**
 * Static observation → capability bindings (INV-GEN-12).
 */

import type { ExecutionCapabilityId, ProposalCapabilityBinding } from "./types.js";

export const CAPABILITY_REGISTRY_VERSION = "cap-registry-v1";

export const PROPOSAL_CAPABILITY_BINDINGS_V1: readonly ProposalCapabilityBinding[] = [
  {
    observation_code:  "cache_stale",
    capability_id:     "CAP-001",
    registry_version:  CAPABILITY_REGISTRY_VERSION,
  },
  {
    observation_code:  "issuer_unreachable",
    capability_id:     "CAP-001",
    registry_version:  CAPABILITY_REGISTRY_VERSION,
  },
  {
    observation_code:  "portal_domain_missing",
    capability_id:     "CAP-002",
    registry_version:  CAPABILITY_REGISTRY_VERSION,
  },
  {
    observation_code:  "checkout_redirect_mismatch",
    capability_id:     "CAP-002",
    registry_version:  CAPABILITY_REGISTRY_VERSION,
  },
  {
    observation_code:  "env_suffix_newline_corruption",
    capability_id:     "CAP-003",
    registry_version:  CAPABILITY_REGISTRY_VERSION,
  },
] as const;

const BINDING_BY_CODE: ReadonlyMap<string, ExecutionCapabilityId> = new Map(
  PROPOSAL_CAPABILITY_BINDINGS_V1.map((row) => [row.observation_code, row.capability_id]),
);

/** Exact match only — no string inference. */
export function capabilityIdForObservationCode(code: string): ExecutionCapabilityId | undefined {
  return BINDING_BY_CODE.get(code);
}
