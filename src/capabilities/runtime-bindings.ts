/**
 * Frozen runtime capability bindings (INV-RCAP-12).
 */

import type { RuntimeCapabilityBinding } from "./types.js";

export const RUNTIME_CAPABILITY_BINDINGS_V1: readonly RuntimeCapabilityBinding[] = [
  {
    capability_id:         "CAP-001",
    handler_name:          "handler.refresh_entitlement_cache",
    allowed_inputs_schema: "schema.cap001.refresh_inputs.v1",
    forbidden_side_effects: [
      "entitlement_issue",
      "entitlement_revoke",
      "cache_authority_write",
    ],
    version: "1",
  },
  {
    capability_id:         "CAP-002",
    handler_name:          "handler.recheck_portal_domain",
    allowed_inputs_schema: "schema.cap002.portal_recheck_inputs.v1",
    forbidden_side_effects: ["dns_mutation", "portal_db_write"],
    version: "1",
  },
  {
    capability_id:         "CAP-003",
    handler_name:          "handler.validate_env_configuration",
    allowed_inputs_schema: "schema.cap003.env_validate_inputs.v1",
    forbidden_side_effects: ["env_write", "secret_write"],
    version: "1",
  },
] as const;

const KNOWN_CAPABILITY_IDS = new Set(
  RUNTIME_CAPABILITY_BINDINGS_V1.map((row) => row.capability_id),
);

export function isKnownExecutionCapabilityId(
  capability_id: string,
): capability_id is RuntimeCapabilityBinding["capability_id"] {
  return KNOWN_CAPABILITY_IDS.has(capability_id as RuntimeCapabilityBinding["capability_id"]);
}
