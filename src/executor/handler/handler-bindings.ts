/**
 * Frozen handler registry bindings (INV-HAND-8 — lookup only, no I/O).
 */

import type { ExecutionCapabilityId } from "../../remediation/types.js";

export type HandlerRegistryEntry = {
  readonly capability_handler_id: string;
  readonly capability_id: ExecutionCapabilityId;
  readonly intent_summary: string;
  readonly target_scope: readonly string[];
  readonly risk_notes: readonly string[];
};

export const HANDLER_REGISTRY_V1: readonly HandlerRegistryEntry[] = [
  {
    capability_handler_id: "handler.refresh_entitlement_cache",
    capability_id:         "CAP-001",
    intent_summary:
      "Would refresh entitlement cache via read-only issuer path (descriptive only — no mutation in v1)",
    target_scope: ["entitlement-cache"],
    risk_notes:   ["entitlement_issue", "entitlement_revoke", "cache_authority_write"],
  },
  {
    capability_handler_id: "handler.recheck_portal_domain",
    capability_id:         "CAP-002",
    intent_summary:
      "Would recheck portal domain configuration (descriptive only — no mutation in v1)",
    target_scope: ["portal-domain"],
    risk_notes:   ["dns_mutation", "portal_db_write"],
  },
  {
    capability_handler_id: "handler.validate_env_configuration",
    capability_id:         "CAP-003",
    intent_summary:
      "Would validate environment configuration (descriptive only — no mutation in v1)",
    target_scope: ["runtime-env"],
    risk_notes:   ["env_write", "secret_write"],
  },
] as const;

const HANDLER_BY_ID = new Map(
  HANDLER_REGISTRY_V1.map((entry) => [entry.capability_handler_id, entry]),
);

const HANDLERS_BY_CAPABILITY = new Map<string, HandlerRegistryEntry[]>();
for (const entry of HANDLER_REGISTRY_V1) {
  const list = HANDLERS_BY_CAPABILITY.get(entry.capability_id) ?? [];
  list.push(entry);
  HANDLERS_BY_CAPABILITY.set(entry.capability_id, list);
}

export function lookupHandlerById(
  capability_handler_id: string,
): HandlerRegistryEntry | undefined {
  return HANDLER_BY_ID.get(capability_handler_id);
}

export function lookupHandlersForCapability(
  capability_id: string,
): readonly HandlerRegistryEntry[] {
  return HANDLERS_BY_CAPABILITY.get(capability_id) ?? [];
}
