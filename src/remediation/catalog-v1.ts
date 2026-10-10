/**
 * Frozen execution capability catalog snapshot (#416).
 */

import type { ExecutionCapability } from "./types.js";

export const EXECUTION_CAPABILITY_CATALOG_V1: readonly ExecutionCapability[] = [
  {
    capability_id: "CAP-001",
    slug:          "refresh_entitlement_cache",
    title:         "Refresh entitlement cache (read-only issuer path)",
    description:
      "Bounds execution to read-only issuer fetch and cache refresh — does not issue or revoke entitlement",
    action_class:  "entitlement",
  },
  {
    capability_id: "CAP-002",
    slug:          "recheck_portal_domain",
    title:         "Recheck portal domain configuration",
    description:   "Bounds execution to read-only portal/DNS observation re-run",
    action_class:  "portal",
  },
  {
    capability_id: "CAP-003",
    slug:          "validate_env_configuration",
    title:         "Validate environment configuration",
    description:   "Bounds execution to runtime env corruption probes",
    action_class:  "runtime",
  },
] as const;
